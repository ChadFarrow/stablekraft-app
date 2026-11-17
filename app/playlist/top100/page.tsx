import { redirect } from 'next/navigation';

/**
 * The Top 100 playlist is gone (2026-11-01). It read Podcast Index's hourly chart,
 * https://stats.podcastindex.org/v4vmusic.json, which has returned `items: []` since
 * 2026-08-21, so the page could only ever say "Top 0". Old links and search results
 * land on the playlists tab instead.
 *
 * A temporary redirect (307) on purpose: a browser caches a 308 indefinitely, which
 * would keep sending people away if the chart comes back and the page with it.
 */
export default function Top100PlaylistPage() {
  redirect('/?filter=playlist');
}
