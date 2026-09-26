/**
 * Audio-bytes layer for offline downloads, built on the Cache API.
 *
 * Distinct from the small disposable LRU prefetch cache in lib/audio-prefetch.ts
 * (`stablekraft-audio-cache-v1`, 3 items). This cache holds user-requested
 * downloads and is only ever emptied by explicit removal / clear-all.
 *
 * Entries are keyed by the canonical `primaryPlaybackKey` (the original secure
 * media URL) but FETCHED via `audioUrlCandidates` — the same ordered
 * proxy-first-then-direct list playback uses — so CORS-problematic hosts still
 * work. At play time the bytes are handed back as a same-origin `blob:` URL, so
 * playback needs zero network and never hits CORS.
 */
import { audioUrlCandidates } from '../audio-url-utils';
import { stripImageVersion } from '../feeds/image-version-url';

// PERSISTENCE INVARIANT: this bucket name is load-bearing. Renaming it (e.g.
// bumping `-v1` → `-v2`) orphans every downloaded track and forces limited-
// bandwidth users to re-download over their data plan. Only `clearAllBytes()`
// (explicit user "delete all") and per-key eviction ever remove entries — never
// an app update. Keep the name stable across releases.
export const DOWNLOADS_CACHE = 'stablekraft-downloads-v1';

function cacheApiAvailable(): boolean {
  return typeof caches !== 'undefined';
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  fraction: number | null;
}

