import { isSafePublicUrl } from './url-security';
import { withUserAgent } from './user-agent';

/**
 * The one outbound fetch for every route that retrieves a caller-supplied URL.
 *
 * `isSafePublicUrl()` alone was not enough, and the gap was not theoretical.
 * It validates the URL it is given and nothing else, so three things slipped
 * past it:
 *
 *  1. REDIRECTS. Every proxy route followed them (`fetch` defaults to
 *     `redirect: 'follow'`; proxy-image set it explicitly). So
 *     `https://attacker.example/a.png` → `302 → http://169.254.169.254/`
 *     reached the metadata endpoint with a URL that passed the guard. We now
 *     follow redirects by hand and re-run the guard on every hop.
 *  2. RESPONSE SIZE. `arrayBuffer()` and `text()` buffer whatever arrives, so a
 *     single large URL was an out-of-memory primitive on a shared Railway
 *     instance. Every read here is capped, and a declared `content-length` over
 *     the cap is refused before a byte is read.
 *  3. ROUTES THAT NEVER CALLED THE GUARD AT ALL — `/api/fetch-rss` and the
 *     three lnurl routes parsed the URL (or did not) and fetched it.
 *
 * Pure except for the injected `fetchImpl`, so the redirect and size logic is
 * unit-testable without a network. Same precedent as `lib/url-security.ts`.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SafeFetchOptions {
  /** Allow `http://` as well as `https://`. Default false. */
  allowHttp?: boolean;
  /** Redirect hops to follow, each re-validated. Default 3. */
  maxRedirects?: number;
  /** Abort after this many milliseconds. Default 15000. */
  timeoutMs?: number;
  method?: string;
  /** Sent on every hop. Gets our User-Agent (lib/user-agent.js) unless it sets one. */
  headers?: Record<string, string>;
  /** Caller-supplied abort signal, combined with the timeout. */
  signal?: AbortSignal;
  /** Test seam. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: URL }
  | { ok: false; error: string };

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;

/** 3xx codes that carry a Location we should follow. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch `raw`, refusing any URL — initial or redirected-to — that
 * `isSafePublicUrl()` rejects.
 *
 * The body is NOT read. Use `readCappedText` / `readCappedArrayBuffer` /
 * `cappedStream` so the size limit is applied.
 */
export async function safeFetch(
  raw: string,
  opts: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    allowHttp = false,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    method = 'GET',
    headers,
    signal,
    fetchImpl = fetch as unknown as FetchLike,
  } = opts;

  const first = isSafePublicUrl(raw, { allowHttp });
  if (!first.ok) return { ok: false, error: first.error };

  let current: URL = first.url;
  // Never Node's default `node`: a host that logs or filters on the name sees who
  // is calling and where to read about it. A caller's own User-Agent wins.
  const sendHeaders = withUserAgent(headers);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method,
        headers: sendHeaders,
        // The whole point: never let the platform follow a redirect for us.
        redirect: 'manual',
        signal: timeout.signal,
      });
    } catch {
      // Deliberately generic. The upstream error text is what makes a blind
      // SSRF non-blind, so it never reaches the caller.
      return {
        ok: false,
        error: signal?.aborted ? 'Request cancelled' : 'Upstream request failed',
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: true, response, finalUrl: current };
    }

    const location = response.headers.get('location');
    if (!location) {
      // A 3xx with no Location is not a redirect we can follow; hand it back.
      return { ok: true, response, finalUrl: current };
    }

    if (hop === maxRedirects) {
      return { ok: false, error: `Too many redirects (limit ${maxRedirects})` };
    }

    // Location may be relative — resolve against the URL we just fetched.
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      return { ok: false, error: 'Invalid redirect target' };
    }

    // THE POINT OF THIS MODULE: re-validate every hop, not just the first.
    const check = isSafePublicUrl(next, { allowHttp });
    if (!check.ok) {
      return { ok: false, error: `Redirect target refused: ${check.error}` };
    }
    current = check.url;
  }

  return { ok: false, error: `Too many redirects (limit ${maxRedirects})` };
}

/**
 * True when the response declares more bytes than we are willing to read.
 * A missing or unparseable `content-length` returns false — the streaming
 * readers below still enforce the cap.
 */
export function declaredLengthExceeds(response: Response, maxBytes: number): boolean {
  const raw = response.headers.get('content-length');
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > maxBytes;
}

export type CappedRead<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Read the whole body, refusing anything over `maxBytes`.
 *
 * Checks the declared length first so an honest oversized response costs
 * nothing, then counts real bytes so a lying or chunked one is caught too.
 */
export async function readCappedArrayBuffer(
  response: Response,
  maxBytes: number
): Promise<CappedRead<Uint8Array>> {
  if (declaredLengthExceeds(response, maxBytes)) {
    return { ok: false, error: `Response exceeds ${maxBytes} bytes` };
  }

  const body = response.body;
  if (!body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return { ok: false, error: `Response exceeds ${maxBytes} bytes` };
    }
    return { ok: true, value: buf };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: `Response exceeds ${maxBytes} bytes` };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: out };
}

/** `readCappedArrayBuffer` decoded as UTF-8. */
export async function readCappedText(
  response: Response,
  maxBytes: number
): Promise<CappedRead<string>> {
  const buf = await readCappedArrayBuffer(response, maxBytes);
  if (!buf.ok) return buf;
  return { ok: true, value: new TextDecoder().decode(buf.value) };
}

/**
 * Pass a body straight through to the client while enforcing the cap.
 *
 * For routes that must stream (audio, video) and cannot buffer. The stream
 * errors once the cap is passed, which surfaces to the client as a truncated
 * response rather than as an out-of-memory process.
 */
export function cappedStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new Error(`Response exceeds ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

/** Byte caps, named so the numbers are not scattered across route files. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_FEED_BYTES = 12 * 1024 * 1024;
export const MAX_JSON_BYTES = 1 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
