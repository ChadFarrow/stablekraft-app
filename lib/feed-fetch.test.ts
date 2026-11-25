import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { isSafePublicUrl, isPrivateIp } from './url-security';
import {
  fetchFeed,
  checkResolvedHost,
  loopbackEscapeAllowed,
  FeedFetchError,
  type LookupAll,
} from './feed-fetch';
import { parseRSSFeed } from './rss-parser-db';
import type { FetchLike } from './safe-fetch';

// The attack cases from the 2026-11-24 survey, plus the encodings the old string
// check let through (each verified to pass it before this change).
const PRIVATE_URLS = [
  'http://localhost/feed.xml',
  'http://localhost./feed.xml',
  'http://foo.localhost/feed.xml',
  'http://127.0.0.1/feed.xml',
  'http://127.0.0.1:3000/api/admin',
  'http://2130706433/', // decimal 127.0.0.1
  'http://0177.0.0.1/', // octal
  'http://10.0.0.5/feed.xml',
  'http://10.255.255.255/',
  'http://169.254.169.254/latest/meta-data/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://100.64.0.1/', // carrier-grade NAT / tailnet
  'http://0.0.0.0/',
  'http://0.0.0.1/',
  'http://[::1]/',
  'http://[::]/',
  'http://[::ffff:127.0.0.1]/', // Node rewrites the host to [::ffff:7f00:1]
  'http://[::ffff:a9fe:a9fe]/', // 169.254.169.254, v4-mapped
  'http://[64:ff9b::7f00:1]/', // NAT64
  'http://[fe80::1]/',
  'http://[fd00::1]/',
  'http://metadata.google.internal./',
  'http://printer.local/',
];

const PUBLIC_IP = '93.184.215.14';

/** A broken cap or deadline must FAIL these tests, not hang the suite. */
const BOUNDED = { timeout: 10_000 };

/** A resolver that knows only the names in `table`; anything else does not resolve. */
function stubLookup(table: Record<string, string[]>): LookupAll & { asked: string[] } {
  const asked: string[] = [];
  const fn = (async (host: string) => {
    asked.push(host);
    const a = table[host];
    if (!a) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return a;
  }) as LookupAll & { asked: string[] };
  fn.asked = asked;
  return fn;
}

/** A fetch stand-in driven by a URL → Response table, recording every request. */
function stubFetch(routes: Record<string, () => Response>): { impl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (input) => {
    calls.push(input);
    const make = routes[input];
    if (!make) throw new Error(`unexpected fetch: ${input}`);
    return make();
  };
  return { impl, calls };
}

const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });
const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>';

/**
 * A body of `total` bytes, larger than the cap under test. Finite on purpose: with a
 * broken cap the read then COMPLETES and the test fails, instead of growing for ever.
 */
function bigBody(total: number, chunk = 256 * 1024): ReadableStream<Uint8Array> {
  const block = new Uint8Array(chunk).fill(0x41);
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= total) return c.close();
      c.enqueue(block);
      sent += block.byteLength;
    },
  });
}

// --- the literal check --------------------------------------------------------

test('isSafePublicUrl refuses every private literal and name', () => {
  for (const u of PRIVATE_URLS) {
    const r = isSafePublicUrl(u, { allowHttp: true });
    assert.equal(r.ok, false, `${u} must be refused`);
  }
});

test('isSafePublicUrl still allows public hosts', () => {
  for (const u of [
    'https://feeds.wavlake.com/feed/music/abc',
    'http://music.behindthesch3m3s.com/feed.xml',
    `http://${PUBLIC_IP}/feed.xml`,
    'https://[2606:4700:4700::1111]/',
    'https://100.128.0.1/', // just past 100.64.0.0/10
    'https://172.32.0.1/', // just past 172.16.0.0/12
  ]) {
    const r = isSafePublicUrl(u, { allowHttp: true });
    assert.equal(r.ok, true, `${u} must be allowed`);
  }
});

