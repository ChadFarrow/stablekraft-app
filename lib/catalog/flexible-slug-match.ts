/**
 * The last-resort album lookup behind `/api/albums/[slug]`: which active feed, if
 * any, a slug that missed every indexed lookup still names.
 *
 * WHY this is a pure function over a few columns: the route used to answer it by
 * reading EVERY active feed with ALL of its tracks (`include: trackInclude`) —
 * 33.2 MB and 3.4 s per call, measured on production 2026-09-26 (4,376 feeds,
 * 15,125 tracks) — only to compare titles and guids and count tracks. Every slug
 * that matches nothing reaches this step, and crawlers send plenty of those: a
 * bad `/album/...` URL makes the page's own metadata and Open Graph fetches ask
 * twice more. From 2026-09-19 to 2026-09-26 that was 368 misses and ~12 GB — about
 * three quarters of the separate database project's billed egress (issue #272).
 * The route now reads `id`, `title`, `guid` and a playable-track count (0.59 MB),
 * picks here, and loads the full rows of the winner alone.
 *
 * The rules are the route's, unchanged: every comparison it made, a feed with no
 * playable track skipped, the most tracks winning, and the first of equal counts
 * kept (as its `reduce` did).
 */

export interface SlugCandidate {
  id: string;
  title: string;
  guid: string | null;
  /** Tracks with a non-empty `audioUrl` — the count `trackInclude` would load. */
  trackCount: number;
}

export function pickFlexibleSlugMatch<T extends SlugCandidate>(candidates: T[], slug: string): T | null {
  const searchSlug = slug.toLowerCase();
  const decodedSlug = decodeURIComponent(searchSlug);
  const titleFromSlug = decodedSlug.replace(/-/g, ' ');

  let best: T | null = null;
  for (const feed of candidates) {
    if (feed.trackCount === 0) continue;

    const albumTitleLower = feed.title.toLowerCase();
    const matches = [
      albumTitleLower === searchSlug,
      albumTitleLower === decodedSlug,
      albumTitleLower === titleFromSlug,
      albumTitleLower.replace(/\s+/g, '-') === searchSlug,
      albumTitleLower.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-') === searchSlug,
      searchSlug.length > 5 && albumTitleLower.includes(searchSlug),
      titleFromSlug.length > 5 && albumTitleLower.includes(titleFromSlug),
      feed.guid === slug, // Podcast Index GUID match
      feed.guid?.toLowerCase() === searchSlug, // Case-insensitive GUID match
    ];

    if (matches.some((match) => match) && (best === null || feed.trackCount > best.trackCount)) {
      best = feed;
    }
  }
  return best;
}
