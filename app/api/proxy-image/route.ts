import { NextRequest, NextResponse } from 'next/server';
import { guardProxyTarget } from '@/lib/proxy-host-allowlist';
import { createRouteLimiter, enforceRateLimit } from '@/lib/rate-limit-guard';
import { isSafePublicUrl } from '@/lib/url-security';
import { safeFetch, readCappedArrayBuffer, MAX_IMAGE_BYTES } from '@/lib/safe-fetch';

// Dynamic import sharp with fallback for serverless environments
let sharp: typeof import('sharp').default | null = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('⚠️ Sharp not available, image processing disabled:', e);
}

// In-memory cache for proxied images (LRU-style, bounded by entries AND by bytes)
const imageCache = new Map<string, { buffer: Buffer; contentType: string; timestamp: number }>();
const MAX_CACHE_ENTRIES = 500; // Increased from 100 for better cache hit rate
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (increased from 30 minutes)
// Feed artwork is arbitrary in size — Homegrown Hits ships ~19 MB animated GIFs
// per episode. An entry-count-only bound let a handful of those pin hundreds of
// MB of Railway RSS, so cap total bytes and refuse to cache oversized images at
// all (they still get proxied, just re-fetched each time).
const MAX_CACHE_BYTES = 96 * 1024 * 1024; // 96 MB total
const MAX_CACHEABLE_IMAGE_BYTES = 4 * 1024 * 1024; // Skip anything bigger than 4 MB
let cacheBytes = 0;

function dropCacheEntry(key: string) {
  const entry = imageCache.get(key);
  if (!entry) return;
  cacheBytes -= entry.buffer.length;
  imageCache.delete(key);
}

function getCachedImage(url: string) {
  const cached = imageCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }
  if (cached) {
    dropCacheEntry(url); // Expired
  }
  return null;
}

function setCachedImage(url: string, buffer: Buffer, contentType: string) {
  if (buffer.length > MAX_CACHEABLE_IMAGE_BYTES) {
    return; // Too big to keep resident - serve it through without caching
  }

  // Replacing an existing key must not double-count its bytes
  dropCacheEntry(url);

  // Evict oldest entries until the new one fits both bounds
  while (
    imageCache.size > 0 &&
    (imageCache.size >= MAX_CACHE_ENTRIES || cacheBytes + buffer.length > MAX_CACHE_BYTES)
  ) {
    const oldestKey = imageCache.keys().next().value;
    if (!oldestKey) break;
    dropCacheEntry(oldestKey);
  }

  imageCache.set(url, { buffer, contentType, timestamp: Date.now() });
  cacheBytes += buffer.length;
}

/**
 * Generate a placeholder image as PNG buffer
 * This ensures Next.js Image optimization always receives a valid image
 */
async function generatePlaceholderImage(): Promise<Buffer> {
  // If sharp is not available, return a minimal 1x1 PNG
  if (!sharp) {
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
  }

  const svg = `
    <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1e40af;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#3b82f6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#60a5fa;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)"/>
      <g transform="translate(200, 200)" fill="white" opacity="0.9">
        <circle cx="0" cy="-60" r="32" fill="white"/>
        <rect x="-8" y="-60" width="16" height="160" fill="white"/>
        <circle cx="0" cy="100" r="32" fill="white"/>
        <rect x="-8" y="100" width="16" height="80" fill="white"/>
      </g>
    </svg>
  `;

  // Convert SVG to PNG using sharp
  return await sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

/**
 * Return a placeholder image response instead of JSON error
 * This prevents Next.js Image optimization from failing
 */
async function returnPlaceholderImage(): Promise<NextResponse> {
  try {
    const placeholderBuffer = await generatePlaceholderImage();
    return new NextResponse(new Uint8Array(placeholderBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': placeholderBuffer.length.toString(),
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'X-Image-Proxy': 'stablekraft.app',
        'X-Image-Placeholder': 'true',
      },
    });
  } catch (error) {
    // If we can't generate placeholder, return a minimal 1x1 PNG
    const minimalPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    return new NextResponse(minimalPng, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': minimalPng.length.toString(),
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'X-Image-Proxy': 'stablekraft.app',
        'X-Image-Placeholder': 'true',
      },
    });
  }
}

/**
 * Per-IP ceiling on this route. Module scope so the buckets survive between
 * requests. Log-only until RATE_LIMIT_MODE=enforce — see lib/rate-limit-guard.ts.
 */
