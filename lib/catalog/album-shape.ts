import { Prisma } from '@prisma/client';

/**
 * One definition of the album shape the catalog endpoints return.
 *
 * WHY: the 19-field Track select was written out three times verbatim
 * (`albums-fast` twice, `feeds/recent` once), the Feed select twice inside
 * `albums-fast` alone, and the Feed→Album mapper seven times across the repo.
 * CLAUDE.md's standing warning is that "the same field is often written or read
 * from N places, and fixing one is the standard bug here" — and it had already
 * happened: `app/publisher/[id]/page.tsx` computed
 * `releaseDate: feed.lastFetched || feed.createdAt`, the feed's last POLL time,
 * where every other path used `feed.oldestItemPubdate || feed.createdAt`. The
 * same album showed a different year on the publisher page than on the home
 * grid.
 *
 * Anything reading feeds to render album cards should use these.
 */

/**
 * Columns the client actually renders for a track.
 *
 * `podcastImages` is deliberately ABSENT: nothing under `components/`,
 * `contexts/` or `hooks/` reads a track-level `podcastImages`. The FEED-level
 * one is a different column and is still selected — `AlbumCard` reads it.
 *
 * `chapters`, `chaptersUrl`, `valueTimeSplits` and `persons` were absent too,
 * on the reasoning that `app/page.tsx` is the only consumer of this endpoint
 * and its mapper drops them on arrival. **The first half of that is wrong, and
 * it cost the radio its value time splits.**
 *
 * `app/radio/RadioClient.tsx` is a second consumer. It hands the RAW response
 * to `setInitialAlbums`, and `shuffleAllTracks` carries those exact track
 * objects into playback — no re-fetch, no mapper. Playback then reads them
 * directly:
 *
 *   valueTimeSplits  AudioContext.tsx — VTS segment playback and AutoBoost.
 *                    Absent, a segment boost silently falls back to the
 *                    track-level recipient, so the money goes to a different
 *                    person.
 *   chaptersUrl      AudioContext.tsx — fetches /api/chapters.
 *   chapters         AudioContext.tsx — the pre-parsed fast path, tried first.
 *   persons          NowPlayingScreen.tsx — track-level credits.
 *
 * Production carries 175 album-type tracks with VTS and 594 with a chapters
 * URL, all of them in the radio shuffle pool, so this was not hypothetical.
 *
 * They stay `|| undefined` in the mapper, so `JSON.stringify` still drops them
 * for the mostly-null music catalogue — which is why trimming them measured as
 * zero bytes saved at `limit=50` in the first place.
 *
 * Pinned by `catalog track shape keeps what playback reads` in the test file.
 * Do not trim one of these without following it to `contexts/AudioContext.tsx`.
 */
export const ALBUM_TRACK_SELECT = {
  id: true,
  guid: true,
  title: true,
  duration: true,
  audioUrl: true,
  image: true,
  publishedAt: true,
  v4vRecipient: true,
  v4vValue: true,
  startTime: true,
  endTime: true,
  trackOrder: true,
  mediaType: true,
  alternateEnclosures: true,
  chaptersUrl: true,
  chapters: true,
  valueTimeSplits: true,
  persons: true,
} satisfies Prisma.TrackSelect;

/** The order the album page expects: explicit track order, then date. */
export const ALBUM_TRACK_ORDER_BY: Prisma.TrackOrderByWithRelationInput[] = [
  { trackOrder: 'asc' },
  { publishedAt: 'asc' },
  { createdAt: 'asc' },
];

/**
 * Newest first, for episode lists.
 *
 * This is NOT cosmetic when combined with `take`. Taking N rows in
 * `ALBUM_TRACK_ORDER_BY` gives the N OLDEST episodes; re-sorting those in
 * JavaScript afterwards produces a list that looks newest-first but contains
 * the wrong episodes entirely. The bound and the direction have to move
 * together.
 */
export const EPISODE_TRACK_ORDER_BY: Prisma.TrackOrderByWithRelationInput[] = [
  // `nulls: 'last'` is load-bearing, not tidiness. `Track.publishedAt` is
  // nullable, and PostgreSQL sorts NULLs FIRST on DESC. The JavaScript sort
  // this replaced mapped a null date to 0, so undated episodes went last.
  // Without this, a podcast whose items carry no <pubDate> returns 20 undated
  // rows and hides every dated one — the `take` turns what would be a cosmetic
  // ordering difference into missing episodes.
  { publishedAt: { sort: 'desc', nulls: 'last' } },
  { createdAt: 'desc' },
];

/** Only tracks that can actually be played. */
export const PLAYABLE_TRACK_WHERE = {
  audioUrl: { not: '' },
  status: 'active',
} satisfies Prisma.TrackWhereInput;

