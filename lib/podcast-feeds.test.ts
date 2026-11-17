import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPodcastFeed, sortEpisodesNewestFirst } from './podcast-feeds';

// Rollz Radio (2026-11-01): type 'podcast' in the database, on the Podcasts
// tab, and not on the hand-kept list — so its album page sorted it as a music
// album, by trackOrder.
test('a feed whose own type is podcast is a podcast', () => {
  assert.equal(
    isPodcastFeed({ id: '8f2eb0c0-3627-59cf-85fc-4e252ddb6954', type: 'podcast', originalUrl: 'https://anchor.fm/s/112e62b80/podcast/rss' }),
    true
  );
});

test('the hand-kept list still counts, by id, guid or url, whatever the type says', () => {
  assert.equal(isPodcastFeed({ id: 'homegrown-hits-1768079163338', type: 'album' }), true);
  assert.equal(isPodcastFeed({ id: 'x', guid: '469b403f-db2d-574c-9db9-96dbb3f6561c', type: 'album' }), true);
  assert.equal(isPodcastFeed({ id: 'x', originalUrl: 'https://feed.homegrownhits.xyz/feed.xml', type: 'album' }), true);
});

test('an album is not a podcast', () => {
  assert.equal(isPodcastFeed({ id: 'some-album', type: 'album', originalUrl: 'https://wavlake.com/feed/music/x' }), false);
  assert.equal(isPodcastFeed({ id: 'some-album' }), false);
  assert.equal(isPodcastFeed({ id: 'some-album', guid: null, originalUrl: null, type: null }), false);
});

// The order the album page showed: 008 and 009 carry no <itunes:season>, so
// their trackOrder (season*1000 + episode) was 8 and 9, ahead of 1001–1014.
const ROLLZ_BY_TRACK_ORDER = [
  ['008', '2026-08-10'], ['009', '2026-08-20'], ['001', '2026-05-22'], ['002', '2026-05-29'],
  ['003', '2026-06-16'], ['004', '2026-06-22'], ['005', '2026-06-30'], ['006', '2026-07-14'],
  ['007', '2026-07-25'], ['010', '2026-09-04'], ['011', '2026-09-21'], ['012', '2026-09-29'],
  ['013', '2026-10-15'], ['014', '2026-10-21'],
].map(([title, date]) => ({ title, publishedAt: new Date(`${date}T12:00:00Z`) }));

test('episodes sort newest first by publish date, whatever their trackOrder', () => {
  const sorted = sortEpisodesNewestFirst(ROLLZ_BY_TRACK_ORDER);
  assert.deepEqual(sorted.map((t) => t.title), ['014', '013', '012', '011', '010', '009', '008', '007', '006', '005', '004', '003', '002', '001']);
});

test('the sort does not reorder the array it was given', () => {
  const input = ROLLZ_BY_TRACK_ORDER.slice();
  sortEpisodesNewestFirst(input);
  assert.deepEqual(input, ROLLZ_BY_TRACK_ORDER);
});

test('an episode with no date goes last, and string dates sort too', () => {
  const sorted = sortEpisodesNewestFirst([
    { title: 'undated', publishedAt: null },
    { title: 'old', publishedAt: '2020-01-01T00:00:00Z' },
    { title: 'new', publishedAt: '2026-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(sorted.map((t) => t.title), ['new', 'old', 'undated']);
});

// The album route builds the album in TWO places (an exact match and a flexible
// title match). The second never sorted podcasts or set isPodcast at all.
test('both album paths in /api/albums/[slug] ask isPodcastFeed and sort with it', () => {
  const source = readFileSync(join(process.cwd(), 'app/api/albums/[slug]/route.ts'), 'utf8');
  assert.doesNotMatch(source, /PODCAST_FEED_IDS\.includes|PODCAST_FEED_URLS\.includes/, 'a second copy of the podcast check');
  assert.equal(source.match(/= isPodcastFeed\(feed\)/g)?.length, 2, 'each album path decides isPodcast once');
  assert.equal(source.match(/sortEpisodesNewestFirst\(/g)?.length, 2, 'each album path sorts podcast episodes');
  assert.equal(source.match(/isPodcast: asPodcast \|\| undefined/g)?.length, 2, 'each album object carries isPodcast');
});
