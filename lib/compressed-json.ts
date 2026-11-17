/**
 * `NextResponse.json`, gzipped when the caller accepts it.
 *
 * `next.config.js` sets `compress: true`, and pages, JS and CSS do leave the
 * server gzipped — but no App Router route handler does. Next copies a route's
 * headers onto the Node response with `res.appendHeader()`
 * (next/dist/server/send-response.js), which stores `Content-Type` as an ARRAY,
 * and the compression middleware only recognises a string: its debug log reads
 * `[ 'application/json' ] not compressible`, and every JSON body goes out raw.
 * Still true in 15.5.24.
 *
 * It is most of this app's egress. Measured on production 2026-09-19:
 * `/api/albums-fast` 645 KB on the wire and 62 KB gzipped, and the full
 * playlist routes 1–10 MB each (`greatest-hits` 10 MB, `mmm` 9.9 MB,
 * `hgh` 7.2 MB). Railway bills egress per GB, and there is no CDN in front of
 * it, so `s-maxage` saves nothing — every one of those bytes is paid for.
 *
 * Compressing here rather than waiting on Next is safe if Next is ever fixed:
 * the middleware skips a response that already carries `Content-Encoding`, so
 * nothing is compressed twice.
 *
 * Use it for LARGE success bodies. A small or error response is fine as
 * `NextResponse.json`; below MIN_GZIP_BYTES gzip would only add latency.
 */
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';

const gzipAsync = promisify(gzip);

/** Below this, gzip's header and the CPU cost outweigh the saving. */
export const MIN_GZIP_BYTES = 1024;

/**
 * Whether an `Accept-Encoding` header allows gzip. Honours `q=0`, which is how a
 * client says "never", and `*`, which allows anything not listed.
 */
export function acceptsGzip(acceptEncoding: string | null): boolean {
  if (!acceptEncoding) return false;
  let wildcard: boolean | null = null;
  for (const part of acceptEncoding.split(',')) {
    const [rawName, ...params] = part.split(';');
    const name = rawName.trim().toLowerCase();
    const q = params
      .map((p) => p.trim().toLowerCase())
      .find((p) => p.startsWith('q='));
    const allowed = q === undefined || Number(q.slice(2)) > 0;
    if (name === 'gzip' || name === 'x-gzip') return allowed;
    if (name === '*') wildcard = allowed;
  }
  return wildcard === true;
}

/**
 * Same body, status and headers `NextResponse.json(body, init)` would send —
 * gzipped when the request accepts it and the body is worth compressing.
 * `Vary: Accept-Encoding` is set either way, so a cache never serves one
 * encoding to a client that asked for the other.
 */
export async function compressedJson<T>(
  request: Request,
  body: T,
  init?: ResponseInit
): Promise<NextResponse<T>> {
  const json = JSON.stringify(body);
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.append('Vary', 'Accept-Encoding');

  if (json.length < MIN_GZIP_BYTES || !acceptsGzip(request.headers.get('accept-encoding'))) {
    return new NextResponse(json, { ...init, headers }) as NextResponse<T>;
  }

  const gzipped = await gzipAsync(json);
  headers.set('Content-Encoding', 'gzip');
  headers.set('Content-Length', String(gzipped.byteLength));
  return new NextResponse(new Uint8Array(gzipped), { ...init, headers }) as NextResponse<T>;
}
