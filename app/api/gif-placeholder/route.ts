import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { isSafePublicUrl } from '@/lib/url-security';
import { safeFetch, readCappedArrayBuffer, MAX_IMAGE_BYTES } from '@/lib/safe-fetch';
import { prisma } from '@/lib/prisma';
import { gifByteCap, parseStillWidth } from '@/lib/gif-still';

/**
 * The GIF covers of the active catalogue — the only URLs this route may read
 * past MAX_IMAGE_BYTES (lib/gif-still.ts says why). Refreshed every 10 minutes;
 * a database failure leaves the default cap in force, never a bigger one.
 */
const COVERS_TTL_MS = 10 * 60_000;
let coversCache: { at: number; covers: Set<string> } | null = null;
let coversLoad: Promise<Set<string>> | null = null;

async function catalogGifCovers(): Promise<Set<string>> {
  if (coversCache && Date.now() - coversCache.at < COVERS_TTL_MS) return coversCache.covers;
  coversLoad ??= prisma.feed
    .findMany({
      where: { status: 'active', markedDead: false, image: { contains: '.gif', mode: 'insensitive' } },
      select: { image: true },
    })
    .then((rows) => {
      const covers = new Set(rows.map((r) => r.image).filter((u): u is string => !!u));
      coversCache = { at: Date.now(), covers };
      return covers;
    })
    .catch((error) => {
      console.warn('⚠️ gif-placeholder: could not load catalogue covers, default cap applies:', error?.message);
      return new Set<string>();
    })
    .finally(() => {
      coversLoad = null;
    });
  return coversLoad;
}

/**
 * Finished stills, so a 40 MB cover is fetched once per server, not once per
 * visitor (there is no CDN in front of Railway). Small: ~17 covers × one width.
 * Concurrent requests for the same still share one fetch.
 */
const STILL_CACHE_MAX = 64;
const stills = new Map<string, Uint8Array>();
const stillsInFlight = new Map<string, Promise<Uint8Array | null>>();

function rememberStill(key: string, value: Uint8Array) {
  stills.delete(key);
  stills.set(key, value);
  while (stills.size > STILL_CACHE_MAX) stills.delete(stills.keys().next().value as string);
}

/**
 * API endpoint to extract the first frame of a GIF as a WebP image.
 * With `w`, the frame is resized to that width (64..1024): AlbumCard asks for a
 * 640 px still instead of drawing a 13-41 MB animation in a 175 px card.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gifUrl = searchParams.get('url');
    
    if (!gifUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing GIF URL parameter' 
      }, { status: 400 });
    }

    // Validate URL
    let url: URL;
    try {
      url = new URL(gifUrl);
    } catch {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid URL format' 
      }, { status: 400 });
    }

    // Only allow HTTPS URLs for security
    if (url.protocol !== 'https:') {
      return NextResponse.json({
        success: false,
        error: 'Only HTTPS URLs are allowed'
      }, { status: 400 });
    }

    // The https + .gif checks above do not stop https://10.0.0.5/x.gif. Any
    // route that fetches a caller-supplied URL must go through this guard —
    // same rule /api/chapters, /api/proxy-image and /api/proxy-audio follow.
    const urlCheck = isSafePublicUrl(gifUrl);
    if (!urlCheck.ok) {
      return NextResponse.json({
        success: false,
        error: urlCheck.error
      }, { status: 400 });
    }

    // Validate that it's a GIF
    if (!gifUrl.toLowerCase().includes('.gif') && !gifUrl.toLowerCase().includes('image/gif')) {
      return NextResponse.json({ 
        success: false, 
        error: 'URL must point to a GIF image' 
      }, { status: 400 });
    }

    const width = parseStillWidth(searchParams.get('w'));
    const cacheKey = `${width ?? 'orig'}|${gifUrl}`;

    let firstFrame: Uint8Array | null | undefined = stills.get(cacheKey);
    if (!firstFrame) {
      let failure: NextResponse | null = null;
      let load = stillsInFlight.get(cacheKey);
      if (!load) {
        load = (async () => {
          // Past MAX_IMAGE_BYTES only for a catalogue cover (lib/gif-still.ts).
          const cap = gifByteCap(gifUrl, await catalogGifCovers(), MAX_IMAGE_BYTES);

          // safeFetch, not fetch: the guard above validates only the URL it is given,
          // and this fetch followed redirects, so a 302 into the private range was
          // never re-checked. It also caps the body.
          const fetched = await safeFetch(gifUrl, {
            timeoutMs: cap > MAX_IMAGE_BYTES ? 30000 : 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)',
              'Accept': 'image/*',
            },
          });

          if (!fetched.ok) {
            failure = NextResponse.json({ success: false, error: 'Failed to fetch GIF' }, { status: 400 });
            return null;
          }

          const response = fetched.response;

          if (!response.ok) {
            failure = NextResponse.json({
              success: false,
              error: `Failed to fetch GIF: ${response.status} ${response.statusText}`
            }, { status: response.status });
            return null;
          }

          // Get the GIF data
          const readGif = await readCappedArrayBuffer(response, cap);
          if (!readGif.ok) {
            failure = NextResponse.json({ success: false, error: 'GIF too large' }, { status: 413 });
            return null;
          }
          const gifBuffer = Buffer.from(readGif.value);

          // Extract first frame and convert to WebP
          // By setting animated: false, sharp will only process the first frame
          let frame = sharp(gifBuffer, {
            animated: false, // Only process first frame
            limitInputPixels: false
          });
          if (width) frame = frame.resize({ width, withoutEnlargement: true });
          const out = new Uint8Array(await frame.webp({ quality: width ? 80 : 85, effort: 4 }).toBuffer());
          rememberStill(cacheKey, out);
          return out;
        })().finally(() => stillsInFlight.delete(cacheKey));
        stillsInFlight.set(cacheKey, load);
      }
      firstFrame = await load;
      if (!firstFrame) {
        return failure ?? NextResponse.json({ success: false, error: 'Failed to fetch GIF' }, { status: 502 });
      }
    }

    // Set headers with aggressive caching
    const headers = new Headers();
    headers.set('Content-Type', 'image/webp');
    headers.set('Content-Length', firstFrame.length.toString());
    headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
    headers.set('X-Image-Type', 'gif-placeholder');
    headers.set('Vary', 'Accept-Encoding');

    return new NextResponse(new Uint8Array(firstFrame), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('GIF placeholder extraction error:', error);
    
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ 
        success: false, 
        error: 'GIF fetch timeout' 
      }, { status: 408 });
    }

    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

