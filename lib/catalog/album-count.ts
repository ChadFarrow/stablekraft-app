/**
 * How many tracks a card or a list row says an album has, and whether to call
 * them episodes. Dependency-free on purpose: AlbumCard and app/page.tsx import
 * it into the browser bundle.
 *
 * `/api/albums-fast` ships at most 20 tracks per feed (ALBUM_TRACK_LIMIT and
 * PODCAST_EPISODE_LIMIT) and states the real number in `trackCount` — see
 * `feedToAlbum` in ./album-shape.ts. So `tracks.length` is never the count on
 * its own: Homegrown Hits (158 episodes) showed "20 tracks" on the home grid
 * until 2026-11-01, because app/page.tsx dropped `trackCount` and every count
 * on that page read `tracks.length`.
 */
export interface CountableAlbum {
  trackCount?: number | null;
  totalTracks?: number | null;
  tracks?: readonly unknown[] | null;
  type?: string | null;
  isPodcast?: boolean | null;
}

/**
 * The server's count first, then the tracks the response carried, then
 * `totalTracks` (publisher entries, which carry no track list). 0 is unknown.
 */
export function albumTrackCount(album: CountableAlbum): number {
  return album.trackCount || album.tracks?.length || album.totalTracks || 0;
}

/**
 * A podcast feed counts episodes. `isPodcast` is set by the podcasts branch of
 * albums-fast and by the album page; `type` is the Feed row's own
 * classification, which is what the home grid keeps — it may not keep
 * `isPodcast`, because AlbumCard links an `isPodcast` album by title slug.
 */
export function isPodcastAlbum(album: CountableAlbum): boolean {
  return album.isPodcast === true || album.type === 'podcast';
}
