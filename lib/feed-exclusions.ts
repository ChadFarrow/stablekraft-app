import { buildFeedUrlLooseVariants } from './url-utils';

// Feed IDs that should never be imported or displayed
export const BLACKLISTED_FEED_IDS = [
  'lnurl-testing-podcast',
  'lnurl-test-feed',
  'podtards-test',
  'bitpunkfm-unwound',
  'bitpunk-fm-unwound-1768079479444',  // bitpunk.fm unwound podcast
  'album-1774815395173-2v8ktsh5s',     // No Agenda Show — talk podcast, not music
  // Phantom Power Business Hour — talk podcast with medium=music; without the
  // ban the 4 AM cron re-mints it from PI artist search every time it's deleted
  'phantom-power-music-phantom-power-business-hour',
  // Ainsley Costello Live — old test feed (6s audio.blank.mp3 placeholder).
  // Linked to the (non-musicShowOnly) Ainsley Costello publisher, so Step 5b
  // re-mints it nightly unless banned.
  '38ae1424-20b4-5478-a847-670734fcfb80',
  // Phantom Power Music publisher cleanup — both feeds back the artist-slug
  // /publisher/phantom-power-music page and are non-music Phantom Power content.
  '9a8ab3f7-3a8d-51cc-8a02-c17ce892ab40',  // Phantom Power Music Review — talk podcast, not music
  '329ef973-3d68-51cd-bb0d-d4a9e35027a7',  // "Artist Night w/ Blue House Band" — 36s trailer test feed
];

// Feed URLs that should never be imported
export const BLACKLISTED_FEED_URLS = [
  'https://zine.bitpunk.fm/feeds/unwound.xml',
  'https://zine.bitpunk.fm/feeds/bitpunk-fm.xml',
  'http://feed.nashownotes.com/rss.xml',  // No Agenda Show
  // Henrik Flyman pulled all his music off Wavlake and self-hosts at
  // henrikflyman.com. Every Wavlake mirror is 404 upstream and must stay
  // banned everywhere (album grid, search, /api/feeds/exists,
  // process-remote-items, Step 5b auto-import, and the /publisher/[id] page)
  // so the 4 AM cron can't re-mint them from PI API artist search and any
  // lingering DB rows can't surface on the artist's publisher page.
  'https://wavlake.com/feed/music/9a5340e4-50ca-48c3-9b06-3f6b782b5131',  // A Song For The Voiceless
  'https://wavlake.com/feed/music/9a218bec-4411-4f93-9caa-f3f84e4ef5f0',  // Authority
  'https://wavlake.com/feed/music/26822e8f-cc32-4f7b-b760-720cbe2455ff',  // Thorns
  'https://wavlake.com/feed/music/cca74ee8-67f8-434b-a386-8417e304cdf0',  // Time Waits For No One
  'https://wavlake.com/feed/music/b7f701d7-5499-48be-8394-fcd633c649bb',  // Dancing With A Ghost
  'https://wavlake.com/feed/music/e0c852e7-a118-46b0-a751-4e42ed6e0b6c',  // Shadowbanned
  'https://anchor.fm/s/1125b8ad4/podcast/rss',  // Unknown podcast — auto-imported without authorization
  'https://epochradio.com/feed/phantom-power-business-hour',  // Phantom Power Business Hour — talk podcast, not music
  'https://epochradio.com/feed/ainsley-costello-live',  // Ainsley Costello Live — old test feed (blank placeholder audio)
  'https://epochradio.com/feed/phantom-power-music-review',  // Phantom Power Music Review — talk podcast, not music
  'https://feeds.rssblue.com/artist-night-blue-house-band',  // "Artist Night w/ Blue House Band" — 36s trailer test feed
];

// Feed URLs that back a curated playlist. Not blacklisted (admin can add them as
// standalone podcasts), but playlist refresh must NOT auto-create feed records
// for them — otherwise every source podcast would silently appear on the site.
// Only admin-initiated imports should populate these.
export const PLAYLIST_SOURCE_FEED_URLS = [
  'https://music.behindthesch3m3s.com/b4ts%20feed/feed.xml',  // B4TS
  'https://mmmusic-project.ams3.cdn.digitaloceanspaces.com/Mutton_Mead__Music/feed.xml',  // MMM (legacy host)
  'https://mmmusic.show/podcast/feed.xml',  // MMM (current host)
  'https://feed.homegrownhits.xyz/feed.xml',  // HGH
  'https://sirlibre.com/lightning-thrashes-rss.xml',  // LT
  'https://serve.podhome.fm/rss/3aebb7a8-5942-5ee7-a148-8bdc14f1f3d4',  // Upbeats
  'https://itsamood.org/itsamoodrss.xml',  // IAM
  'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',  // ITDV
  'https://serve.podhome.fm/rss/fafd2bfc-98ac-5010-9fcb-7403abfd420a',  // Two For Tunestr
  'https://serve.podhome.fm/rss/de0bcde8-964b-4d71-9280-85d0ca2682c8',  // The OnlyBoosts Social Hour
];

