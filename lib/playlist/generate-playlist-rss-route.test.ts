/**
 * npx tsx --test lib/playlist/generate-playlist-rss-route.test.ts
 *
 * /api/generate-playlist-rss through the real route handlers. `fetch` is
 * stubbed (safeFetch reads the global at call time, and isSafePublicUrl does
 * no DNS) and MusicTrackParser.extractMusicTracks is replaced, so nothing
 * leaves the process — and each stub counts its calls, which is how these
 * tests see whether the route touched the source feed at all.
 *
 * Two faults from the #316 test report:
 * - a publisher feed GUID that is not a UUID threw inside the writer, and the
 *   POST answered 500 "Failed to generate playlist RSS";
 * - the guid check ran after the feed parse, so a refused guid waited ~23 s.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { MusicTrackParser } from '../music-track-parser';
import {
  BAD_PUBLISHER_GUID_ERROR,
  NO_GUID_ERROR,
  checkMinimalPlaylistIds,
} from './musicl-guid';

const GUID = '0190f3a2-7b1c-7cde-8f00-123456789abc';
const PUB = 'aaaaaaaa-0000-5000-8000-000000000000';
const SOURCE = 'https://feeds.example-show.com/show.xml';

const SOURCE_XML = `<?xml version="1.0"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
  <title>Show</title>
  <podcast:remoteItem feedGuid="f-1" itemGuid="i-1"/>
  <podcast:remoteItem feedGuid="f-2" itemGuid="i-2"/>
</channel></rss>`;

const realFetch = globalThis.fetch;
const realExtract = MusicTrackParser.extractMusicTracks;
const seen = { fetches: 0, parses: 0 };

beforeEach(() => {
  seen.fetches = 0;
  seen.parses = 0;
  globalThis.fetch = (async () => {
    seen.fetches += 1;
    return new Response(SOURCE_XML, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  }) as typeof fetch;
  MusicTrackParser.extractMusicTracks = (async () => {
    seen.parses += 1;
    throw new Error('the source feed must not be parsed in this test');
  }) as typeof MusicTrackParser.extractMusicTracks;
});

after(() => {
  globalThis.fetch = realFetch;
  MusicTrackParser.extractMusicTracks = realExtract;
});

async function post(body: unknown) {
  const { POST } = await import('../../app/api/generate-playlist-rss/route');
  return POST(
    new NextRequest('http://localhost:3000/api/generate-playlist-rss', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

async function get(query: string) {
  const { GET } = await import('../../app/api/generate-playlist-rss/route');
  return GET(new NextRequest(`http://localhost:3000/api/generate-playlist-rss?${query}`));
}

test('checkMinimalPlaylistIds: the playlist guid, then the publisher guid', () => {
  assert.deepEqual(checkMinimalPlaylistIds({ guid: 'my-playlist-123' }), {
    ok: false,
    field: 'guid',
    error: NO_GUID_ERROR,
  });
  assert.deepEqual(checkMinimalPlaylistIds({ guid: 12345 }), { ok: false, field: 'guid', error: NO_GUID_ERROR });
  assert.deepEqual(checkMinimalPlaylistIds({ guid: GUID, publisherFeedGuid: 'not-a-uuid' }), {
    ok: false,
    field: 'publisherFeedGuid',
    error: BAD_PUBLISHER_GUID_ERROR,
  });
  // The playlist guid is checked first: with both bad, the guid is named.
  assert.equal(
    (checkMinimalPlaylistIds({ guid: 'x', publisherFeedGuid: 'y' }) as { field: string }).field,
    'guid'
  );
  // An empty publisher guid is no back-link, as before — not an error.
  for (const empty of ['', '   ', null, undefined]) {
    assert.deepEqual(checkMinimalPlaylistIds({ guid: GUID, publisherFeedGuid: empty }), {
      ok: true,
      guid: GUID,
      publisher: null,
    });
  }
  assert.deepEqual(
    checkMinimalPlaylistIds({ guid: ` ${GUID.toUpperCase()} `, publisherFeedGuid: ` ${PUB} `, publisherFeedUrl: ' ' }),
    { ok: true, guid: GUID, publisher: { feedGuid: PUB, feedUrl: null } }
  );
});

test('POST: a publisher feed GUID that is not a UUID is a 400 naming the field, not a 500', async () => {
  for (const fast of [true, false]) {
    const res = await post({
      template: 'minimal',
      feedUrl: SOURCE,
      fast,
      overrides: { guid: GUID, publisherFeedGuid: 'my-publisher' },
    });
    assert.equal(res.status, 400, `fast=${fast}`);
    assert.deepEqual(await res.json(), { error: BAD_PUBLISHER_GUID_ERROR, field: 'publisherFeedGuid' });
  }
  assert.deepEqual(seen, { fetches: 0, parses: 0 }, 'refused before the source feed is read');
});

test('POST: a bad playlist guid is refused before the source feed is fetched or parsed', async () => {
  for (const fast of [true, false]) {
    const res = await post({ template: 'minimal', feedUrl: SOURCE, fast, overrides: { guid: 'my-playlist-123' } });
    assert.equal(res.status, 400, `fast=${fast}`);
    assert.deepEqual(await res.json(), { error: NO_GUID_ERROR, field: 'guid' });
  }
  assert.deepEqual(seen, { fetches: 0, parses: 0 });
});

test('GET: a bad playlist guid is refused before the source feed is parsed', async () => {
  const res = await get(`template=minimal&guid=my-playlist-123&feedUrl=${encodeURIComponent(SOURCE)}`);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: NO_GUID_ERROR, field: 'guid' });
  assert.deepEqual(seen, { fetches: 0, parses: 0 });
});

test('POST: a valid guid and publisher guid still build the feed', async () => {
  const res = await post({
    template: 'minimal',
    feedUrl: SOURCE,
    fast: true,
    overrides: { guid: GUID, publisherFeedGuid: PUB, publisherFeedUrl: 'https://p.example/pub.xml', title: 'T' },
  });
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.equal(seen.fetches, 1);
  assert.ok(xml.includes(`<podcast:guid>${GUID}</podcast:guid>`));
  assert.ok(xml.includes(`<podcast:remoteItem medium="publisher" feedGuid="${PUB}" feedUrl="https://p.example/pub.xml"/>`));
  assert.ok(xml.includes('<podcast:remoteItem feedGuid="f-1" itemGuid="i-1"/>'));
  assert.ok(xml.includes('<podcast:remoteItem feedGuid="f-2" itemGuid="i-2"/>'));
});
