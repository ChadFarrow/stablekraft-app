import { lookup as dnsLookup } from 'node:dns/promises';
import { safeFetch, declaredLengthExceeds, MAX_FEED_BYTES, type FetchLike } from './safe-fetch';
import { isPrivateIp, normalizeHost } from './url-security';

/**
 * The guarded fetch for feed XML (and the chapters JSON a feed points at).
 *
 * A feed URL is not ours: `POST /api/feeds` and `/api/feeds/refresh-by-url` are open
 * to anyone, and a feed's own `<podcast:remoteItem feedUrl>` and `<podcast:chapters
 * url>` name further URLs. `parseRSSFeed` fetched them with a bare `fetch` — no check
 * against private addresses, redirects followed by the platform, and an uncapped
 * `response.text()` (PC20-Nostr survey, 2026-11-24). `safeFetch` already closed the
 * redirect and size holes for the proxy routes; this adds the two things it lacks:
 *
 *  1. A DNS check on EVERY hop. `isSafePublicUrl` reads the URL as text, so a public
 *     name that resolves to a private address (`127.0.0.1.nip.io`, which needs no
 *     attacker infrastructure at all) passed it. Every address DNS returns must be
 *     public, and a name that does not resolve is refused (fail closed).
 *  2. ONE deadline over the whole fetch: the lookups, every redirect hop and the body.
 *     `safeFetch`'s own timer stops when the headers arrive, so a server that sends
 *     headers and then one byte a minute held the request for ever. Same pattern as
 *     `withDeadline` in `app/api/admin/check-dead-feeds/route.ts`.
 *
 * The returned Response is a drop-in for `fetch`'s: `ok`, `status`, `text()`,
 * `json()`. Its body is capped, so `text()` rejects past `maxBytes` instead of
 * buffering whatever arrives. A refusal throws `FeedFetchError`, as a network failure
 * makes `fetch` throw, so existing `try`/`catch` blocks handle both.
 *
 * Residual risk, stated plainly: this is resolve-then-fetch, and undici resolves the
 * name again to connect. A DNS server that answers the check with a public address
 * and the connect with a private one (rebinding) still gets through. Closing that
 * needs a dialer pinned to the checked address.
 *
 * Server only: it imports `node:dns`.
 */

/** Total budget for one feed fetch: DNS, every hop and the body. */
export const FEED_FETCH_TIMEOUT_MS = 30_000;

/** Plain `fetch` followed 20. Real feeds chain http → https → www → CDN. */
export const FEED_MAX_REDIRECTS = 10;

/** Every address `host` resolves to. Test seam; the default asks the system resolver. */
export type LookupAll = (host: string) => Promise<string[]>;

const systemLookup: LookupAll = async (host) =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

export class FeedFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedFetchError';
  }
}

export interface FeedFetchOptions {
  /** Total budget, see FEED_FETCH_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Body cap in bytes. Default MAX_FEED_BYTES (12 MiB). */
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Test seam. Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Test seam. Defaults to the system resolver. */
  lookup?: LookupAll;
  /** Test seam. Defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/** Reject when `signal` fires first. `dns.lookup` itself cannot be aborted. */
function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new FeedFetchError('Feed fetch timed out'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new FeedFetchError('Feed fetch timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); }
    );
  });
}

/**
 * Null when every address `hostname` resolves to is public, else the reason.
 * An IP literal is checked as it stands; a name that does not resolve is refused.
 */
export async function checkResolvedHost(
  hostname: string,
  lookup: LookupAll = systemLookup
): Promise<string | null> {
  const host = normalizeHost(hostname).replace(/^\[|\]$/g, '');
  if (isPrivateIp(host)) return `private address ${host}`;
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    return `${host} does not resolve`;
  }
  if (addrs.length === 0) return `${host} does not resolve`;
  const bad = addrs.find((a) => isPrivateIp(a));
  return bad ? `${host} resolves to private address ${bad}` : null;
}

/**
 * The e2e harness (`npm run e2e:block`) serves its feeds from 127.0.0.1. It sets
 * FEED_FETCH_ALLOW_LOOPBACK=1 on `next dev`. Never honoured in production, and only
 * for a loopback literal — not for any other private address, and not for a name.
 */
export function loopbackEscapeAllowed(
  url: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production') return false;
  if (env.FEED_FETCH_ALLOW_LOOPBACK !== '1') return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Pass the body through, erroring (and cancelling the upstream) past `maxBytes`. */
function capBody(body: ReadableStream<Uint8Array>, maxBytes: number, url: string): ReadableStream<Uint8Array> {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          console.warn(`⚠️ Feed too large: ${url} sent more than ${maxBytes} bytes, refused`);
          controller.error(new FeedFetchError(`Response exceeds ${maxBytes} bytes`));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Fetch a feed URL through the guard. See the module comment.
 * Throws FeedFetchError when the URL, a redirect, a DNS answer or the size is refused.
 */
export async function fetchFeed(url: string, opts: FeedFetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = FEED_FETCH_TIMEOUT_MS,
    maxBytes = MAX_FEED_BYTES,
    headers,
    fetchImpl = fetch as unknown as FetchLike,
    lookup = systemLookup,
    env = process.env,
  } = opts;

  const deadline = AbortSignal.timeout(timeoutMs);
  // `cache: 'no-store'`: on a cacheable fetch Next tees the body and buffers one copy
  // in full to store it, outside the cap.
  const withDeadline = (u: string, init?: RequestInit) =>
    fetchImpl(u, {
      ...init,
      cache: 'no-store',
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });

  let response: Response;
  if (loopbackEscapeAllowed(url, env)) {
    try {
      response = await withDeadline(url, { headers, redirect: 'manual' });
    } catch {
      throw new FeedFetchError(deadline.aborted ? 'Feed fetch timed out' : 'Upstream request failed');
    }
  } else {
    // safeFetch runs isSafePublicUrl on each hop and then calls this, so the DNS check
    // runs on each hop too. safeFetch turns a throw into a generic error, so the
    // reason is kept here for the log.
    let refusal: string | null = null;
    const guarded: FetchLike = async (u, init) => {
      const reason = await beforeDeadline(checkResolvedHost(new URL(u).hostname, lookup), deadline);
      if (reason) {
        refusal = reason;
        throw new FeedFetchError(reason);
      }
      return withDeadline(u, init);
    };
    const got = await safeFetch(url, {
      allowHttp: true,
      maxRedirects: FEED_MAX_REDIRECTS,
      timeoutMs,
      headers,
      fetchImpl: guarded,
    });
    if (!got.ok) {
      const why = refusal ? `Refused: ${refusal}` : deadline.aborted ? 'Feed fetch timed out' : got.error;
      console.warn(`⚠️ Feed fetch refused or failed: ${url} — ${why}`);
      throw new FeedFetchError(why);
    }
    response = got.response;
  }

  if (declaredLengthExceeds(response, maxBytes)) {
    await response.body?.cancel().catch(() => {});
    console.warn(`⚠️ Feed too large: ${url} declares ${response.headers.get('content-length')} bytes (cap ${maxBytes}), refused`);
    throw new FeedFetchError(`Response exceeds ${maxBytes} bytes`);
  }

  const body =
    response.body && !NULL_BODY_STATUSES.has(response.status) ? capBody(response.body, maxBytes, url) : null;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
