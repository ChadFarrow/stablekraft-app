/**
 * Which upstream Content-Length a proxy route may copy onto its own response.
 *
 * `fetch()` (undici) transparently decodes a gzip/br/deflate body but keeps the
 * upstream headers, so `response.headers.get('content-length')` then describes
 * the ENCODED body while `response.body` streams the DECODED one, which is
 * longer. Copying that length onto the proxied response declares the wrong
 * framing: Node writes the extra bytes anyway, and behind an HTTP/1.1 proxy
 * that reuses connections they are read as the start of the NEXT client's
 * response — the response-injection advisory GHSA-pc58-hwjq-p385. Next fixed
 * it in 15.5.29 by stripping the header from every route response; this app is
 * pinned to 15.5.28 (see CLAUDE.md), so the proxies must not forward it.
 *
 * Unencoded media — what audio, video and image hosts actually serve — keeps
 * its length, so range requests and Safari's media probing are unchanged. An
 * encoded upstream gets no length at all, and Node sends it chunked.
 */
export function forwardableContentLength(upstream: Headers): string | null {
  const length = upstream.get('content-length');
  if (!length) return null;
  const encoding = upstream.get('content-encoding')?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') return null;
  return length;
}
