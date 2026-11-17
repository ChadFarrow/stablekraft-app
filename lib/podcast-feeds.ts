/**
 * Curated list of podcast feeds to show under the "Podcasts" filter.
 * These are source podcasts (music discovery shows) that are normally
 * blacklisted from the album view. Add new podcast feeds here.
 */
export const PODCAST_FEED_IDS: string[] = [
  '3aebb7a8-5942-5ee7-a148-8bdc14f1f3d4', // Upbeats
  'silvie-two-for-tunestr',                // Two For Tunestr
  'boo-bury-before-the-sch3m3s',           // Before The Sch3m3s (B4TS)
  'lightning-thrashes-1768079468212',      // Lightning Thrashes
  'album-1774815386168-ixuyfdy36',         // Mutton, Mead & Music (MMM)
  'kyle-m-bondo-flowgnar',                 // Flowgnar
  '469b403f-db2d-574c-9db9-96dbb3f6561c',  // It's A Mood
  'kevin-bae-sats-and-sounds',             // Sats and Sounds
  'homegrown-hits-1768079163338',          // Homegrown Hits
];

export const PODCAST_FEED_URLS: string[] = [
  'https://serve.podhome.fm/rss/3aebb7a8-5942-5ee7-a148-8bdc14f1f3d4', // Upbeats
  'https://serve.podhome.fm/rss/fafd2bfc-98ac-5010-9fcb-7403abfd420a', // Two For Tunestr
  'https://music.behindthesch3m3s.com/b4ts%20feed/feed.xml',           // Before The Sch3m3s (B4TS)
  'https://sirlibre.com/lightning-thrashes-rss.xml',                   // Lightning Thrashes
  'https://mmmusic.show/podcast/feed.xml',                             // Mutton, Mead & Music (MMM)
  'https://feeds.oncetold.net/80000060',                               // Flowgnar
  'https://itsamood.org/itsamoodrss.xml',                              // It's A Mood
  'https://satsandsounds.com/saspodcast.xml',                          // Sats and Sounds
  'https://feed.homegrownhits.xyz/feed.xml',                           // Homegrown Hits
];

/** Slugs that should redirect from /album/ to /podcast/ */
export const PODCAST_SLUGS: string[] = [
  'upbeats',                               // Upbeats (canonical)
  '3aebb7a8-5942-5ee7-a148-8bdc14f1f3d4',  // Upbeats (DB ID)
  'two-for-tunestr',                       // Two For Tunestr (canonical)
  'silvie-two-for-tunestr',                // Two For Tunestr (DB ID)
  'before-the-sch3m3s',                    // B4TS (canonical)
  'boo-bury-before-the-sch3m3s',           // B4TS (DB ID)
  'lightning-thrashes',                    // Lightning Thrashes (canonical)
  'lightning-thrashes-1768079468212',      // Lightning Thrashes (DB ID)
  'mutton-mead-and-music',                 // MMM (canonical) — /playlist/mmm owns the music playlist
  'album-1774815386168-ixuyfdy36',         // MMM (DB ID)
  'flowgnar-show',                         // Flowgnar (canonical) — /playlist/flowgnar owns the music playlist
  'kyle-m-bondo-flowgnar',                 // Flowgnar (DB ID)
  'its-a-mood',                            // It's A Mood (canonical) — /playlist/iam owns the music playlist
  '469b403f-db2d-574c-9db9-96dbb3f6561c',  // It's A Mood (DB ID, podcast:guid)
  'sats-and-sounds',                       // Sats and Sounds (canonical) — /playlist/sas owns the music playlist
  'kevin-bae-sats-and-sounds',             // Sats and Sounds (DB ID)
  'homegrown-hits',                        // Homegrown Hits (canonical) — /playlist/hgh owns the music playlist
  'homegrown-hits-1768079163338',          // Homegrown Hits (DB ID)
];

/** Map slug to DB feed ID (when slug differs from feed ID) */
export const PODCAST_SLUG_TO_FEED_ID: Record<string, string> = {
  'two-for-tunestr': 'silvie-two-for-tunestr',
  'before-the-sch3m3s': 'boo-bury-before-the-sch3m3s',
  'lightning-thrashes': 'lightning-thrashes-1768079468212',
  'mutton-mead-and-music': 'album-1774815386168-ixuyfdy36',
  'flowgnar-show': 'kyle-m-bondo-flowgnar',
  'its-a-mood': '469b403f-db2d-574c-9db9-96dbb3f6561c',
  'sats-and-sounds': 'kevin-bae-sats-and-sounds',
  'homegrown-hits': 'homegrown-hits-1768079163338',
};

/** Map DB feed ID to canonical slug (for redirects) */
export const PODCAST_CANONICAL_SLUGS: Record<string, string> = {
  '3aebb7a8-5942-5ee7-a148-8bdc14f1f3d4': 'upbeats',
  'silvie-two-for-tunestr': 'two-for-tunestr',
  'boo-bury-before-the-sch3m3s': 'before-the-sch3m3s',
  'lightning-thrashes-1768079468212': 'lightning-thrashes',
  'album-1774815386168-ixuyfdy36': 'mutton-mead-and-music',
  'kyle-m-bondo-flowgnar': 'flowgnar-show',
  '469b403f-db2d-574c-9db9-96dbb3f6561c': 'its-a-mood',
  'kevin-bae-sats-and-sounds': 'sats-and-sounds',
  'homegrown-hits-1768079163338': 'homegrown-hits',
};

/**
 * Whether the album page treats a feed as a podcast: episodes newest first,
 * their dates, "Episodes" and "About this podcast".
 *
 * The Feed row's own `type` decides first. The hand-kept lists above used to be
 * the ONLY test, so a podcast the app had classified correctly but nobody had
 * listed was sorted as a music album: Rollz Radio (2026-11-01) is `type =
 * 'podcast'` and on the Podcasts tab, and its album page listed episodes by
 * trackOrder — 008, 009, 001…007, 010…014, because 008 and 009 carry no
 * <itunes:season> and trackOrder is season*1000 + episode. `type` is this
 * app's classification, which is what local display behaviour should read
 * (CLAUDE.md, "Feed.type is this app's classification").
 *
 * The lists still count: a curated podcast stays one whatever its row says.
 */
export function isPodcastFeed(feed: {
  id: string;
  guid?: string | null;
  originalUrl?: string | null;
  type?: string | null;
}): boolean {
  return (
    feed.type === 'podcast' ||
    PODCAST_FEED_IDS.includes(feed.id) ||
    (!!feed.guid && PODCAST_FEED_IDS.includes(feed.guid)) ||
    (!!feed.originalUrl && PODCAST_FEED_URLS.includes(feed.originalUrl))
  );
}

/** A copy of `episodes`, newest `publishedAt` first; an undated episode goes last. */
export function sortEpisodesNewestFirst<T extends { publishedAt?: Date | string | null }>(episodes: readonly T[]): T[] {
  const time = (t: T) => (t.publishedAt ? new Date(t.publishedAt).getTime() : 0);
  return [...episodes].sort((a, b) => time(b) - time(a));
}
