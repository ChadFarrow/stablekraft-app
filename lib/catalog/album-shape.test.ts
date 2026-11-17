import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  feedToAlbum,
  trackToAlbumTrack,
  albumFeedSelect,
  ALBUM_TRACK_SELECT,
  EPISODE_TRACK_ORDER_BY,
  PLAYABLE_TRACK_WHERE,
  type AlbumSourceFeed,
  type AlbumSourceTrack,
} from './album-shape';

function track(over: Partial<AlbumSourceTrack> = {}): AlbumSourceTrack {
  return {
    id: 't1',
    guid: 'track-guid-1',
    title: 'Track One',
    duration: 240,
    audioUrl: 'https://example.com/1.mp3',
    image: 'https://example.com/1.jpg',
    publishedAt: new Date('2024-01-01T00:00:00Z'),
    v4vRecipient: null,
    v4vValue: null,
    startTime: null,
    endTime: null,
    trackOrder: 1,
    mediaType: 'audio',
    alternateEnclosures: null,
    ...over,
  };
}

function feed(over: Partial<AlbumSourceFeed> = {}): AlbumSourceFeed {
  return {
    id: 'feed-1',
    guid: 'feed-guid-1',
    title: 'An Album',
    description: 'desc',
    originalUrl: 'https://example.com/feed.xml',
    type: 'album',
    artist: 'An Artist',
    image: 'https://example.com/art.jpg',
    priority: 'normal',
    createdAt: new Date('2023-06-06T00:00:00Z'),
    oldestItemPubdate: new Date('2021-03-03T00:00:00Z'),
    v4vRecipient: null,
    v4vValue: null,
    Track: [track()],
    _count: { Track: 12 },
    ...over,
  };
}

// The bug this module exists to make impossible: app/publisher/[id]/page.tsx
// used `feed.lastFetched || feed.createdAt` — the last POLL time — so the same
// album showed a different year there than on the home grid.
test('releaseDate is the album release date, never the fetch time', () => {
  const album = feedToAlbum(feed());
  assert.deepEqual(album.releaseDate, new Date('2021-03-03T00:00:00Z'));
  assert.deepEqual(album.dateAdded, new Date('2023-06-06T00:00:00Z'));
});

test('releaseDate falls back to createdAt when oldestItemPubdate is null', () => {
  const album = feedToAlbum(feed({ oldestItemPubdate: null }));
  assert.deepEqual(album.releaseDate, new Date('2023-06-06T00:00:00Z'));
});

test('trackCount is the real count, not the capped tracks array', () => {
  const album = feedToAlbum(feed({ Track: [track()], _count: { Track: 57 } }));
  assert.equal(album.tracks.length, 1);
  assert.equal(album.trackCount, 57);
});

test('trackCount is 0 when _count is absent', () => {
  assert.equal(feedToAlbum(feed({ _count: null })).trackCount, 0);
  assert.equal(feedToAlbum(feed({ _count: undefined })).trackCount, 0);
});

// The catalog holds duplicate Track rows: DREAMS had 14 playable rows and 7
// tracks (2026-11-01). When every row arrived, the deduped list IS the count,
// and the album page shows the same 7. The row count would have put "14 tracks"
// on a card whose album page lists 7.
test('trackCount is the deduped length when every playable row arrived', () => {
  const rows = [
    track({ id: 'a1', audioUrl: 'https://example.com/a.mp3', title: 'A' }),
    track({ id: 'a2', audioUrl: 'https://example.com/a.mp3', title: 'A' }),
    track({ id: 'b1', audioUrl: 'https://example.com/b.mp3', title: 'B' }),
  ];
  const album = feedToAlbum(feed({ Track: rows, _count: { Track: 3 } }), { dedupeTracks: true });
  assert.equal(album.tracks.length, 2);
  assert.equal(album.trackCount, 2);
});

test('trackCount is the tracks length when every row arrived and nothing was deduped', () => {
  const rows = [track({ id: 'a' }), track({ id: 'b', audioUrl: 'https://example.com/b.mp3' })];
  assert.equal(feedToAlbum(feed({ Track: rows, _count: { Track: 2 } })).trackCount, 2);
});

