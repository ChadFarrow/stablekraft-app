import { prisma } from '@/lib/prisma';

/**
 * Single source of truth for "which DB row does this favorite's `d` tag mean?".
 *
 * A favorite event's `d` tag is whatever id the publishing client had to hand, and that
 * has not been consistent. Measured over the 121 distinct d-tags other site users have
 * on relays (prod, 2026-07-26):
 *
 *   Track.id     7
 *   Feed.id     41
 *   Track.guid  69   ← the route only looked up the first two, so these were dropped
 *   unresolved   4
 *
 * The route used to `continue` past anything it couldn't find (silently), which is why
 * only 27% of the community's favorites ever rendered. With the guid rung it's 97%.
 *
 * Shaped after `lib/feed-lookup.ts` — ordered rungs, reports which one matched.
 */

export type FavoriteMatchKind = 'track-id' | 'feed-id' | 'track-guid' | 'feed-guid';

export interface TrackRow {
  id: string;
  title: string;
  artist: string | null;
  image: string | null;
  duration: number | null;
  feedId: string | null;
  Feed: {
    id: string;
    title: string;
    artist: string | null;
    image: string | null;
    originalUrl: string;
    markedDead: boolean;
    blocked: boolean;
  } | null;
}

export interface FeedRow {
  id: string;
  title: string;
  artist: string | null;
  image: string | null;
  type: string | null;
  originalUrl: string;
  markedDead: boolean;
  blocked: boolean;
  _count: { Track: number };
  Track: Array<{ id: string; title: string }>;
}

export type FavoriteMatch =
  | { kind: 'track'; matchedVia: 'track-id' | 'track-guid'; track: TrackRow }
  | { kind: 'album'; matchedVia: 'feed-id' | 'feed-guid'; feed: FeedRow };

const TRACK_SELECT = {
  id: true,
  title: true,
  artist: true,
  image: true,
  duration: true,
  feedId: true,
  Feed: {
    select: {
      id: true,
      title: true,
      artist: true,
      image: true,
      originalUrl: true,
      markedDead: true,
      blocked: true,
    },
  },
} as const;

const FEED_SELECT = {
  id: true,
  title: true,
  artist: true,
  image: true,
  type: true,
  originalUrl: true,
  markedDead: true,
  blocked: true,
  _count: { select: { Track: true } },
  Track: {
    take: 1,
    orderBy: { trackOrder: 'asc' as const },
    select: { id: true, title: true },
  },
} as const;

/**
 * Pure: given the three lookup result sets, decide what each d-tag resolved to.
 *
 * Order is load-bearing. `Track.id` is sometimes a CUID and sometimes `${feedId}-${guid}`,
 * so a string can plausibly be both a Track.id and some other track's guid — the id rung
 * has to win. Feed.id sits between them because an album favorite's d-tag is a Feed.id
 * and we should not go looking for a track guid before checking that.
 */
export function pickFavoriteMatches(
  dTags: string[],
  sets: {
    tracksById: Map<string, TrackRow>;
    feedsById: Map<string, FeedRow>;
    tracksByGuid: Map<string, TrackRow>;
    feedsByGuid?: Map<string, FeedRow>;
  }
): Map<string, FavoriteMatch> {
  const matches = new Map<string, FavoriteMatch>();
  for (const dTag of dTags) {
    const byId = sets.tracksById.get(dTag);
    if (byId) {
      matches.set(dTag, { kind: 'track', matchedVia: 'track-id', track: byId });
      continue;
    }
    const feed = sets.feedsById.get(dTag);
    if (feed) {
      matches.set(dTag, { kind: 'album', matchedVia: 'feed-id', feed });
      continue;
    }
    const byGuid = sets.tracksByGuid.get(dTag);
    if (byGuid) {
      matches.set(dTag, { kind: 'track', matchedVia: 'track-guid', track: byGuid });
      continue;
    }
    const feedByGuid = sets.feedsByGuid?.get(dTag);
    if (feedByGuid) {
      matches.set(dTag, { kind: 'album', matchedVia: 'feed-guid', feed: feedByGuid });
    }
  }
  return matches;
}

/**
 * Resolve favorite `d` tags to DB rows.
 *
 * Bounded at four queries regardless of input size — each rung only asks about the
 * d-tags the previous rungs missed. `Track.guid` is `@unique` and indexed
 * (`@@index([guid])`), so rung 3 is an indexed lookup with no ambiguity; matching is
 * exact-case, which was verified to resolve all 69 guid-style tags in prod.
 */
export async function resolveFavoriteItems(
  dTags: string[]
): Promise<Map<string, FavoriteMatch>> {
  const unique = [...new Set(dTags.filter(Boolean))];
  if (unique.length === 0) return new Map();

  // Rung 1 — Track.id
  const tracksById = await prisma.track.findMany({
    where: { id: { in: unique } },
    select: TRACK_SELECT,
  });
  const tracksByIdMap = new Map(tracksById.map((t) => [t.id, t as TrackRow]));

  // Rung 2 — Feed.id, over what rung 1 missed
  const afterTracks = unique.filter((d) => !tracksByIdMap.has(d));
  const feedsById = afterTracks.length
    ? await prisma.feed.findMany({
        where: { id: { in: afterTracks } },
        select: FEED_SELECT,
      })
    : [];
  const feedsByIdMap = new Map(feedsById.map((f) => [f.id, f as FeedRow]));

  // Rung 3 — Track.guid, over what rungs 1 and 2 missed. This is the one that was
  // missing; 69 of 121 community favorites live here.
  const afterFeeds = afterTracks.filter((d) => !feedsByIdMap.has(d));
  const tracksByGuid = afterFeeds.length
    ? await prisma.track.findMany({
        where: { guid: { in: afterFeeds } },
        select: { ...TRACK_SELECT, guid: true },
      })
    : [];
  const tracksByGuidMap = new Map(
    tracksByGuid.map((t) => [(t as any).guid as string, t as TrackRow])
  );

  // Rung 4 — Feed.guid, over what rungs 1-3 missed. LAST on purpose: the first
  // three rungs are backed by measured production data (7 / 41 / 69 of 121
  // d-tags), and moving this above them would change which row an existing tag
  // resolves to. It exists because the write path can emit a Feed.guid — both
  // `sync-favorites.ts`'s `track.id || track.guid || track.audioUrl` chain and
  // the cross-app kind:30078 list, whose album entries are `podcast:guid:` by
  // construction.
  const afterTrackGuids = afterFeeds.filter((d) => !tracksByGuidMap.has(d));
  const feedsByGuid = afterTrackGuids.length
    ? await prisma.feed.findMany({
        where: { guid: { in: afterTrackGuids } },
        select: { ...FEED_SELECT, guid: true },
      })
    : [];
  const feedsByGuidMap = new Map(
    feedsByGuid.map((f) => [(f as any).guid as string, f as FeedRow])
  );

  return pickFavoriteMatches(unique, {
    tracksById: tracksByIdMap,
    feedsById: feedsByIdMap,
    tracksByGuid: tracksByGuidMap,
    feedsByGuid: feedsByGuidMap,
  });
}