test('isPrivateIp: addresses DNS can return', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:7f00:1', '::ffff:127.0.0.1', 'fd12:3456::1', '[::1]']) {
    assert.equal(isPrivateIp(a), true, a);
  }
  for (const a of [PUBLIC_IP, '2606:4700:4700::1111', 'example.com']) {
    assert.equal(isPrivateIp(a), false, a);
  }
});

// --- the DNS check ------------------------------------------------------------

test('checkResolvedHost: a public name that resolves to a private address is refused', async () => {
  const lookup = stubLookup({
    '127.0.0.1.nip.io': ['127.0.0.1'],
    'meta.example': ['169.254.169.254'],
    'v6loop.example': ['::1'],
    'mapped.example': ['::ffff:127.0.0.1'],
    'mixed.example': [PUBLIC_IP, '10.0.0.5'], // ANY private answer refuses
    'ok.example': [PUBLIC_IP, '2606:4700:4700::1111'],
  });
  assert.match((await checkResolvedHost('127.0.0.1.nip.io', lookup))!, /resolves to private address 127\.0\.0\.1/);
  assert.match((await checkResolvedHost('meta.example', lookup))!, /169\.254\.169\.254/);
  assert.match((await checkResolvedHost('v6loop.example', lookup))!, /::1/);
  assert.match((await checkResolvedHost('mapped.example', lookup))!, /::ffff:127\.0\.0\.1/);
  assert.match((await checkResolvedHost('mixed.example', lookup))!, /10\.0\.0\.5/);
  assert.equal(await checkResolvedHost('ok.example', lookup), null);
  assert.equal(await checkResolvedHost('OK.example.', lookup), null, 'trailing dot and case are normalised');
});

test('checkResolvedHost fails closed on a name that does not resolve', async () => {
  const lookup = stubLookup({ 'empty.example': [] });
  assert.match((await checkResolvedHost('nowhere.example', lookup))!, /does not resolve/);
  assert.match((await checkResolvedHost('empty.example', lookup))!, /does not resolve/);
});

test('checkResolvedHost does not look up an IP literal', async () => {
  const lookup = stubLookup({});
  assert.equal(await checkResolvedHost(PUBLIC_IP, lookup), null);
  assert.equal(await checkResolvedHost('[2606:4700:4700::1111]', lookup), null);
  assert.match((await checkResolvedHost('[::ffff:7f00:1]', lookup))!, /private address/);
  assert.deepEqual(lookup.asked, []);
});

// --- fetchFeed ----------------------------------------------------------------

test('fetchFeed refuses every private URL without issuing a request', async () => {
  const { impl, calls } = stubFetch({});
  const lookup = stubLookup({});
  for (const u of PRIVATE_URLS) {
    await assert.rejects(fetchFeed(u, { fetchImpl: impl, lookup }), FeedFetchError, u);
  }
  assert.deepEqual(calls, []);
});

test('fetchFeed refuses a public name that resolves to a private address, before connecting', async () => {
  const { impl, calls } = stubFetch({});
  const lookup = stubLookup({ 'evil.example': ['127.0.0.1'] });
  await assert.rejects(fetchFeed('http://evil.example/feed.xml', { fetchImpl: impl, lookup }), /resolves to private address/);
  assert.deepEqual(calls, []);
});

test('fetchFeed refuses an unresolvable name (fail closed)', async () => {
  const { impl, calls } = stubFetch({});
  await assert.rejects(fetchFeed('http://nowhere.example/feed.xml', { fetchImpl: impl, lookup: stubLookup({}) }), /does not resolve/);
  assert.deepEqual(calls, []);
});

test('fetchFeed refuses a redirect to a private literal, and never requests it', async () => {
  for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:3000/', 'http://[::ffff:127.0.0.1]/', 'http://localhost./']) {
    const { impl, calls } = stubFetch({ 'http://pub.example/feed.xml': redirect(target) });
    const lookup = stubLookup({ 'pub.example': [PUBLIC_IP] });
    await assert.rejects(fetchFeed('http://pub.example/feed.xml', { fetchImpl: impl, lookup }), /Redirect target refused/, target);
    assert.deepEqual(calls, ['http://pub.example/feed.xml']);
  }
});