// Henrik Flyman pulled ALL his music off Wavlake and self-hosts at
// henrikflyman.com, but Wavlake keeps surfacing brand-new mirror feeds for him
// (e.g. the 2026 "Unbreakable" / "Is This The End" / "The Writing's on the Wall"
// / "They Intend to Destroy Beauty" releases). Chasing each new
// wavlake.com/feed/music/<uuid> URL in BLACKLISTED_FEED_URLS doesn't scale, so
// this artist-scoped rule bans ANY wavlake.com feed whose artist is Henrik
// Flyman — current and future. It is deliberately narrow: it does NOT hide
// other artists' legitimate cross-platform Wavlake albums (see the publisher
// page's cross-platform warning). Applied everywhere a dead feed should be
// hidden: album grid (albums-fast), "New" (feeds/recent), search, the
// /publisher/[id] page, and the Step 5b publisher-album cron (skips re-mint).
// The feed rows stay in the DB — this is a "flag as dead", not a delete.
export function isHenrikFlymanWavlakeMirror(entry: {
  artist?: string | null;
  feedUrl?: string | null;
}): boolean {
  const artist = (entry.artist || '').toLowerCase().trim();
  const feedUrl = (entry.feedUrl || '').toLowerCase();
  return artist === 'henrik flyman' && feedUrl.includes('wavlake.com');
}

// Compared case- and encoding-insensitively, matching the loose rung in lib/feed-lookup.ts
// — the two must agree, or a URL can be un-findable as an existing feed yet still not
// recognized as blacklisted. `normalizeUrl` lowercases the hostname but leaves path/query
// casing alone and encodes literal spaces to %20, so an exact-string compare let both a
// case variant and an encoding variant of a banned URL slip past /api/feeds/exists and the
// POST /api/feeds 403. Expanding both sides means either stored form matches either query
// form.
function comparableUrlSet(urls: string[]): Set<string> {
  return new Set(urls.flatMap(url => buildFeedUrlLooseVariants(url).map(v => v.toLowerCase())));
}

const comparableBlacklistedUrls = comparableUrlSet(BLACKLISTED_FEED_URLS);
const comparablePlaylistSourceUrls = comparableUrlSet(PLAYLIST_SOURCE_FEED_URLS);

function matchesComparableUrl(url: string, comparable: Set<string>): boolean {
  return buildFeedUrlLooseVariants(url).some(variant => comparable.has(variant.toLowerCase()));
}

export function isBlacklistedFeedId(id: string): boolean {
  return BLACKLISTED_FEED_IDS.includes(id);
}

export function isBlacklistedFeedUrl(url: string): boolean {
  return matchesComparableUrl(url, comparableBlacklistedUrls);
}

export function isPlaylistSourceFeedUrl(url: string): boolean {
  return matchesComparableUrl(url, comparablePlaylistSourceUrls);
}

export function getBlacklistedFeedIds(): string[] {
  return [...BLACKLISTED_FEED_IDS];
}

// Bowl After Bowl is a podcast feed mis-imported as type='album' (slug
// /album/bowl-after-bowl) but its episodes are spoken-word podcast content.
// "Bowl Covers" (a derived music feed) is legitimate music — keep it.
// Used by both /api/albums-fast and /api/feeds/recent so the album grid
// stays free of the podcast.
export function isBowlAfterBowlPodcastEntry(entry: {
  id?: string | null;
  title?: string | null;
  artist?: string | null;
  feedUrl?: string | null;
}): boolean {
  const title = (entry.title || '').toLowerCase();
  const artist = (entry.artist || '').toLowerCase();
  const feedUrl = (entry.feedUrl || '').toLowerCase();

  // Always keep Bowl Covers (legitimate music content).
  if (entry.id === 'bowl-covers' || title.includes('bowl covers')) {
    return false;
  }

  return (
    (title.includes('bowl after bowl') && !title.includes('covers')) ||
    (artist.includes('bowl after bowl') && !title.includes('covers')) ||
    (feedUrl.includes('bowlafterbowl.com') && !title.includes('covers') && entry.id !== 'bowl-covers')
  );
}