// Cut at `take`, the row count is the only number available. It still counts a
// duplicate row twice — Trapped in London: 36 rows, 18 tracks — which is the
// known limit of a count Prisma cannot make distinct.
test('trackCount is the playable row count when the list was cut at take', () => {
  const rows = [
    track({ id: 'a1', audioUrl: 'https://example.com/a.mp3', title: 'A' }),
    track({ id: 'a2', audioUrl: 'https://example.com/a.mp3', title: 'A' }),
  ];
  const album = feedToAlbum(feed({ Track: rows, _count: { Track: 36 } }), { dedupeTracks: true });
  assert.equal(album.tracks.length, 1);
  assert.equal(album.trackCount, 36);
});

test('artist falls back to the title', () => {
  assert.equal(feedToAlbum(feed({ artist: null })).artist, 'An Album');
});

test('type defaults to album', () => {
  assert.equal(feedToAlbum(feed({ type: null })).type, 'album');
});

test('the Helipad TLV fields come from the first track, and are null otherwise', () => {
  const album = feedToAlbum(feed());
  assert.equal(album.guid, 'track-guid-1');
  assert.equal(album.episodeGuid, 'track-guid-1');
  assert.equal(album.feedGuid, 'feed-guid-1');
  assert.equal(album.remoteFeedGuid, 'feed-guid-1');

  // Never `feed.id`. A StableKraft slug published as `podcast:item:guid` is an
  // identifier only this app can resolve (#242), so absent is the real answer.
  const noTracks = feedToAlbum(feed({ Track: [] }));
  assert.equal(noTracks.guid, null, 'no track means no episode guid');
  assert.equal(noTracks.episodeGuid, null);
});

test('feed-level V4V wins over the first track, which is the fallback', () => {
  const feedLevel = feedToAlbum(feed({ v4vRecipient: 'feed@example.com' }));
  assert.equal(feedLevel.v4vRecipient, 'feed@example.com');

  const trackLevel = feedToAlbum(
    feed({ v4vRecipient: null, Track: [track({ v4vRecipient: 'track@example.com' })] })
  );
  assert.equal(trackLevel.v4vRecipient, 'track@example.com');

  assert.equal(feedToAlbum(feed({ Track: [] })).v4vRecipient, null);
});

test('dedupeTracks drops a repeat of the same url AND title', () => {
  const dup = [
    track({ id: 'a' }),
    track({ id: 'b' }), // identical url + title
    track({ id: 'c', title: 'Different', audioUrl: 'https://example.com/1.mp3' }),
    track({ id: 'd', title: 'Track One', audioUrl: 'https://example.com/2.mp3' }),
  ];
  assert.equal(feedToAlbum(feed({ Track: dup })).tracks.length, 4, 'off by default');
  const deduped = feedToAlbum(feed({ Track: dup }), { dedupeTracks: true });
  assert.equal(deduped.tracks.length, 3);
  assert.deepEqual(deduped.tracks.map((t) => t.id), ['a', 'c', 'd']);
});

test('newestFirst orders episodes by publishedAt descending', () => {
  const episodes = [
    track({ id: 'old', publishedAt: new Date('2020-01-01T00:00:00Z') }),
    track({ id: 'new', publishedAt: new Date('2026-01-01T00:00:00Z') }),
    track({ id: 'mid', publishedAt: new Date('2023-01-01T00:00:00Z') }),
  ];
  const album = feedToAlbum(feed({ Track: episodes }), { newestFirst: true });
  assert.deepEqual(album.tracks.map((t) => t.id), ['new', 'mid', 'old']);
});

test('newestFirst treats a null publishedAt as oldest', () => {
  const episodes = [
    track({ id: 'none', publishedAt: null }),
    track({ id: 'dated', publishedAt: new Date('2020-01-01T00:00:00Z') }),
  ];
  const album = feedToAlbum(feed({ Track: episodes }), { newestFirst: true });
  assert.deepEqual(album.tracks.map((t) => t.id), ['dated', 'none']);
});

test('duration falls back to 180 when a feed declares none', () => {
  assert.equal(trackToAlbumTrack(track({ duration: null })).duration, 180);
  assert.equal(trackToAlbumTrack(track({ duration: 0 })).duration, 180);
  assert.equal(trackToAlbumTrack(track({ duration: 300 })).duration, 300);
});

