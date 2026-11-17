import { createHash } from 'node:crypto';
import { hostMatches } from '../host-match';
import { MAX_IMAGE_BYTES, readCappedArrayBuffer, safeFetch, type FetchLike } from '../safe-fetch';
import { stripImageVersion, withImageVersion } from './image-version-url';

export {
  IMAGE_VERSION_PARAM,
  preserveImageVersion,
  stripImageVersion,
  withImageVersion,
} from './image-version-url';

/**
 * Notice when an image changed at the SAME URL.
 *
 * An artist can replace a cover file in place, edit the feed by hand and send a
 * podping from anywhere — podping.me or any Hive account — without MSP ever
 * running. The re-read then writes the same URL back, and every cache keeps the
 * old art. That was Hip-Hop Taoist on 2026-09-26: the album page showed the old
 * cover for as long as `/_next/image` held it.
 *
 * So the refresh asks the image HOST, and stores the answer in the URL (see
 * `./image-version-url.ts`). The podping is never an input: anyone can send one,
 * and it can make us re-read a feed, but only the host can change a version.
 */

/**
 * Hosts whose art is never versioned. Wavlake: the stack rule is to go through
 * Podcast Index, never Wavlake directly, and a Wavlake upload gets a new UUID
 * anyway. stablekraft.app: our own files.
 */
const UNVERSIONED_HOSTS = ['wavlake.com', 'd12wklypp119aj.cloudfront.net', 'stablekraft.app'];

/** Query names that mark a signed URL, which one extra parameter would break. */
const SIGNED_URL_PARAMS = new Set([
  'x-amz-signature',
  'x-amz-credential',
  'x-goog-signature',
  'signature',
  'sig',
  'token',
  'expires',
  'key-pair-id',
  'policy',
]);

/** A 64-hex SHA-256 in the path: content-addressed (Blossom), already versioned. */
const CONTENT_HASH_IN_PATH = /[0-9a-f]{64}/i;

/** May this URL carry our version? */
export function isVersionable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (hostMatches(parsed.hostname, UNVERSIONED_HOSTS)) return false;
  if (CONTENT_HASH_IN_PATH.test(parsed.pathname)) return false;
  for (const name of parsed.searchParams.keys()) {
    if (SIGNED_URL_PARAMS.has(name.toLowerCase())) return false;
  }
  return true;
}

/**
 * 8 letters a-p from a SHA-256 — each hex digit mapped to a letter.
 *
 * Letters only, ON PURPOSE: `getAlbumArtworkUrl` (lib/cdn-utils.ts) swaps any URL
 * containing `404` for a placeholder, and a hex token would spell it now and then.
 */
export function versionToken(input: string | Uint8Array): string {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 8);
  let out = '';
  for (const ch of hex) out += String.fromCharCode(97 + parseInt(ch, 16));
  return out;
}

export interface ResolveOptions {
  /** Test seam. */
  fetchImpl?: FetchLike;
  /** Per request. The podping consumer waits on the whole refresh, so keep it short. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * The host's current version of an image, or null when it cannot be known.
 *
 * `HEAD` first: `ETag` / `Last-Modified` are HTTP's own "did it change" answer,
 * and cost no body. A weak ETag (`W/`) is compared as the strong one, because a
 * proxy such as Cloudflare may weaken it on some responses and not others. With
 * no validators, or a host that refuses HEAD, the bytes are downloaded (capped)
 * and hashed. Every request goes through `safeFetch`: feed image URLs are
 * arbitrary, so this is an SSRF surface like any other.
 */
export async function resolveImageVersion(url: string, opts: ResolveOptions = {}): Promise<string | null> {
  if (!isVersionable(url)) return null;
  const base = stripImageVersion(url);
  const fetchOpts = {
    allowHttp: true,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: opts.fetchImpl,
  };

  const head = await safeFetch(base, { ...fetchOpts, method: 'HEAD' });
  if (!head.ok) return null;
  const { response } = head;

  if (response.ok) {
    const etag = (response.headers.get('etag') || '').replace(/^W\//, '');
    const lastModified = response.headers.get('last-modified') || '';
    if (etag || lastModified) {
      const length = response.headers.get('content-length') || '';
      return versionToken(`${etag}|${lastModified}|${length}`);
    }
  } else if (response.status !== 405 && response.status !== 501) {
    return null;
  }

  const get = await safeFetch(base, { ...fetchOpts, method: 'GET' });
  if (!get.ok || !get.response.ok) return null;
  const bytes = await readCappedArrayBuffer(get.response, MAX_IMAGE_BYTES);
  return bytes.ok ? versionToken(bytes.value) : null;
}

/** Requests in flight at once, across distinct image URLs of one feed. */
const CONCURRENCY = 4;

/**
 * Version every image a refresh is about to write.
 *
 * Returns a mapper: pass it each URL the refresh would write (feed image, track
 * images) and write what it returns. Each distinct URL is asked once — the RSS
 * parser copies the channel image into every item without art, so a whole album
 * usually costs one request, and its tracks get the feed's exact URL.
 *
 * KEEP-ON-FAILURE: when the host cannot answer and a stored URL has the same
 * base, the stored (versioned) URL is kept. A host that is briefly down must not
 * strip a version, or its return would re-download the art everywhere.
 */
export async function resolveImageUrls(
  urls: Array<string | null | undefined>,
  stored: Array<string | null | undefined>,
  opts: ResolveOptions = {}
): Promise<<T extends string | null | undefined>(url: T) => T | string> {
  const storedByBase = new Map<string, string>();
  for (const s of stored) {
    if (s && stripImageVersion(s) !== s) storedByBase.set(stripImageVersion(s), s);
  }

  const bases = Array.from(new Set(urls.filter((u): u is string => !!u).map(stripImageVersion)));
  const resolved = new Map<string, string>();
  let next = 0;
  async function worker() {
    while (next < bases.length) {
      const base = bases[next++];
      if (!isVersionable(base)) {
        resolved.set(base, base);
        continue;
      }
      const token = await resolveImageVersion(base, opts);
      resolved.set(base, token ? withImageVersion(base, token) : storedByBase.get(base) ?? base);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, bases.length) }, worker));

  return <T extends string | null | undefined>(url: T): T | string => {
    if (!url) return url;
    return resolved.get(stripImageVersion(url)) ?? url;
  };
}
