import { NextRequest, NextResponse } from 'next/server';
import { parseChaptersJSON } from '@/lib/rss-parser-db';
import { isSafePublicUrl } from '@/lib/url-security';
import { safeFetch, readCappedText, MAX_JSON_BYTES } from '@/lib/safe-fetch';
import { USER_AGENT } from '@/lib/user-agent';

/**
 * GET /api/chapters?url=<chaptersUrl>
 * Proxies podcast chapter JSON files to avoid CORS issues on the client.
 * Returns parsed and sorted chapters array.
 *
 * Reflex fallback: if the URL is a `reflex.livewire.io/chapters/<direct-url>`
 * proxy path and the proxy fails or returns non-JSON, retry against the direct
 * URL extracted from the path. Mirrors the server-side `fetchChapters()`
 * behavior so the client-side loader recovers from the same outage that the
 * import-time fetch hits.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  const primary = validateChaptersUrl(url);
  if ('error' in primary) {
    return NextResponse.json({ error: primary.error }, { status: 400 });
  }

  // Try the primary URL first.
  let chapters = await fetchAndParse(primary.url);

  // Reflex proxy fallback: format is `.../chapters/https://actual-url.json`.
  // Only trigger the fallback if the URL is actually a reflex proxy path —
  // other paths with a /chapters/ segment (e.g. podcast-hosted chapter feeds)
  // should not get a second hop.
  if (!chapters && isReflexProxyUrl(primary.url)) {
    const directMatch = primary.url.match(/\/chapters\/(https?:\/\/.+)$/);
    if (directMatch) {
      const fallback = validateChaptersUrl(directMatch[1]);
      if (!('error' in fallback)) {
        console.log('🔄 Reflex chapters proxy failed, retrying direct URL');
        chapters = await fetchAndParse(fallback.url);
      }
    }
  }

  if (!chapters) {
    // Don't cache failures — next request should re-try the upstream.
    return NextResponse.json(
      { error: 'Failed to fetch chapters' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return NextResponse.json(
    { chapters },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    }
  );
}

function isReflexProxyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'reflex.livewire.io' || host.endsWith('.reflex.livewire.io');
  } catch {
    return false;
  }
}

async function fetchAndParse(url: string) {
  try {
    // safeFetch, not fetch: validateChaptersUrl above checks only the URL it is
    // handed, and this fetch followed redirects, so the guard could be walked
    // past with a 302. It also caps the body.
    const fetched = await safeFetch(url, {
      timeoutMs: 10000,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!fetched.ok) {
      console.warn(`⚠️ Chapters fetch refused for ${url}: ${fetched.error}`);
      return null;
    }
    const response = fetched.response;
    if (!response.ok) return null;
    const body = await readCappedText(response, MAX_JSON_BYTES);
    if (!body.ok) return null;
    const data = JSON.parse(body.value);
    return parseChaptersJSON(data);
  } catch (error) {
    console.warn(`⚠️ Failed to fetch chapters from ${url}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

// URL validation + SSRF protection (https-only). Returns the validated URL
// string on success or `{ error }` on rejection.
function validateChaptersUrl(url: string): { url: string } | { error: string } {
  const result = isSafePublicUrl(url);
  if (!result.ok) {
    return { error: result.error };
  }
  return { url: result.url.toString() };
}
