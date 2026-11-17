/**
 * Removes the automatic audio cache that earlier builds filled without limit.
 *
 * Until 2026-11 `lib/audio-prefetch.ts` fetched the next track (and the next
 * three on every shuffle start) and stored each whole song in this Cache
 * Storage bucket. Nothing ever removed an entry — its `MAX_CACHED_TRACKS = 3`
 * capped how far ahead one call looked, not the cache — so the bucket grew with
 * every song played: 606 entries and 4.52 GB in one Firefox profile on
 * 2026-11-17. Nothing ever READ it either: no service-worker route serves it
 * and playback never asked it for a blob, so the bytes helped no replay, no
 * seek and no offline play. The fetch did not warm the media element's own
 * cache (Chrome took 0 of 273 media requests from disk), so each prefetched
 * song was downloaded twice. The prefetch is gone; this deletes what it left.
 *
 * It runs on every load (AudioProvider mount), because a listener may come
 * back months later, and a tab still running an old build can write the bucket
 * again until it reloads. Deleting a bucket that is not there is a cheap no-op.
 *
 * NEVER widen the match. The user's downloads live in `stablekraft-downloads-v1`
 * and `stablekraft-downloads-art-v1` (lib/downloads/downloads-cache.ts) and must
 * survive every update; a prefix match on `stablekraft-` would delete them.
 */
export const LEGACY_AUDIO_CACHE = 'stablekraft-audio-cache-v1';

type CacheDeleter = Pick<CacheStorage, 'delete'>;

function defaultStorage(): CacheDeleter | undefined {
  try {
    return typeof caches === 'undefined' ? undefined : caches;
  } catch {
    // Some browsers throw on the `caches` getter when storage is blocked.
    return undefined;
  }
}

/**
 * Deletes the legacy automatic audio cache. Resolves `true` when a bucket was
 * deleted, `false` when there was none or the Cache API is unavailable. Never
 * rejects: a failure here must not reach the player.
 */
export async function purgeLegacyAudioCache(
  storage: CacheDeleter | undefined = defaultStorage(),
): Promise<boolean> {
  if (!storage) return false;
  try {
    return await storage.delete(LEGACY_AUDIO_CACHE);
  } catch {
    return false;
  }
}
