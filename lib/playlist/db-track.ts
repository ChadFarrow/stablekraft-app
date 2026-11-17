/**
 * One playlist track as the database fast path returns it
 * (`getPlaylistFromDatabase` in ./resolver.ts).
 *
 * Its own module, with no `@/lib/prisma` import, so the mapping is testable
 * without a database: `lib/playlist/db-track.test.ts`.
 *
 * `feedGuid` is the track's FEED guid — `Feed.guid`, the `<podcast:guid>` of the
 * album the song lives in. It was `Track.guid`, the item guid, for every track
 * (137 of 137 on ITDV), and the playlist components pass it on as the boost's
 * `remoteFeedGuid`, the "Copy album link" target and the favorite's
 * `feedGuidForImport`. So a playlist boost published
 * `["i","podcast:guid:<item guid>"]`, naming a feed that does not exist, in a
 * note that cannot be corrected once it is on the relays. A feed with no guid
 * gives NO feedGuid rather than a stand-in: the consumers all fall back to
 * something real when it is absent, and none of them can tell a wrong one.
 */

export interface PlaylistTrackRow {
  position: number;
  episodeId: string | null;
  episodeTitle: string | null;
  Track: {
    id: string;
    guid: string | null;
    title: string;
    artist: string | null;
    album: string | null;
    audioUrl: string;
    duration: number | null;
    publishedAt: Date | null;
    image: string | null;
    v4vRecipient: string | null;
    v4vValue: unknown;
    chaptersUrl?: string | null;
    chapters?: unknown;
    valueTimeSplits?: unknown;
    Feed: {
      id: string;
      guid: string | null;
      title: string;
      artist: string | null;
      image: string | null;
    } | null;
  };
}

/** A stored episode title, or one recovered from its `ep-` id. */
function episodeIdToTitle(epId: string | null): string {
  if (!epId) return '';
  return epId.replace('ep-', '').replace(/-/g, ' ');
}

export function playlistTrackFromRow(pt: PlaylistTrackRow, index: number) {
  const title = pt.episodeTitle || episodeIdToTitle(pt.episodeId);
  return {
    id: pt.Track.id,
    title: pt.Track.title,
    artist: pt.Track.artist || pt.Track.Feed?.artist || 'Unknown Artist',
    album: pt.Track.album || pt.Track.Feed?.title || 'Unknown Album',
    audioUrl: pt.Track.audioUrl,
    duration: pt.Track.duration || 0,
    image: pt.Track.image || pt.Track.Feed?.image,
    publishedAt: pt.Track.publishedAt?.toISOString(),
    v4vRecipient: pt.Track.v4vRecipient,
    v4vValue: pt.Track.v4vValue,
    chaptersUrl: pt.Track.chaptersUrl || undefined,
    chapters: pt.Track.chapters || undefined,
    valueTimeSplits: pt.Track.valueTimeSplits || undefined,
    feedGuid: pt.Track.Feed?.guid || undefined,
    itemGuid: pt.Track.guid,
    guid: pt.Track.guid,
    index,
    episodeId: pt.episodeId,
    episodeTitle: title,
    playlistContext: {
      episodeTitle: title,
      itemGuid: pt.Track.guid,
      position: pt.position
    }
  };
}
