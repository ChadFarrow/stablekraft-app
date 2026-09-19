import { NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { albumFeedSelect, feedToAlbum } from '@/lib/catalog/album-shape';
import { prisma } from '@/lib/prisma';
import { getPlaylistUrls, getAllPlaylistIds } from '@/lib/playlist/configs';
import {
  getBlacklistedFeedIds,
  BLACKLISTED_FEED_URLS,
  isPlaylistSourceFeedUrl,
  isBowlAfterBowlPodcastEntry,
  isHenrikFlymanWavlakeMirror,
} from '@/lib/feed-exclusions';

// "New" = recently added to the app, ordered by Feed.createdAt desc. NOT release
// date (oldestItemPubdate) and NOT track activity — re-using an old album just
// because tracks updated would surface "Lost Cause"-style false-positives that
// were already in the catalog. createdAt is when the feed record was minted.
//
// Music-only: type='album' feeds. Podcasts excluded entirely (including music-
// podcasts like Homegrown Hits, Two For Tunestr, MMM, BAB) — users browse those
// via the Podcasts filter or playlist pages.
//
// Four exclusion layers:
//   1. type='album' query filter — drops correctly-typed podcasts.
//   2. PLAYLIST_SOURCE_FEED_URLS — drops curated-playlist source podcasts (HGH,
//      MMM, etc.) still mis-typed as 'album' in the DB.
//   3. isBowlAfterBowlPodcastEntry — drops the BAB feed (mis-imported as 'album')
//      while keeping Bowl Covers (legit music).
//   4. Music-show-only artist gate — drops album feeds whose artist matches
//      any publisher row flagged musicShowOnly. Without this, curated-playlist
//      refreshes that auto-mint album feeds for remoteItem references push
//      MSO-flagged artists back to the top of "New" with a fresh createdAt.
//
// Pagination via `offset` so the client can infinite-scroll like other filters.
// We fetch all eligible feeds' metadata once (cheap — id/createdAt/url/title/
// artist for ~1.7k rows), filter post-hoc, sort, then heavily fetch only the
// page slice. Filtering must happen post-fetch because the JS-only exclusion
// rules (URL normalization, BAB title/artist matching) don't translate to
// Prisma where-clauses.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);

    // Fetch with lastNewTrackAt; fall back gracefully if the migration hasn't
    // been applied yet (column missing → Prisma errors → catch uses createdAt only).
    type LightFeed = { id: string; createdAt: Date; lastNewTrackAt: Date | null; originalUrl: string | null; title: string; artist: string | null };
    let lightFeeds: LightFeed[];
    try {
      lightFeeds = await prisma.feed.findMany({
        where: { status: 'active', type: 'album', markedDead: false },
        select: {
          id: true,
          createdAt: true,
          lastNewTrackAt: true,
          originalUrl: true,
          title: true,
          artist: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (e) {
      console.warn('[lastNewTrackAt] read failed — migration may be pending, falling back to createdAt-only sort:', e instanceof Error ? e.message : e);
      const feeds = await prisma.feed.findMany({
        where: { status: 'active', type: 'album', markedDead: false },
        select: { id: true, createdAt: true, originalUrl: true, title: true, artist: true },
        orderBy: { createdAt: 'desc' },
      });
      lightFeeds = feeds.map((f) => ({ ...f, lastNewTrackAt: null }));
    }

    // Music-show-only artist gate. Curated playlist refreshes auto-mint
    // Feed records for every remoteItem in their XML (via addUnresolvedFeeds
    // → upsert in parseFeedByGuid), with a fresh `createdAt` each pass —
    // so an MSO artist whose tracks are referenced by any music show
    // keeps reappearing at the top of "New" no matter how many times the
    // user re-flags or deletes them. Match the artist-key shape used by
    // the publisher-album cron and the cleanup route so orphan album
    // feeds (publisherId=null) are caught alongside linked ones.
    const msoPublishers = await prisma.feed.findMany({
      where: { type: 'publisher', musicShowOnly: true },
      select: { artist: true, title: true },
    });
    const msoArtistKeys = new Set<string>();
    for (const p of msoPublishers) {
      const key = (p.artist || p.title || '').trim().toLowerCase();
      if (key) msoArtistKeys.add(key);
    }

    const playlistUrls = new Set(getPlaylistUrls());
    const playlistIds = new Set(getAllPlaylistIds());
    const blacklistedIds = new Set(getBlacklistedFeedIds());
    const blacklistedUrls = new Set(BLACKLISTED_FEED_URLS);

    // URL exact-match against the playlistUrls/blacklistedUrls Sets is good enough
    // for those (PI API + admin paths produce stable URLs there). Playlist-source
    // exclusion uses the normalized helper because curated podcast URLs were
    // imported through varying paths and string-equality misses casing/trailing
    // differences (caught Mutton, Mead & Music slipping through).
    const eligible = lightFeeds.filter(
      (f) =>
        !playlistIds.has(f.id) &&
        !blacklistedIds.has(f.id) &&
        (!f.originalUrl || !playlistUrls.has(f.originalUrl)) &&
        (!f.originalUrl || !blacklistedUrls.has(f.originalUrl)) &&
        (!f.originalUrl || !isPlaylistSourceFeedUrl(f.originalUrl)) &&
        !isBowlAfterBowlPodcastEntry({
          id: f.id,
          title: f.title,
          artist: f.artist,
          feedUrl: f.originalUrl,
        }) &&
        // Henrik Flyman's Wavlake mirrors are dead (he self-hosts now) — keep
        // them out of "New" no matter how often they get re-touched.
        !isHenrikFlymanWavlakeMirror({ artist: f.artist, feedUrl: f.originalUrl }) &&
        !msoArtistKeys.has((f.artist || '').trim().toLowerCase())
    );

    // Sort by most recent activity: new-track additions float existing albums to the top
    // alongside newly minted feeds. lastNewTrackAt is only set when a genuinely new
    // track row is created (not metadata refreshes), so this doesn't cause the false-
    // positive problem that MAX(Track.createdAt) did.
    eligible.sort((a, b) => {
      const aTime = Math.max(a.createdAt.getTime(), (a.lastNewTrackAt ?? a.createdAt).getTime());
      const bTime = Math.max(b.createdAt.getTime(), (b.lastNewTrackAt ?? b.createdAt).getTime());
      return bTime - aTime;
    });

    const total = eligible.length;
    const pageIds = eligible.slice(offset, offset + limit).map((f) => f.id);

    if (pageIds.length === 0) {
      return NextResponse.json(
        { albums: [], count: 0, total, hasMore: false },
        { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
      );
    }

    const fullFeeds = await prisma.feed.findMany({
      where: { id: { in: pageIds } },
      // Shared shape — a third verbatim copy of the albums-fast select lived
      // here. See lib/catalog/album-shape.ts.
      select: albumFeedSelect(20),
    });

    const feedById = new Map(fullFeeds.map((f) => [f.id, f]));

    const albums = pageIds
      .map((id) => feedById.get(id))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      // Shared mapper. Note this path does NOT dedupe tracks, which is the one
      // way it differed from albums-fast; that stays true.
      .map((feed) => feedToAlbum(feed));

    return compressedJson(
      request,
      { albums, count: albums.length, total, hasMore: offset + albums.length < total },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      }
    );
  } catch (err) {
    console.error('Error in /api/feeds/recent:', err);
    return NextResponse.json(
      { albums: [], count: 0, total: 0, hasMore: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