const limiter = createRouteLimiter(300);

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(limiter, request.headers, 'proxy-image');
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    let imageUrl = searchParams.get('url');

    if (!imageUrl) {
      console.warn('⚠️ Missing image URL parameter, returning placeholder');
      return returnPlaceholderImage();
    }

    // Handle double-encoded URLs (e.g., %2520 instead of %20)
    // This happens when URLs with encoded characters are passed through encodeURIComponent again
    if (imageUrl.includes('%25')) {
      try {
        imageUrl = decodeURIComponent(imageUrl);
        console.log('🔄 Decoded double-encoded URL:', imageUrl.substring(0, 60));
      } catch {
        // If decoding fails, continue with original URL
      }
    }

    // Check in-memory cache first (use normalized URL for cache key)
    const cached = getCachedImage(imageUrl);
    if (cached) {
      console.log(`📦 Cache hit for: ${imageUrl.substring(0, 50)}...`);
      const headers = new Headers();
      headers.set('Content-Type', cached.contentType);
      headers.set('Content-Length', cached.buffer.length.toString());
      headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
      headers.set('X-Image-Proxy', 'stablekraft.app');
      headers.set('X-Cache', 'HIT');
      return new NextResponse(new Uint8Array(cached.buffer), { status: 200, headers });
    }

    // Validate URL + SSRF guard (placeholder keeps Next Image optimization from failing)
    const urlCheck = isSafePublicUrl(imageUrl, { allowHttp: true });
    if (!urlCheck.ok) {
      console.warn(`⚠️ Rejected image URL (${urlCheck.error}): ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }

    // isSafePublicUrl answers the SSRF question only — it permits every PUBLIC
    // host, which made this an open proxy for the whole internet. Bind it to the
    // catalog. A refusal returns the placeholder rather than an error, matching
    // how this route already handles a rejected URL. Log-only until
    // PROXY_HOST_MODE=enforce.
    const { refusal } = await guardProxyTarget(imageUrl, 'proxy-image');
    if (refusal) return returnPlaceholderImage();
    const url = urlCheck.url;

    // Try to upgrade HTTP to HTTPS for security
    // Use url.href to ensure proper URL encoding (spaces, special chars)
    if (url.protocol === 'http:') {
      console.log(`⚠️ HTTP URL detected, attempting HTTPS upgrade: ${imageUrl}`);
      url.protocol = 'https:';
    }
    const fetchUrl = url.href;

    // The timeout covers the whole fetch, body included. 3s is right for normal
    // cover art but starves animated GIFs — Homegrown Hits episode art is ~19 MB,
    // which needs a sustained >6 MB/s to land in time, so it intermittently
    // aborted and fell back to the placeholder ("Image fetch timeout" in the
    // Railway logs). Give GIF URLs a longer leash without slowing everything else.
    const looksAnimated = url.pathname.toLowerCase().endsWith('.gif');
    const fetchTimeoutMs = looksAnimated ? 12000 : 3000;

    // Fetch the image.
    //
    // safeFetch, not fetch. `redirect: 'follow'` used to hand the redirect to
    // the platform, so `isSafePublicUrl` above only ever saw the FIRST url:
    // https://attacker.example/a.png -> 302 -> http://169.254.169.254/ reached
    // the metadata endpoint. safeFetch re-runs the guard on every hop.
    const fetched = await safeFetch(fetchUrl, {
      allowHttp: true, // the HTTPS upgrade above is best-effort, not a guarantee
      timeoutMs: fetchTimeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)',
        'Accept': 'image/*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    });

    if (!fetched.ok) {
      console.warn(`⚠️ Image fetch refused (${fetched.error}) for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }

    const response = fetched.response;

    if (!response.ok) {
      console.warn(`⚠️ Failed to fetch image: ${response.status} ${response.statusText} for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }

    // Validate that we actually got an image
    const contentType = response.headers.get('content-type');
    const isValidImageType = contentType && contentType.startsWith('image/');
    
    // SVG is refused, not proxied.
    //
    // An SVG is a script container. Served from THIS origin with an
    // image/svg+xml content type and no sandbox, /api/proxy-image?url=...x.svg
    // executed attacker JavaScript as stablekraft.app — which reaches
    // localStorage['admin_secret'] and the wallet material. The site CSP is
    // report-only, so it did not stop this. next.config.js already handles the
    // same risk correctly for /_next/image (dangerouslyAllowSVG PLUS
    // contentDispositionType 'attachment' PLUS a sandbox CSP); this route never
    // got the equivalent. Nothing in the catalog needs SVG cover art, so the
    // simplest safe answer is to decline.
    const declaredSvg = Boolean(contentType && contentType.toLowerCase().includes('svg'));
    const looksSvg = url.pathname.toLowerCase().endsWith('.svg');
    if (declaredSvg || looksSvg) {
      console.warn(`⚠️ Refused SVG through the image proxy: ${imageUrl}`);
      return returnPlaceholderImage();
    }

    // If content-type is not image/*, check if URL looks like an image file
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const hasImageExtension = imageExtensions.some(ext => imageUrl.toLowerCase().includes(ext));
    
    if (!isValidImageType && !hasImageExtension) {
      console.warn(`⚠️ Invalid content type: ${contentType} for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }

    // Get the image data (read once, reuse for validation and processing).
    // Capped: arrayBuffer() used to buffer whatever arrived, so one large URL
    // could take the instance down.
    const readImage = await readCappedArrayBuffer(response, MAX_IMAGE_BYTES);
    if (!readImage.ok) {
      console.warn(`⚠️ Image too large (${readImage.error}) for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }
    const arrayBuffer = readImage.value;

    // Validate buffer before processing
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.warn(`⚠️ Received empty image data for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }
    
    const imageBuffer = Buffer.from(arrayBuffer);
    
    // Quick validation: check for common image file signatures (optional check)
    try {
      const isValidImageSignature = 
        (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8 && imageBuffer[2] === 0xFF) || // JPEG
        (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) || // PNG
        (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46) || // GIF
        (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46) || // WebP (RIFF)
        (imageBuffer[0] === 0x3C && imageBuffer[1] === 0x3F && imageBuffer[2] === 0x78 && imageBuffer[3] === 0x6D); // SVG (XML)
      
      // If we have a content-type header saying it's an image, trust it even without signature match
      // (formats like AVIF/HEIC/TIFF are valid but not in the signature list above).
      //
      // But when the signature does NOT match AND the server did not claim an
      // image type, this is not an image — it is almost always an HTML error
      // page served for a URL that merely ends in .png/.jpg, which slipped past
      // the content-type guard above via hasImageExtension. Passing those bytes
      // through made Next's Image optimizer log
      //   "⨯ The requested resource isn't a valid image ... received null"
      // once per card referencing the image — hundreds of lines per page view.
      // Fall back to the placeholder like every other rejection path here.
      if (!isValidImageSignature && !isValidImageType && imageBuffer.length > 10) {
        console.warn(`⚠️ Not an image (signature mismatch, content-type: ${contentType}) for ${imageUrl}, returning placeholder`);
        return returnPlaceholderImage();
      }
    } catch (validationError) {
      console.warn('⚠️ Image validation check failed, proceeding anyway:', validationError);
    }
    
    // Validate buffer size (must be at least a few bytes to be a valid image)
    if (imageBuffer.length < 10) {
      console.warn(`⚠️ Image data too small (${imageBuffer.length} bytes) for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }

    // Check if we should enhance the image (for backgrounds, use enhance=true parameter)
    const enhance = searchParams.get('enhance') === 'true' && sharp !== null;
    const minWidth = parseInt(searchParams.get('minWidth') || '1920');
    const minHeight = parseInt(searchParams.get('minHeight') || '1080');

    let processedBuffer: Buffer = imageBuffer;
    let finalContentType = contentType || 'image/jpeg';

    // Enhance image quality for backgrounds if requested (only if sharp is available)
    if (enhance && sharp) {
      try {
        // Validate buffer before passing to sharp
        if (!imageBuffer || imageBuffer.length === 0) {
          throw new Error('Invalid image buffer');
        }
        
        // Try to validate the image can be processed by sharp
        let image: ReturnType<typeof sharp>;
        try {
          image = sharp!(imageBuffer);
        } catch (sharpInitError) {
          throw new Error(`Failed to initialize sharp with image: ${sharpInitError instanceof Error ? sharpInitError.message : 'Unknown error'}`);
        }
        
        const metadata = await image.metadata();
        
        // Validate metadata was retrieved successfully
        if (!metadata) {
          throw new Error('Failed to retrieve image metadata');
        }
        
        // Validate metadata has valid dimensions
        if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
          throw new Error(`Invalid image dimensions: ${metadata.width}x${metadata.height}`);
        }
        
        // Check if image needs upscaling for background use
        const needsUpscale = metadata.width && metadata.height && 
                            (metadata.width < minWidth || metadata.height < minHeight);
        
        if (needsUpscale && metadata.width && metadata.height) {
          // Upscale image to minimum dimensions while maintaining aspect ratio
          const aspectRatio = metadata.width / metadata.height;
          let targetWidth = minWidth;
          let targetHeight = minHeight;
          
          if (aspectRatio > 1) {
            // Landscape: fit to width
            targetHeight = Math.round(minWidth / aspectRatio);
          } else {
            // Portrait: fit to height
            targetWidth = Math.round(minHeight * aspectRatio);
          }
          
          console.log(`🖼️ Upscaling image from ${metadata.width}x${metadata.height} to ${targetWidth}x${targetHeight}`);
          
          processedBuffer = await image
            .resize(targetWidth, targetHeight, {
              fit: 'fill',
              kernel: sharp!.kernel.lanczos3, // High-quality upscaling
              withoutEnlargement: false // Allow upscaling
            })
            .jpeg({ 
              quality: 95, // High quality for backgrounds
              mozjpeg: true 
            })
            .toBuffer();
          
          // Validate processed buffer
          if (!processedBuffer || processedBuffer.length === 0) {
            throw new Error('Sharp processing returned empty buffer');
          }
          
          finalContentType = 'image/jpeg';
        } else if (metadata.format === 'gif') {
          // For GIFs, keep original format to preserve animation
          // Don't convert to JPEG as that loses the animation
          console.log(`🎬 Preserving GIF animation for ${imageUrl}`);
          processedBuffer = imageBuffer;
          finalContentType = 'image/gif';
        } else if (!metadata.format) {
          // For unknown formats, convert to high-quality JPEG for backgrounds
          processedBuffer = await sharp!(imageBuffer)
            .jpeg({
              quality: 95,
              mozjpeg: true
            })
            .toBuffer();

          // Validate processed buffer
          if (!processedBuffer || processedBuffer.length === 0) {
            throw new Error('Sharp processing returned empty buffer');
          }

          finalContentType = 'image/jpeg';
        } else {
          // Just optimize existing image without resizing
          processedBuffer = await sharp!(imageBuffer)
            .jpeg({
              quality: 95,
              mozjpeg: true
            })
            .toBuffer();
          
          // Validate processed buffer
          if (!processedBuffer || processedBuffer.length === 0) {
            throw new Error('Sharp processing returned empty buffer');
          }
          
          finalContentType = 'image/jpeg';
        }
      } catch (sharpError) {
        console.warn('⚠️ Sharp processing failed, using original image:', sharpError);
        // Fall back to original buffer if sharp processing fails, but validate it first
        if (!imageBuffer || imageBuffer.length === 0) {
          console.warn('⚠️ Image processing failed and original buffer is invalid, returning placeholder');
          return returnPlaceholderImage();
        }
        processedBuffer = imageBuffer;
      }
    }
    
    // Final validation before returning
    if (!processedBuffer || processedBuffer.length === 0) {
      console.warn(`⚠️ Processed image buffer is invalid or empty for ${imageUrl}, returning placeholder`);
      return returnPlaceholderImage();
    }

    // Set headers for image serving
    const headers = new Headers();
    // Use detected content-type or inferred type
    if (!isValidImageType) {
      if (imageUrl.toLowerCase().includes('.png')) finalContentType = 'image/png';
      else if (imageUrl.toLowerCase().includes('.gif')) finalContentType = 'image/gif';
      else if (imageUrl.toLowerCase().includes('.webp')) finalContentType = 'image/webp';
      else finalContentType = 'image/jpeg'; // Default fallback
    }

    // Cache the successfully fetched image
    setCachedImage(imageUrl, processedBuffer, finalContentType);
    console.log(`💾 Cached image: ${imageUrl.substring(0, 50)}... (${processedBuffer.length} bytes)`);

    headers.set('Content-Type', finalContentType);
    headers.set('Content-Length', processedBuffer.length.toString());
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400'); // 1 hour client, 24 hours CDN
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
    headers.set('X-Image-Proxy', 'stablekraft.app');
    headers.set('X-Cache', 'MISS');
    if (enhance) {
      headers.set('X-Image-Enhanced', 'true');
    }
    headers.set('Vary', 'Accept-Encoding');

    return new NextResponse(new Uint8Array(processedBuffer), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('Image proxy error:', error);
    
    // Always return a placeholder image instead of JSON error
    // This prevents Next.js Image optimization from failing
    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        console.warn('⚠️ Image fetch timeout, returning placeholder');
      } else if (error.message.includes('ENOTFOUND')) {
        console.warn('⚠️ Domain not found - DNS resolution failed, returning placeholder');
      } else {
        console.warn(`⚠️ Image proxy error: ${error.message}, returning placeholder`);
      }
    } else {
      console.warn('⚠️ Unknown image proxy error, returning placeholder');
    }
    
    return returnPlaceholderImage();
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