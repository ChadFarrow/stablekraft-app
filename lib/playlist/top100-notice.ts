/**
 * What the Top 100 page says when it has no tracks to show.
 *
 * The page reads Podcast Index's hourly chart, https://stats.podcastindex.org/v4vmusic.json.
 * That chart stopped updating on 2026-08-21 10:05 UTC and has answered `items: []`
 * since — its own page reads "Podcasting 2.0 Top 0 (Music) … as of: Friday the 21st".
 * The page then showed only "No tracks available in this playlist", which reads as
 * our fault. The notice names the source and the date instead.
 *
 * Import-free so the test loads it directly.
 */
export function top100EmptyNotice(itemCount: number, playableCount: number, timestampSec: number): string | undefined {
  if (playableCount > 0) return undefined;
  const when = Number.isFinite(timestampSec) && timestampSec > 0
    ? new Date(timestampSec * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  if (itemCount === 0) {
    return when
      ? `The Podcast Index Top 100 music chart has been empty since ${when}. Tracks will appear here when the chart updates again.`
      : 'The Podcast Index Top 100 music chart is empty right now. Tracks will appear here when the chart updates again.';
  }
  return `None of the ${itemCount} tracks on the Podcast Index Top 100 music chart could be matched to playable audio.`;
}