test('fetchFeed refuses a redirect to a name that resolves privately (DNS runs on every hop)', async () => {
  const { impl, calls } = stubFetch({ 'http://pub.example/feed.xml': redirect('http://127.0.0.1.nip.io/x') });
  const lookup = stubLookup({ 'pub.example': [PUBLIC_IP], '127.0.0.1.nip.io': ['127.0.0.1'] });
  await assert.rejects(fetchFeed('http://pub.example/feed.xml', { fetchImpl: impl, lookup }), /127\.0\.0\.1\.nip\.io resolves to private/);
  assert.deepEqual(calls, ['http://pub.example/feed.xml']);
  assert.deepEqual(lookup.asked, ['pub.example', '127.0.0.1.nip.io']);
});

test('fetchFeed follows public redirects (plain http allowed) and returns the feed', async () => {
  const { impl, calls } = stubFetch({
    'http://pub.example/feed.xml': redirect('https://www.pub.example/feed.xml'),
    'https://www.pub.example/feed.xml': redirect('/rss'),
    'https://www.pub.example/rss': () => new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
  });
  const lookup = stubLookup({ 'pub.example': [PUBLIC_IP], 'www.pub.example': [PUBLIC_IP] });
  const res = await fetchFeed('http://pub.example/feed.xml', { fetchImpl: impl, lookup });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), rss);
  assert.equal(calls.length, 3);
});

test('fetchFeed keeps a non-2xx status for the caller (the HTTP 404 text dead-feed checks read)', async () => {
  const { impl } = stubFetch({ 'http://pub.example/gone.xml': () => new Response('nope', { status: 404, statusText: 'Not Found' }) });
  const res = await fetchFeed('http://pub.example/gone.xml', { fetchImpl: impl, lookup: stubLookup({ 'pub.example': [PUBLIC_IP] }) });
  assert.equal(res.ok, false);
  assert.equal(res.status, 404);
});

test('fetchFeed refuses a declared Content-Length over the cap before reading', async () => {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(10)); } });
  const { impl } = stubFetch({
    'http://pub.example/big.xml': () => new Response(body, { status: 200, headers: { 'content-length': String(13 * 1024 * 1024) } }),
  });
  await assert.rejects(
    fetchFeed('http://pub.example/big.xml', { fetchImpl: impl, lookup: stubLookup({ 'pub.example': [PUBLIC_IP] }) }),
    /exceeds/
  );
  assert.ok(pulled <= 1, 'the body is not read');
});

test('fetchFeed caps a huge body with no Content-Length', BOUNDED, async () => {
  const { impl } = stubFetch({ 'http://pub.example/huge.xml': () => new Response(bigBody(4 * 1024 * 1024), { status: 200 }) });
  const res = await fetchFeed('http://pub.example/huge.xml', {
    fetchImpl: impl,
    lookup: stubLookup({ 'pub.example': [PUBLIC_IP] }),
    maxBytes: 1024 * 1024,
  });
  await assert.rejects(res.text(), /exceeds 1048576 bytes/);
});

test('fetchFeed caps a huge body behind a FALSE (small) Content-Length', BOUNDED, async () => {
  const { impl } = stubFetch({
    'http://pub.example/liar.xml': () => new Response(bigBody(4 * 1024 * 1024), { status: 200, headers: { 'content-length': '100' } }),
  });
  const res = await fetchFeed('http://pub.example/liar.xml', {
    fetchImpl: impl,
    lookup: stubLookup({ 'pub.example': [PUBLIC_IP] }),
    maxBytes: 1024 * 1024,
  });
  await assert.rejects(res.text(), /exceeds/);
});

test('fetchFeed: the default cap is 12 MiB', BOUNDED, async () => {
  const { impl } = stubFetch({ 'http://pub.example/huge.xml': () => new Response(bigBody(16 * 1024 * 1024), { status: 200 }) });
  const res = await fetchFeed('http://pub.example/huge.xml', { fetchImpl: impl, lookup: stubLookup({ 'pub.example': [PUBLIC_IP] }) });
  await assert.rejects(res.text(), /exceeds 12582912 bytes/);
});