// The `filter=podcasts` branch of albums-fast omitted `take` entirely and
// loaded every episode of every podcast.
test('albumFeedSelect requires an explicit take', () => {
  const select = albumFeedSelect(20);
  assert.equal((select.Track as { take?: number }).take, 20);
  assert.deepEqual(select.Track.select, ALBUM_TRACK_SELECT);
});

// `_count` used to ask for `status: 'active'` alone, so it also counted rows
// with no audio URL, which the Track select drops. feedToAlbum compares the
// two to tell a capped list from a complete one, so they must count the same rows.
test('_count counts the same rows the Track select returns', () => {
  const select = albumFeedSelect(20);
  assert.deepEqual(select._count.select.Track.where, select.Track.where);
  assert.deepEqual(select._count.select.Track.where, PLAYABLE_TRACK_WHERE);
});

test("'unbounded' omits take, and says so rather than leaving it off silently", () => {
  const select = albumFeedSelect('unbounded');
  assert.equal('take' in select.Track, false);
});

test('the playable-track filter excludes empty audio urls and inactive rows', () => {
  const select = albumFeedSelect(5);
  assert.deepEqual(select.Track.where, { audioUrl: { not: '' }, status: 'active' });
});

test('the episode guid comes from the DB order, not the newestFirst re-sort', () => {
  // All three call sites read feed.Track[0] today, including the podcast branch
  // that sorts afterwards. Deriving it from the sorted list would change which
  // episode guid goes out in Helipad TLV metadata for every podcast.
  const episodes = [
    track({ id: 'oldest', guid: 'guid-oldest', publishedAt: new Date('2020-01-01T00:00:00Z') }),
    track({ id: 'newest', guid: 'guid-newest', publishedAt: new Date('2026-01-01T00:00:00Z') }),
  ];
  const album = feedToAlbum(feed({ Track: episodes }), { newestFirst: true });
  assert.deepEqual(album.tracks.map((t) => t.id), ['newest', 'oldest'], 'display order flips');
  assert.equal(album.guid, 'guid-oldest', 'but identity does not');
  assert.equal(album.episodeGuid, 'guid-oldest');
});

test('defaultType applies only when the feed declares none', () => {
  assert.equal(feedToAlbum(feed({ type: null }), { defaultType: 'podcast' }).type, 'podcast');
  assert.equal(feedToAlbum(feed({ type: 'album' }), { defaultType: 'podcast' }).type, 'album');
});

test('v4vTrackFallback:false reports only the feed value', () => {
  const f = feed({ v4vRecipient: null, Track: [track({ v4vRecipient: 'track@example.com' })] });
  assert.equal(feedToAlbum(f).v4vRecipient, 'track@example.com', 'default falls back');
  assert.equal(feedToAlbum(f, { v4vTrackFallback: false }).v4vRecipient, null);
  assert.equal(feedToAlbum(f, { v4vTrackFallback: false }).v4vValue, null);
});

test('dedupe does not disturb the identity track', () => {
  const dup = [track({ id: 'a', guid: 'guid-a' }), track({ id: 'b', guid: 'guid-b' })];
  const album = feedToAlbum(feed({ Track: dup }), { dedupeTracks: true });
  assert.equal(album.tracks.length, 1);
  assert.equal(album.guid, 'guid-a');
});

/**
 * The client caches `/api/albums-fast` in localStorage behind `API_VERSION`
 * (app/page.tsx). A field silently dropped from this shape is served from that
 * cache as missing data until someone bumps the version — so the key set is
 * part of the contract, not an implementation detail.
 */
test('the album key set is the API contract', () => {
  const expected = [
    'artist', 'coverArt', 'dateAdded', 'description', 'episodeGuid', 'feedGuid',
    'feedId', 'feedUrl', 'guid', 'id', 'link', 'persons', 'podcastImages',
    'priority', 'releaseDate', 'remoteFeedGuid', 'title', 'tracks', 'trackCount',
    'type', 'v4vRecipient', 'v4vValue',
  ].sort();
  assert.deepEqual(Object.keys(feedToAlbum(feed())).sort(), expected);
});

