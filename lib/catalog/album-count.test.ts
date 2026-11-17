import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { albumTrackCount, isPodcastAlbum } from './album-count';

const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}` }));

// The bug: albums-fast ships at most 20 tracks per feed, and every card on the
// home grid counted `tracks`, so Homegrown Hits (158 episodes) said "20 tracks".
test('trackCount beats a tracks list cut at the select take', () => {
  assert.equal(albumTrackCount({ trackCount: 158, tracks: twenty }), 158);
});

test('the tracks length is the count when trackCount is missing or 0', () => {
  assert.equal(albumTrackCount({ tracks: twenty.slice(0, 7) }), 7);
  assert.equal(albumTrackCount({ trackCount: 0, tracks: twenty.slice(0, 7) }), 7);
  assert.equal(albumTrackCount({ trackCount: null, tracks: twenty.slice(0, 7) }), 7);
});

// Publisher entries on the home page carry totalTracks and no track list.
test('totalTracks is the last fallback, for entries with no track list', () => {
  assert.equal(albumTrackCount({ totalTracks: 42, tracks: [] }), 42);
  assert.equal(albumTrackCount({ totalTracks: 42 }), 42);
});

test('an album with nothing to count is 0', () => {
  assert.equal(albumTrackCount({}), 0);
  assert.equal(albumTrackCount({ tracks: null }), 0);
});

test('isPodcastAlbum reads the isPodcast flag or the podcast feed type', () => {
  assert.equal(isPodcastAlbum({ isPodcast: true }), true);
  assert.equal(isPodcastAlbum({ type: 'podcast' }), true);
  assert.equal(isPodcastAlbum({ type: 'album' }), false);
  assert.equal(isPodcastAlbum({ isPodcast: false, type: 'album' }), false);
  assert.equal(isPodcastAlbum({}), false);
});

// app/page.tsx copies each albums-fast album field by field. It dropped
// trackCount, so the card fell back to the 20 shipped tracks. It must not pass
// isPodcast: AlbumCard turns that into a /podcast/<title-slug> link, and the
// grid links podcasts by id on purpose (catalog-display, "Album links").
test('the app/page.tsx albums mapper keeps trackCount and type, and not isPodcast', () => {
  const source = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
  const start = source.indexOf('allAlbums.map((album: any): RSSAlbum => ({');
  assert.notEqual(start, -1, 'could not find the albums mapper — the scan has lost its anchor');
  const end = source.indexOf('} as RSSAlbum));', start);
  assert.notEqual(end, -1, 'could not find the end of the albums mapper');
  const mapper = source.slice(start, end);
  assert.match(mapper, /\btrackCount: album\.trackCount\b/, 'the mapper drops trackCount — bump API_VERSION when restoring it');
  assert.match(mapper, /\btype: album\.type\b/, 'the mapper drops type, so podcast cards say "tracks"');
  assert.doesNotMatch(mapper, /\bisPodcast\s*:|\.\.\.album\b/, 'isPodcast changes every podcast card link to a title slug');
});

// Every count on the home page goes through albumTrackCount, or a list row or
// a sort reads the capped tracks list again.
test('app/page.tsx counts tracks only through albumTrackCount', () => {
  const source = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /\.tracks\?\.length \|\| [a-zA-Z]+\.totalTracks/);
});