test('fetchFeed times out a DNS lookup that never answers', BOUNDED, async () => {
  const { impl, calls } = stubFetch({});
  const hang: LookupAll = () => new Promise(() => {});
  const t0 = Date.now();
  await assert.rejects(fetchFeed('http://slow-dns.example/feed.xml', { fetchImpl: impl, lookup: hang, timeoutMs: 200 }), /timed out/);
  assert.ok(Date.now() - t0 < 2000);
  assert.deepEqual(calls, []);
});

// --- against a real socket: the slow server -----------------------------------

/**
 * A real HTTP server on loopback, reached through a public-looking name: the test
 * resolver says `slow.example` is public, and this fetch sends the request to the
 * local server with the real `fetch` — so the abort is undici's own, on a real socket.
 */
async function withServer(
  handler: http.RequestListener,
  run: (impl: FetchLike) => Promise<void>
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const impl: FetchLike = (u, init) => fetch(u.replace('http://slow.example', `http://127.0.0.1:${port}`), init);
  try {
    await run(impl);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const slowLookup = stubLookup({ 'slow.example': [PUBLIC_IP] });

test('fetchFeed times out a server that never sends headers', BOUNDED, async () => {
  await withServer(() => { /* never answer */ }, async (impl) => {
    const t0 = Date.now();
    await assert.rejects(fetchFeed('http://slow.example/feed.xml', { fetchImpl: impl, lookup: slowLookup, timeoutMs: 300 }), /timed out/);
    assert.ok(Date.now() - t0 < 3000, 'gave up near the deadline');
  });
});

test('fetchFeed times out a slow-drip body (headers fast, then one byte at a time)', BOUNDED, async () => {
  // Drips for 4 s and then ends, so a broken deadline makes the read SUCCEED late
  // (a test failure) rather than hang.
  const timers: NodeJS.Timeout[] = [];
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    res.write('<');
    const started = Date.now();
    const drip = setInterval(() => {
      if (Date.now() - started > 4000) { clearInterval(drip); res.end('/>'); return; }
      res.write('a');
    }, 50);
    timers.push(drip);
  }, async (impl) => {
    const t0 = Date.now();
    const res = await fetchFeed('http://slow.example/feed.xml', { fetchImpl: impl, lookup: slowLookup, timeoutMs: 400 });
    assert.equal(res.status, 200, 'headers arrived');
    await assert.rejects(res.text());
    const took = Date.now() - t0;
    assert.ok(took < 3000, `the deadline covers the body (took ${took} ms)`);
  });
  timers.forEach(clearInterval);
});

test('fetchFeed caps a huge chunked body from a real server', BOUNDED, async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/rss+xml' });
    // 8 MiB against a 2 MiB cap, then the end: finite for the same reason as bigBody.
    const block = Buffer.alloc(256 * 1024, 0x41);
    let left = 32;
    const pump = () => {
      while (left > 0) { left--; if (!res.write(block)) return; }
      res.end();
    };
    res.on('drain', pump);
    pump();
  }, async (impl) => {
    const res = await fetchFeed('http://slow.example/feed.xml', { fetchImpl: impl, lookup: slowLookup, maxBytes: 2 * 1024 * 1024 });
    await assert.rejects(res.text(), /exceeds/);
  });
});

// --- the e2e loopback escape --------------------------------------------------

test('loopback escape: only with the flag, never in production, only for a loopback literal', () => {
  const on = { FEED_FETCH_ALLOW_LOOPBACK: '1', NODE_ENV: 'development' };
  assert.equal(loopbackEscapeAllowed('http://127.0.0.1:8765/album.xml', on), true);
  assert.equal(loopbackEscapeAllowed('http://localhost:8765/album.xml', on), true);
  assert.equal(loopbackEscapeAllowed('http://[::1]:8765/album.xml', on), true);
  assert.equal(loopbackEscapeAllowed('http://127.0.0.1:8765/album.xml', { NODE_ENV: 'development' }), false, 'no flag');
  assert.equal(loopbackEscapeAllowed('http://127.0.0.1:8765/album.xml', { ...on, NODE_ENV: 'production' }), false, 'production');
  assert.equal(loopbackEscapeAllowed('http://169.254.169.254/', on), false, 'other private addresses stay refused');
  assert.equal(loopbackEscapeAllowed('http://10.0.0.5/', on), false);
  assert.equal(loopbackEscapeAllowed('http://127.0.0.1.nip.io/', on), false, 'a name is never escaped');
});