/** Feed columns the album shape needs, without the nested Track. */
export const ALBUM_FEED_SCALAR_SELECT = {
  id: true,
  guid: true,
  title: true,
  description: true,
  originalUrl: true,
  type: true,
  artist: true,
  image: true,
  priority: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  oldestItemPubdate: true,
  v4vRecipient: true,
  v4vValue: true,
  persons: true,
  podcastImages: true,
} satisfies Prisma.FeedSelect;

/**
 * How many tracks to load per feed.
 *
 * `'unbounded'` is spelled out rather than achieved by leaving `take` off. The
 * `filter=podcasts` branch of `albums-fast` simply omitted it, so it silently
 * loaded EVERY episode of every podcast — `chapters` and `valueTimeSplits`
 * attached — and then re-sorted them in JavaScript. An omission reads like an
 * oversight; the word does not, and it is greppable.
 *
 * A number bounds what Prisma RETURNS, not what Postgres SENDS. On a `findMany`
 * over many feeds, the Track query goes out with no LIMIT and the engine trims to
 * `take` per feed afterwards (query log, 2026-09-19: the catalog read fetches all
 * 13,797 tracks of the active feeds to keep 11,645). So `take` saves memory and
 * response size; it does not save database egress. Cache the result instead —
 * see lib/caches/fingerprinted-cache.ts.
 */
export type TrackTake = number | 'unbounded';

export interface AlbumFeedSelectOptions {
  /** 'newest' for episode lists — see EPISODE_TRACK_ORDER_BY for why it matters. */
  order?: 'trackOrder' | 'newest';
}

/** The complete select for a feed rendered as an album. */
export function albumFeedSelect(take: TrackTake, opts: AlbumFeedSelectOptions = {}) {
  return {
    ...ALBUM_FEED_SCALAR_SELECT,
    Track: {
      where: PLAYABLE_TRACK_WHERE,
      select: ALBUM_TRACK_SELECT,
      orderBy: opts.order === 'newest' ? EPISODE_TRACK_ORDER_BY : ALBUM_TRACK_ORDER_BY,
      ...(take === 'unbounded' ? {} : { take }),
    },
    _count: {
      select: { Track: { where: { status: 'active' } } },
    },
  };
}

/** The row shape `feedToAlbum` consumes. Structural, so any equivalent select fits. */
export interface AlbumSourceTrack {
  id: string;
  guid: string | null;
  title: string;
  duration: number | null;
  audioUrl: string;
  image: string | null;
  publishedAt: Date | null;
  v4vRecipient: string | null;
  v4vValue: unknown;
  startTime: number | null;
  endTime: number | null;
  trackOrder?: number | null;
  mediaType: string;
  alternateEnclosures: unknown;
  chaptersUrl?: string | null;
  chapters?: unknown;
  valueTimeSplits?: unknown;
  persons?: unknown;
  podcastImages?: unknown;
}

export interface AlbumSourceFeed {
  id: string;
  guid: string | null;
  title: string;
  description: string | null;
  originalUrl: string;
  type: string | null;
  artist: string | null;
  image: string | null;
  priority: string;
  createdAt: Date;
  oldestItemPubdate: Date | null;
  v4vRecipient: string | null;
  v4vValue: unknown;
  persons?: unknown;
  podcastImages?: unknown;
  Track: AlbumSourceTrack[];
  _count?: { Track: number } | null;
}

export interface AlbumTrack {
  id: string;
  title: string;
  duration: number;
  url: string;
  image: string | null;
  publishedAt: Date | null;
  guid: string | null;
  v4vRecipient: string | null;
  v4vValue: unknown;
  startTime: number | null;
  endTime: number | null;
  mediaType: string;
  alternateEnclosures: unknown;
  chaptersUrl?: string;
  chapters?: unknown;
  valueTimeSplits?: unknown;
  persons?: unknown;
}

export interface Album {
  id: string;
  title: string;
  type: string;
  artist: string;
  description: string;
  coverArt: string;
  releaseDate: Date;
  dateAdded: Date;
  feedUrl: string;
  feedGuid: string | null;
  feedId: string;
  remoteFeedGuid: string | null;
  guid: string | null;
  episodeGuid: string | null;
  link: string;
  priority: string;
  tracks: AlbumTrack[];
  v4vRecipient: string | null;
  v4vValue: unknown;
  persons?: unknown;
  podcastImages?: unknown;
  trackCount: number;
}

