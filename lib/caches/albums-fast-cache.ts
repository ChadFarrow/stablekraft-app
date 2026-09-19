import type { Feed, Track } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createFingerprintedCache, type RebuildReason } from './fingerprinted-cache';

export interface FeedWithTracks extends Feed {
  Track: Track[];
  _count: {
    Track: number;
  };
}

export interface CachedData {
  feeds: FeedWithTracks[];
  publisherStats: Array<{ name: string; albumCount: number }>;
}

/**
 * How often to ask Postgres whether the catalog changed. Was the TTL of a full
 * rebuild; now it only buys a 32-byte fingerprint, so new tracks still appear
 * within the same ~15 minutes.
 */
export const CACHE_CHECK_INTERVAL = 15 * 60 * 1000;
/** Rebuild at least this often regardless — for any change the fingerprint misses. */
export const CACHE_MAX_AGE = 6 * 60 * 60 * 1000;
export const PLAYLIST_CACHE_DURATION = 15 * 60 * 1000;

/**
 * An md5 over every column of every active feed and every track of those feeds,
 * computed in Postgres — 32 bytes on the wire instead of the ~20 MB rebuild.
 *
 * Whole rows (`f::text`), not the columns the album shape selects, on purpose: a
 * second column list here would be one more copy to keep in step with
 * `albumFeedSelect`, and one that fails silently (a new column served stale). Whole
 * rows can only err towards an unnecessary rebuild — e.g. a poll that bumps
 * `lastFetched` — and those are rare (7 fifteen-minute windows in the week measured).
 * Tracks are joined on the FEED's filter, not their own `status`, so a track
 * flipping in or out of `active` changes the hash too.
 *
 * ~0.5 s of Postgres time per check (measured 2026-09-19, 3,897 feeds / 13,797
 * tracks), at most once per CACHE_CHECK_INTERVAL.
 */
export async function catalogFingerprint(): Promise<string> {
  const [row] = await prisma.$queryRaw<Array<{ fp: string }>>`
    SELECT md5(
      coalesce((SELECT string_agg(md5(f::text), '' ORDER BY f.id) FROM "Feed" f
                WHERE f.status = 'active' AND f."markedDead" = false), '')
      || '|' ||
      coalesce((SELECT string_agg(md5(t::text), '' ORDER BY t.id) FROM "Track" t
                JOIN "Feed" f ON f.id = t."feedId"
                WHERE f.status = 'active' AND f."markedDead" = false), '')
    ) AS fp`;
  return row.fp;
}

function cacheOptions(name: string) {
  return {
    fingerprint: catalogFingerprint,
    checkIntervalMs: CACHE_CHECK_INTERVAL,
    maxAgeMs: CACHE_MAX_AGE,
    // console.warn, not log: `log` is compiled out of production builds (CLAUDE.md),
    // and how often this fires is the number worth reading there. A few a day.
    onRebuild: (reason: RebuildReason, ms: number) =>
      console.warn(`[albums-fast-cache] ${name} rebuilt (${reason}) in ${ms}ms`),
    onBackgroundError: (error: unknown) =>
      console.warn(`[albums-fast-cache] ${name} background check failed; serving the previous rows:`, error),
  };
}

/** Every active feed with up to 20 tracks — the grid, sorts and filters. */
export const albumsFastCatalog = createFingerprintedCache<CachedData>(cacheOptions('catalog'));

/** The `filter=podcasts` view: podcast feeds with their newest episodes. Was uncached. */
export const albumsFastPodcasts = createFingerprintedCache<FeedWithTracks[]>(cacheOptions('podcasts'));

interface PlaylistCacheState {
  playlistData: any[] | null;
  playlistTimestamp: number;
}

const playlistState: PlaylistCacheState = {
  playlistData: null,
  playlistTimestamp: 0,
};

export function getAlbumsFastPlaylistCache(): PlaylistCacheState {
  return playlistState;
}

export function invalidateAlbumsFastCache(): void {
  albumsFastCatalog.invalidate();
  albumsFastPodcasts.invalidate();
  playlistState.playlistData = null;
  playlistState.playlistTimestamp = 0;
}
