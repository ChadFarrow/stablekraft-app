// Run: npx tsx --test lib/rss-feed-fetch.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRSSFeedWithSegments } from './rss-parser-db';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
<title>Album</title>
<item>
<title>Song</title>
<guid>song-1</guid>
<enclosure url="https://example.com/song.mp3" type="audio/mpeg" length="1"/>
</item>
</channel>
</rss>`;

function stubFetch(respond: () => Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return respond();
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('a refused fetch fails with its HTTP status, not as unreadable XML', async () => {
  // Wavlake answers a burst with 429 and a plain-text body; parsed as XML that read
  // "Non-whitespace before first tag ... Char: T" on ~1,400 feeds a night.
  const f = stubFetch(() => new Response('Too Many Requests', { status: 429, statusText: 'Too Many Requests' }));
  try {
    await assert.rejects(parseRSSFeedWithSegments('https://wavlake.com/feed/music/x'), /HTTP 429/);
  } finally {
    f.restore();
  }
});

test('the feed is fetched once for both its items and its music segments', async () => {
  const f = stubFetch(() => new Response(FEED, { status: 200, headers: { 'content-type': 'application/rss+xml' } }));
  try {
    const feed = await parseRSSFeedWithSegments('https://example.com/feed.xml');
    assert.equal(feed.items.length, 1);
    assert.deepEqual(f.calls, ['https://example.com/feed.xml']);
  } finally {
    f.restore();
  }
});

test('the feed fetch carries a timeout, so one silent host cannot hold a whole reparse', async () => {
  // A host that accepts the connection and never answers held a nightly batch until
  // Railway cut the request at 300 s. Every fetch must carry an AbortSignal.
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Response(FEED, { status: 200 });
  }) as typeof fetch;
  try {
    await parseRSSFeedWithSegments('https://example.com/feed.xml');
    assert.ok(signal instanceof AbortSignal, 'fetchFeedXml passes no AbortSignal');
    assert.equal(signal.aborted, false);
  } finally {
    globalThis.fetch = original;
  }
});