test('the track key set is the API contract', () => {
  const expected = [
    'alternateEnclosures', 'duration', 'guid', 'id',
    'image', 'mediaType', 'publishedAt', 'startTime',
    'endTime', 'title', 'url', 'v4vRecipient', 'v4vValue',
    'chaptersUrl', 'chapters', 'valueTimeSplits', 'persons',
  ].sort();
  assert.deepEqual(Object.keys(trackToAlbumTrack(track())).sort(), expected);
});

test('a null column is omitted from the WIRE, not merely set to null', () => {
  // The four playback fields are `|| undefined`, so `Object.keys` sees them
  // (the test above) but `JSON.stringify` does not. That is what made trimming
  // them measure as zero bytes saved at limit=50: for the mostly-null music
  // catalogue they were never on the wire to begin with.
  const wire = JSON.parse(JSON.stringify(trackToAlbumTrack(track())));
  for (const k of ['chaptersUrl', 'chapters', 'valueTimeSplits', 'persons']) {
    assert.ok(!(k in wire), `${k} should be absent from the wire when the column is null`);
  }
});

test('catalog track shape keeps what playback reads', () => {
  // REGRESSION GUARD. These four were trimmed from the catalog select on the
  // reasoning that `app/page.tsx` is the only consumer and drops them on
  // arrival. `app/radio/RadioClient.tsx` is a second consumer, and it hands the
  // RAW response to `setInitialAlbums`; `shuffleAllTracks` then carries those
  // exact track objects into playback, which reads all four:
  //
  //   valueTimeSplits  AudioContext — VTS playback and AutoBoost. Absent, a
  //                    segment boost pays the track-level recipient instead,
  //                    so the money goes to a different person.
  //   chaptersUrl      AudioContext — fetches /api/chapters.
  //   chapters         AudioContext — the pre-parsed fast path.
  //   persons          NowPlayingScreen — track-level credits.
  //
  // Trimming one of these is only safe once radio stops consuming this
  // endpoint raw. Follow it to contexts/AudioContext.tsx before you do.
  for (const field of ['valueTimeSplits', 'chaptersUrl', 'chapters', 'persons']) {
    assert.ok(
      field in ALBUM_TRACK_SELECT,
      `${field} was dropped from ALBUM_TRACK_SELECT — /radio reads it straight ` +
        `off this response, so dropping it breaks VTS boosts or chapters there`
    );
  }

  // And it must actually survive the mapper, not just the select.
  const rich = trackToAlbumTrack(
    track({
      valueTimeSplits: [{ startTime: 0, duration: 30 }],
      chaptersUrl: 'https://example.com/chapters.json',
      chapters: [{ startTime: 0, title: 'Intro' }],
      persons: [{ name: 'A Guest' }],
    })
  );
  assert.ok(Array.isArray(rich.valueTimeSplits), 'VTS must survive the mapper');
  assert.equal(rich.chaptersUrl, 'https://example.com/chapters.json');
  assert.ok(Array.isArray(rich.chapters), 'chapters must survive the mapper');
  assert.ok(Array.isArray(rich.persons), 'persons must survive the mapper');
});

test('track-level podcastImages stays out — nothing reads it', () => {
  // The one field of the five that IS safe to drop. The FEED-level
  // podcastImages is a different column and is still carried; AlbumCard reads
  // that one.
  assert.ok(!('podcastImages' in ALBUM_TRACK_SELECT));
  assert.ok(!('podcastImages' in trackToAlbumTrack(track())));
  assert.ok('podcastImages' in feedToAlbum(feed()));
});

// Track.publishedAt is nullable and PostgreSQL sorts NULLs FIRST on DESC, so
// without `nulls: 'last'` the `take: 20` on the podcast branch returns 20
// undated episodes and hides every dated one. The JavaScript sort this
// replaced mapped a null date to 0, so undated episodes used to go last.
test('episode ordering puts undated episodes last, not first', () => {
  assert.deepEqual(EPISODE_TRACK_ORDER_BY[0], {
    publishedAt: { sort: 'desc', nulls: 'last' },
  });
  assert.deepEqual(EPISODE_TRACK_ORDER_BY[1], { createdAt: 'desc' });
});