function isAbort(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * Fetch the first candidate URL that yields a readable body.
 *
 * Playback has always had this fallback (`getAudioUrlsToTry` returns an ordered
 * list and AudioContext walks it); the download path fired a single shot at a
 * hand-maintained allowlist, so any host outside it was fetched cross-origin
 * with no retry. On a CDN without `Access-Control-Allow-Origin` that rejects
 * with a bare `TypeError: Failed to fetch` — which is exactly the "streams but
 * won't download" report, with nothing useful recorded anywhere.
 */
async function fetchFirstReadable(
  sourceUrl: string,
  signal?: AbortSignal
): Promise<Response & { body: ReadableStream<Uint8Array> }> {
  const candidates = audioUrlCandidates(sourceUrl);
  if (candidates.length === 0) throw new Error('downloadBytes: no fetch candidates');

  const failures: string[] = [];

  for (const candidate of candidates) {
    // A cancel mid-list must stop the walk, not fall through to the next
    // candidate: download-manager reads AbortError as "user cancelled" (→ idle)
    // and anything else as a failure (→ error state).
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const viaProxy = candidate.startsWith('/api/proxy-audio');
    try {
      const response = await fetch(candidate, {
        mode: 'cors',
        credentials: 'omit',
        signal,
      });
      if (response.ok && response.body) {
        return response as Response & { body: ReadableStream<Uint8Array> };
      }
      failures.push(`${viaProxy ? 'proxy' : 'direct'} HTTP ${response.status}`);
    } catch (err) {
      if (isAbort(err)) throw err;
      failures.push(
        `${viaProxy ? 'proxy' : 'direct'} ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Name the host: the whole point is that the next "it won't download" report
  // arrives with the hostname already in it.
  let host = sourceUrl;
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    /* unparseable — keep the raw string */
  }
  throw new Error(`downloadBytes: all ${candidates.length} attempts failed for ${host} (${failures.join('; ')})`);
}

/**
 * Fetch a track's bytes and store them under `key`. Reports streaming progress
 * when the server sends Content-Length. Returns the stored byte size.
 * Cancellable via `signal`; a cancelled/failed download leaves nothing behind
 * (Cache.put is atomic — a partial response is never committed).
 */
export async function downloadBytes(
  key: string,
  opts: {
    onProgress?: (p: DownloadProgress) => void;
    signal?: AbortSignal;
    /** The track's RAW media URL. Candidates are built from this, not from
     *  `key`: `primaryPlaybackKey` upgrades http→https for keying purposes,
     *  while playback proxies the URL as the feed wrote it (the proxy accepts
     *  http). Building candidates from the key would make an http-only host
     *  stream fine and fail to download. Falls back to `key` when absent. */
    sourceUrl?: string;
  } = {}
): Promise<number> {
  if (!cacheApiAvailable()) {
    throw new Error('Cache API unavailable — downloads not supported here');
  }
  if (!key) throw new Error('downloadBytes: empty key');

  const response = await fetchFirstReadable(opts.sourceUrl || key, opts.signal);

  const totalBytes = Number(response.headers.get('Content-Length')) || null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      receivedBytes += value.length;
      opts.onProgress?.({
        receivedBytes,
        totalBytes,
        fraction: totalBytes ? Math.min(1, receivedBytes / totalBytes) : null,
      });
    }
  }

  // Reassemble into one Blob, preserving the original content type.
  const contentType = response.headers.get('Content-Type') || 'audio/mpeg';
  const blob = new Blob(chunks as BlobPart[], { type: contentType });

  const cache = await caches.open(DOWNLOADS_CACHE);
  // Store under the canonical key (a Response with a fixed Content-Length so a
  // later `.blob()` round-trips cleanly).
  await cache.put(
    key,
    new Response(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(blob.size),
      },
    })
  );

  return blob.size;
}

/** Whether bytes for `key` are already stored. */
export async function hasBytes(key: string): Promise<boolean> {
  if (!cacheApiAvailable() || !key) return false;
  const cache = await caches.open(DOWNLOADS_CACHE);
  const match = await cache.match(key);
  return Boolean(match);
}

/**
 * Resolve stored bytes to a fresh same-origin object URL, or null if the entry
 * is missing (e.g. evicted by the browser). Caller owns revoking the URL.
 */
export async function getObjectUrl(key: string): Promise<string | null> {
  if (!cacheApiAvailable() || !key) return null;
  const cache = await caches.open(DOWNLOADS_CACHE);
  const match = await cache.match(key);
  if (!match) return null;
  const blob = await match.blob();
  return URL.createObjectURL(blob);
}

/** Delete stored bytes for `key`. */
export async function deleteBytes(key: string): Promise<void> {
  if (!cacheApiAvailable() || !key) return;
  const cache = await caches.open(DOWNLOADS_CACHE);
  await cache.delete(key);
}

/** Drop the entire downloads byte cache. */
export async function clearAllBytes(): Promise<void> {
  if (!cacheApiAvailable()) return;
  await caches.delete(DOWNLOADS_CACHE);
}

// ---- cover art ------------------------------------------------------------
// Cover images live in a sibling cache, keyed by their original URL, fetched
// through the same-origin image proxy so the bytes are readable (cross-origin
// art hosts otherwise give opaque responses we can't turn into a blob: URL).

// PERSISTENCE INVARIANT: load-bearing bucket name — see DOWNLOADS_CACHE above.
// Do not rename across releases; it would orphan cached cover art.
export const DOWNLOADS_ART_CACHE = 'stablekraft-downloads-art-v1';

/**
 * The key a cover is stored under: its URL without our image version
 * (lib/feeds/image-version-url.ts). The version changes when the artist replaces
 * the file, and Now Playing looks covers up by the track's CURRENT URL, so a
 * versioned key would lose the offline cover on the first change. Every cover
 * stored before versioning existed is already under this key.
 */
export function coverCacheKey(url: string): string {
  return stripImageVersion(url);
}

/** Fetch a cover image via the same-origin proxy and store it under `url`.
 *  Best-effort: throws on failure so the caller can swallow it. */
export async function downloadImage(url: string): Promise<void> {
  if (!cacheApiAvailable() || !url) return;
  const res = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`, {
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`downloadImage: HTTP ${res.status}`);
  const blob = await res.blob();
  const cache = await caches.open(DOWNLOADS_ART_CACHE);
  await cache.put(
    coverCacheKey(url),
    new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'image/jpeg',
        'Content-Length': String(blob.size),
      },
    })
  );
}

/** Resolve a stored cover to a fresh object URL, or null if not cached. */
export async function getImageObjectUrl(url: string): Promise<string | null> {
  if (!cacheApiAvailable() || !url) return null;
  const cache = await caches.open(DOWNLOADS_ART_CACHE);
  const match = await cache.match(coverCacheKey(url));
  if (!match) return null;
  const blob = await match.blob();
  return URL.createObjectURL(blob);
}

/** Delete a stored cover by its URL. */
export async function deleteImage(url: string): Promise<void> {
  if (!cacheApiAvailable() || !url) return;
  const cache = await caches.open(DOWNLOADS_ART_CACHE);
  await cache.delete(coverCacheKey(url));
}

/** Drop the entire cover-art cache. */
export async function clearAllImages(): Promise<void> {
  if (!cacheApiAvailable()) return;
  await caches.delete(DOWNLOADS_ART_CACHE);
}

/** Browser-reported storage usage/quota (bytes), if the API exists. */
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  } catch {
    return null;
  }
}

/** Request durable storage so the browser is less likely to evict downloads. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
