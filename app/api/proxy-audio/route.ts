import { NextRequest, NextResponse } from 'next/server';
import { guardProxyTarget } from '@/lib/proxy-host-allowlist';
import { createRouteLimiter, enforceRateLimit } from '@/lib/rate-limit-guard';
import { isSafePublicUrl } from '@/lib/url-security';
import { safeFetch, declaredLengthExceeds, MAX_AUDIO_BYTES } from '@/lib/safe-fetch';
import { forwardableContentLength } from '@/lib/forwarded-framing';
import { USER_AGENT } from '@/lib/user-agent';

/**
 * Per-IP ceiling on this route. Module scope so the buckets survive between
 * requests. Log-only until RATE_LIMIT_MODE=enforce — see lib/rate-limit-guard.ts.
 */
const limiter = createRouteLimiter(240);

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(limiter, request.headers, 'proxy-audio');
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  console.log('🔄 [Audio Proxy] Incoming request for URL:', url?.substring(0, 150));

  if (!url) {
    console.error('❌ [Audio Proxy] Missing URL parameter');
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 });
  }

  const urlCheck = isSafePublicUrl(url, { allowHttp: true });
  if (!urlCheck.ok) {
    console.error(`❌ [Audio Proxy] Rejected URL (${urlCheck.error}):`, url.substring(0, 150));
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }

  // isSafePublicUrl answers the SSRF question only — it permits every PUBLIC
  // host, which made this an open proxy for the whole internet. Bind it to the
  // catalog. Log-only until PROXY_HOST_MODE=enforce.
  const { refusal } = await guardProxyTarget(url, 'proxy-audio');
  if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

  try {
    // Our own User-Agent, not a browser imitation. The Chrome 120 string that was
    // here (2025-11-29, "servers that block obvious proxies") did not help any
    // host on 2026-11-27: of 81 audio hosts probed with this header set (from a
    // home IP address, not Railway), none served the Chrome name and refused
    // ours, and thebearsnare.com dropped the connection for every `Mozilla/5.0`
    // name while it served ours. The other browser-style headers stay as they
    // were.
    const fetchHeaders: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity', // Don't compress audio streams
      'Sec-Fetch-Dest': 'audio',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
    };

    // Add Referer/Origin based on the audio URL's origin (makes request look legitimate)
    try {
      const audioOrigin = new URL(url).origin;
      fetchHeaders['Referer'] = audioOrigin + '/';
      fetchHeaders['Origin'] = audioOrigin;
    } catch {
      // Invalid URL, skip referer
    }

    // Add range header if provided (for seeking support)
    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      console.log('📍 [Audio Proxy] Range request:', rangeHeader);
      fetchHeaders['Range'] = rangeHeader;
    }

    console.log('⏳ [Audio Proxy] Fetching from origin...');
    const startTime = Date.now();

    // Time out on an origin that never RESPONDS, not on one that responds slowly.
    // `AbortSignal.timeout(30000)` bounds the whole request including the body,
    // and `response.body` is streamed straight to the client below — so a large
    // file on a slow origin was destroyed mid-transfer at 30s. Playback never
    // noticed (short Range requests each finish well inside the window); offline
    // downloads pull the entire file in one request and died on it. Clearing the
    // timer once the headers land keeps the dead-origin protection without
    // capping how long a healthy transfer may take.
    //
    // safeFetch keeps exactly that behaviour — it clears its timer as soon as
    // `fetch` resolves, which is when the headers land — and adds the redirect
    // re-validation this route was missing: `isSafePublicUrl` above only saw
    // the first URL, so a 302 into the private range went through.
    const fetched = await safeFetch(url, {
      allowHttp: true,
      timeoutMs: 30000,
      headers: fetchHeaders,
    });

    if (!fetched.ok) {
      console.error(`❌ [Audio Proxy] Refused (${fetched.error}):`, url.substring(0, 150));
      return NextResponse.json({ error: 'Failed to fetch audio file' }, { status: 502 });
    }

    const response = fetched.response;

    const fetchDuration = Date.now() - startTime;
    console.log(`✅ [Audio Proxy] Origin responded in ${fetchDuration}ms - Status: ${response.status}`);

    if (!response.ok) {
      console.error(`❌ [Audio Proxy] Origin returned error status: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: 'Failed to fetch audio file', status: response.status },
        {
          status: response.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type, Accept'
          }
        }
      );
    }

    // The upstream content-type used to be echoed verbatim alongside
    // `Access-Control-Allow-Origin: *`, which made this a general-purpose open
    // CORS proxy: any site could read any third-party response through us.
    // Restricting the type to media keeps the wildcard usable for the audio
    // element (it is needed for cross-origin media in the WebView) while
    // closing the read-anything hole.
    const upstreamType = (response.headers.get('content-type') || '').toLowerCase();
    const isMediaType =
      upstreamType === '' ||
      upstreamType.startsWith('audio/') ||
      upstreamType.startsWith('video/') ||
      upstreamType.startsWith('application/octet-stream') ||
      upstreamType.startsWith('application/ogg') ||
      upstreamType.startsWith('binary/');
    if (!isMediaType) {
      console.warn(`⚠️ [Audio Proxy] Refused non-media content-type "${upstreamType}" for ${url.substring(0, 150)}`);
      return NextResponse.json({ error: 'Not an audio resource' }, { status: 415 });
    }

    // Refuse an oversized body on its declared length. Deliberately NOT a
    // per-byte counting stream: this is the playback hot path, and the body is
    // piped straight through rather than buffered, so the header check is the
    // protection that costs nothing.
    if (declaredLengthExceeds(response, MAX_AUDIO_BYTES)) {
      console.warn(`⚠️ [Audio Proxy] Refused oversized body for ${url.substring(0, 150)}`);
      return NextResponse.json({ error: 'Audio file too large' }, { status: 413 });
    }

    // Get the response headers with comprehensive CORS support
    const headers = new Headers();
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    headers.set('Content-Type', contentType);
    headers.set('Accept-Ranges', 'bytes');

    // Enhanced CORS headers
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // Cache headers - allow browser to cache audio for 1 hour
    // This significantly improves repeat playback performance
    headers.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');

    // Content length handling. Never the upstream length of a body fetch() decoded:
    // it describes the encoded bytes, and a wrong length desynchronises the
    // connection for the next client (GHSA-pc58-hwjq-p385; lib/forwarded-framing.ts).
    const contentLength = forwardableContentLength(response.headers);
    if (contentLength) {
      headers.set('Content-Length', contentLength);
      console.log(`📦 [Audio Proxy] Content-Length: ${contentLength} bytes`);
    }

    // Copy range headers if present
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      headers.set('Content-Range', contentRange);
      console.log(`📍 [Audio Proxy] Content-Range: ${contentRange}`);
    }

    console.log(`✅ [Audio Proxy] Returning proxied audio - Content-Type: ${contentType}, Status: ${response.status}`);

    // Return the audio file with proper headers
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    console.error('❌ [Audio Proxy] Error proxying audio:', {
      error: errorName,
      message: errorMessage,
      url: url?.substring(0, 150)
    });

    // Check for timeout
    if (errorName === 'TimeoutError' || errorMessage.includes('timeout')) {
      console.error('⏱️ [Audio Proxy] Request timed out after 30 seconds');
    }

    return NextResponse.json({
      error: 'Failed to proxy audio file',
      errorType: errorName,
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      url: process.env.NODE_ENV === 'development' ? url : undefined
    }, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept'
      }
    });
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    },
  });
} 