test('fetchFeed refuses loopback in production even with the flag set', async () => {
  const { impl, calls } = stubFetch({});
  await assert.rejects(
    fetchFeed('http://127.0.0.1:8765/album.xml', {
      fetchImpl: impl,
      lookup: stubLookup({}),
      env: { FEED_FETCH_ALLOW_LOOPBACK: '1', NODE_ENV: 'production' },
    }),
    FeedFetchError
  );
  assert.deepEqual(calls, []);
});

// --- through parseRSSFeed itself (no XML passed, so it fetches) ---------------

test('parseRSSFeed(url) refuses every private URL without a request', async () => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    throw new Error('must not fetch');
  }) as typeof fetch;
  try {
    for (const u of PRIVATE_URLS) {
      await assert.rejects(parseRSSFeed(u), /Private URLs are not allowed/, u);
    }
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(calls, []);
});

test('parseRSSFeed(url) refuses a redirect to a private address and a huge body', BOUNDED, async () => {
  const real = globalThis.fetch;
  const calls: string[] = [];
  const routes: Record<string, () => Response> = {
    [`http://${PUBLIC_IP}/meta.xml`]: redirect('http://169.254.169.254/latest/meta-data/'),
    [`http://${PUBLIC_IP}/mapped.xml`]: redirect('http://[::ffff:127.0.0.1]:3000/'),
    [`http://${PUBLIC_IP}/huge.xml`]: () => new Response(bigBody(16 * 1024 * 1024), { status: 200 }),
    [`http://${PUBLIC_IP}/ok.xml`]: () => new Response(rss, { status: 200 }),
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = String(input);
    calls.push(u);
    const make = routes[u];
    if (!make) throw new Error(`unexpected fetch: ${u}`);
    return make();
  }) as typeof fetch;
  try {
    await assert.rejects(parseRSSFeed(`http://${PUBLIC_IP}/meta.xml`), /Redirect target refused/);
    await assert.rejects(parseRSSFeed(`http://${PUBLIC_IP}/mapped.xml`), /Redirect target refused/);
    await assert.rejects(parseRSSFeed(`http://${PUBLIC_IP}/huge.xml`), /exceeds 12582912 bytes/);
    const ok = await parseRSSFeed(`http://${PUBLIC_IP}/ok.xml`);
    assert.equal(ok.title, 'T', 'a public feed still parses');
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(!calls.some((u) => u.includes('169.254') || u.includes('7f00') || u.includes('127.0.0.1')), 'no private hop requested');
});

test('parseRSSFeed(url) refuses a name that really resolves to loopback (127.0.0.1.nip.io)', async (t) => {
  // Real DNS. Skipped when there is none, so the suite needs no network.
  const dns = await import('node:dns/promises');
  try {
    await dns.lookup('127.0.0.1.nip.io');
  } catch {
    t.skip('no DNS for nip.io here');
    return;
  }
  const real = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; throw new Error('must not fetch'); }) as typeof fetch;
  try {
    await assert.rejects(parseRSSFeed('http://127.0.0.1.nip.io:3000/feed.xml'), /resolves to private address/);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(called, false);
});

// --- the open GET routes that pass a caller's feedUrl to MusicTrackParser -----

test('MusicTrackParser.extractMusicTracks never requests a private feedUrl (GET /api/music-tracks, /api/generate-playlist-rss)', async () => {
  const { MusicTrackParser } = await import('./music-track-parser');
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    throw new Error('must not fetch');
  }) as typeof fetch;
  try {
    for (const u of PRIVATE_URLS) {
      await MusicTrackParser.extractMusicTracks(u).then(
        () => assert.fail(`${u} must not succeed`),
        () => {}
      );
    }
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(calls, []);
});