export interface FeedToAlbumOptions {
  /**
   * Drop tracks sharing an audioUrl AND title with an earlier one.
   * `albums-fast` did this; `feeds/recent` did not. Off by default so the
   * cheaper path stays cheap, and stated explicitly where it is wanted.
   */
  dedupeTracks?: boolean;
  /** Order tracks newest-first after selection (podcast episode lists). */
  newestFirst?: boolean;
  /** `type` when the feed declares none. 'album' everywhere but the podcast list. */
  defaultType?: string;
  /**
   * Fall back to the first track's V4V when the feed carries none.
   * True everywhere except the podcast list, which deliberately reports only
   * the feed's own value.
   */
  v4vTrackFallback?: boolean;
}

export function trackToAlbumTrack(track: AlbumSourceTrack): AlbumTrack {
  return {
    id: track.id,
    title: track.title,
    // 180 is the long-standing fallback for a feed that declares no duration.
    duration: track.duration || 180,
    url: track.audioUrl,
    image: track.image,
    publishedAt: track.publishedAt,
    guid: track.guid,
    v4vRecipient: track.v4vRecipient,
    v4vValue: track.v4vValue,
    startTime: track.startTime,
    endTime: track.endTime,
    mediaType: track.mediaType || 'audio',
    alternateEnclosures: track.alternateEnclosures,
    // `|| undefined` so JSON.stringify omits the key entirely when the column
    // is null, which is most of the music catalogue. See the select's comment.
    chaptersUrl: track.chaptersUrl || undefined,
    chapters: track.chapters || undefined,
    valueTimeSplits: track.valueTimeSplits || undefined,
    persons: track.persons || undefined,
  };
}

/**
 * A Feed row as the album object every catalog surface returns.
 *
 * The contract, unchanged from `albums-fast`:
 *   releaseDate — when the album came out (oldest track date when known)
 *   dateAdded   — when the feed was added to the site
 *
 * `releaseDate` is the field that had drifted. It must never fall back to
 * `lastFetched`, which is when we last polled the feed.
 */
export function feedToAlbum(feed: AlbumSourceFeed, opts: FeedToAlbumOptions = {}): Album {
  const source = feed.Track ?? [];

  /**
   * The identity fields below come from the DB order, NOT from the list after
   * `newestFirst` re-sorts it. All three call sites read `feed.Track[0]` today,
   * including the podcast branch that sorts afterwards — so deriving these from
   * the sorted list would quietly change which episode guid goes out in Helipad
   * TLV metadata for every podcast.
   */
  const identityTrack = source[0];

  let tracks = source;

  if (opts.dedupeTracks) {
    tracks = tracks.filter(
      (track, index, self) =>
        self.findIndex((t) => t.audioUrl === track.audioUrl && t.title === track.title) === index
    );
  }

  if (opts.newestFirst) {
    tracks = [...tracks].sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });
  }

  return {
    id: feed.id,
    title: feed.title,
    type: feed.type || opts.defaultType || 'album',
    artist: feed.artist || feed.title,
    description: feed.description || '',
    coverArt: feed.image || '',
    releaseDate: feed.oldestItemPubdate || feed.createdAt,
    dateAdded: feed.createdAt,
    feedUrl: feed.originalUrl, // For Helipad TLV
    feedGuid: feed.guid || null, // Real podcast:guid from RSS (for BoostBox feed_guid)
    feedId: feed.id, // Slug-based ID for URLs and Helipad TLV
    remoteFeedGuid: feed.guid || null, // Real podcast:guid (for BoostBox remote_feed_guid)
    // The first track's real <item> guid, or null — never `feed.id`.
    // These two fields reach `BoostButton`'s `episodeGuid` prop, which becomes
    // `podcast:item:guid:<...>` on a published boost note and the Helipad
    // `remote_item_guid`/`episode_guid` TLV. A StableKraft slug in either place
    // is an identifier only this app can resolve (#242). Same honesty as
    // `feedGuid`/`remoteFeedGuid` two lines up: absent is a real answer.
    guid: identityTrack?.guid || null, // Episode GUID for Helipad TLV
    episodeGuid: identityTrack?.guid || null, // Alternative field name
    link: feed.originalUrl, // For feedUrl fallback
    priority: feed.priority,
    tracks: tracks.map(trackToAlbumTrack),
    // Feed-level V4V is preferred; the first track is the fallback.
    v4vRecipient:
      feed.v4vRecipient ||
      (opts.v4vTrackFallback === false ? null : identityTrack?.v4vRecipient || null),
    v4vValue:
      feed.v4vValue ||
      (opts.v4vTrackFallback === false ? null : identityTrack?.v4vValue || null),
    persons: feed.persons || undefined,
    podcastImages: feed.podcastImages || undefined,
    // The real count; `tracks` above is capped by the select's `take`.
    trackCount: feed._count?.Track ?? 0,
  };
}
