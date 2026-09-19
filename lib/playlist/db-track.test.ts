/**
 * npx tsx --test lib/playlist/db-track.test.ts
 *
 * The playlist fast path published every track's ITEM guid as its `feedGuid`
 * (137 of 137 on ITDV). The playlist components hand that on as the boost's
 * `remoteFeedGuid`, so a boost from a playlist carried
 * `["i","podcast:guid:<item guid>"]` — a feed that does not exist, on a note
 * that cannot be taken back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { playlistTrackFromRow, type PlaylistTrackRow } from './db-track';

// A real ITDV track, read from production 2026-09-18: its Track.guid is the
// item guid, its Feed.guid the album's <podcast:guid>. The fast path used to
// return the first for both.
const ITEM_GUID = '5092dc27-2bee-4fe0-8483-2478ee0c0e64';
const FEED_GUID = '3197a0a6-4c7e-56ea-8469-cfb3ca0d3cdc';

function row(feedGuid: string | null, feed = true): PlaylistTrackRow {
  return {
    position: 4,
    episodeId: 'ep-episode-12',
    episodeTitle: null,
    Track: {
      id: `${FEED_GUID}-${ITEM_GUID}`,
      guid: ITEM_GUID,
      title: 'A Song',
      artist: null,
      album: null,
      audioUrl: 'https://example.com/a.mp3',
      duration: 200,
      publishedAt: null,
      image: null,
      v4vRecipient: null,
      v4vValue: null,
      Feed: feed
        ? { id: FEED_GUID, guid: feedGuid, title: 'The Album', artist: 'The Band', image: null }
        : null,
    },
  };
}

test('feedGuid is the feed guid, and itemGuid the item guid', () => {
  const track = playlistTrackFromRow(row(FEED_GUID), 0);
  assert.equal(track.feedGuid, FEED_GUID);
  assert.equal(track.itemGuid, ITEM_GUID);
  assert.equal(track.guid, ITEM_GUID);
  assert.notEqual(track.feedGuid, track.itemGuid);
});

test('a feed with no guid gives NO feedGuid, never the item guid in its place', () => {
  // Every consumer falls back to something real when it is absent; none of
  // them can tell a wrong one.
  assert.equal(playlistTrackFromRow(row(null), 0).feedGuid, undefined);
  assert.equal(playlistTrackFromRow(row(''), 0).feedGuid, undefined);
  assert.equal(playlistTrackFromRow(row(null, false), 0).feedGuid, undefined);
});

test('the rest of the row maps as before', () => {
  const track = playlistTrackFromRow(row(FEED_GUID), 7);
  assert.equal(track.index, 7);
  assert.equal(track.artist, 'The Band');
  assert.equal(track.album, 'The Album');
  assert.equal(track.episodeTitle, 'episode 12');
  assert.deepEqual(track.playlistContext, { episodeTitle: 'episode 12', itemGuid: ITEM_GUID, position: 4 });
});
