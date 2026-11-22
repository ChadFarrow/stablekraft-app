// The d-tag resolution ladder's pure pick logic.
// Repo has NO jest/vitest — node:test + tsx is the pattern.
//   npx tsx --test lib/nostr/favorite-item-lookup.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import { pickFavoriteMatches, type TrackRow, type FeedRow } from './favorite-item-lookup';

const feed = (id: string): FeedRow => ({
  id,
  title: id,
  artist: null,
  image: null,
  type: 'album',
  originalUrl: `https://example.com/${id}`,
  markedDead: false,
  blocked: false,
  _count: { Track: 3 },
  Track: [],
});

const track = (id: string): TrackRow => ({
  id,
  title: id,
  artist: null,
  image: null,
  duration: null,
  feedId: 'feed-1',
  Feed: null,
});

test('rung 1: a Track.id resolves as a track', () => {
  const out = pickFavoriteMatches(['t1'], {
    tracksById: new Map([['t1', track('t1')]]),
    feedsById: new Map(),
    tracksByGuid: new Map(),
  });
  assert.equal(out.get('t1')?.kind, 'track');
  assert.equal(out.get('t1')?.matchedVia, 'track-id');
});

test('rung 2: a Feed.id resolves as an album', () => {
  const out = pickFavoriteMatches(['f1'], {
    tracksById: new Map(),
    feedsById: new Map([['f1', feed('f1')]]),
    tracksByGuid: new Map(),
  });
  assert.equal(out.get('f1')?.kind, 'album');
  assert.equal(out.get('f1')?.matchedVia, 'feed-id');
});

// The rung that was missing — 69 of 121 community favorites store a track guid.
test('rung 3: a Track.guid resolves as a track', () => {
  const out = pickFavoriteMatches(['g1'], {
    tracksById: new Map(),
    feedsById: new Map(),
    tracksByGuid: new Map([['g1', track('real-track-id')]]),
  });
  assert.equal(out.get('g1')?.kind, 'track');
  assert.equal(out.get('g1')?.matchedVia, 'track-guid');
});

test('order is load-bearing: Track.id beats Feed.id and Track.guid', () => {
  const out = pickFavoriteMatches(['x'], {
    tracksById: new Map([['x', track('by-id')]]),
    feedsById: new Map([['x', feed('x')]]),
    tracksByGuid: new Map([['x', track('by-guid')]]),
  });
  const match = out.get('x');
  assert.equal(match?.matchedVia, 'track-id');
  assert.equal(match?.kind === 'track' && match.track.id, 'by-id');
});

test('Feed.id beats Track.guid', () => {
  const out = pickFavoriteMatches(['x'], {
    tracksById: new Map(),
    feedsById: new Map([['x', feed('x')]]),
    tracksByGuid: new Map([['x', track('by-guid')]]),
  });
  assert.equal(out.get('x')?.matchedVia, 'feed-id');
});

test('an unresolvable d-tag is simply absent', () => {
  const out = pickFavoriteMatches(['bookmark', 't1'], {
    tracksById: new Map([['t1', track('t1')]]),
    feedsById: new Map(),
    tracksByGuid: new Map(),
  });
  assert.equal(out.has('bookmark'), false);
  assert.equal(out.size, 1);
});

test('resolves a mixed batch in one pass', () => {
  const out = pickFavoriteMatches(['t1', 'f1', 'g1', 'nope'], {
    tracksById: new Map([['t1', track('t1')]]),
    feedsById: new Map([['f1', feed('f1')]]),
    tracksByGuid: new Map([['g1', track('t9')]]),
  });
  assert.equal(out.size, 3);
  assert.deepEqual(
    ['t1', 'f1', 'g1'].map((d) => out.get(d)?.matchedVia),
    ['track-id', 'feed-id', 'track-guid']
  );
});
