import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProxyHostMode,
  hostMatches,
  hostOf,
  STATIC_ALLOWED_HOSTS,
  checkProxyTarget,
  guardProxyTarget,
  getCatalogHosts,
  resetCatalogHostCache,
  setCatalogHostLoaderForTests,
  CATALOG_HOSTS_TTL_MS,
  CATALOG_HOSTS_RETRY_MS,
  oversizeImageRedirect,
} from './proxy-host-allowlist';

test('parseProxyHostMode: enforce only when asked for, everything else logs', () => {
  assert.equal(parseProxyHostMode(undefined), 'log');
  assert.equal(parseProxyHostMode(''), 'log');
  assert.equal(parseProxyHostMode('log'), 'log');
  assert.equal(parseProxyHostMode(' ENFORCE '), 'enforce');
  assert.equal(parseProxyHostMode('yes'), 'log');
});

test('hostMatches: exact host and true subdomains only', () => {
  assert.equal(hostMatches('wavlake.com', ['wavlake.com']), true);
  assert.equal(hostMatches('cdn.wavlake.com', ['wavlake.com']), true);
  assert.equal(hostMatches('a.b.wavlake.com', ['wavlake.com']), true);
  assert.equal(hostMatches('WAVLAKE.COM', ['wavlake.com']), true, 'case insensitive');
  assert.equal(hostMatches('wavlake.com.', ['wavlake.com']), true, 'trailing root dot');
});

test('hostMatches: the suffix-confusion attacks an includes() check would let through', () => {
  // These are exactly why this does not use String.includes.
  assert.equal(hostMatches('wavlake.com.attacker.net', ['wavlake.com']), false);
  assert.equal(hostMatches('notwavlake.com', ['wavlake.com']), false);
  assert.equal(hostMatches('evil-wavlake.com', ['wavlake.com']), false);
  assert.equal(hostMatches('wavlake.com.evil.io', ['wavlake.com']), false);
  assert.equal(hostMatches('attacker.net', ['wavlake.com']), false);
});

test('hostMatches: empty allowlist entries never match', () => {
  assert.equal(hostMatches('anything.com', ['', '   ']), false);
  assert.equal(hostMatches('anything.com', []), false);
});

test('hostOf: hostname or null, never a throw', () => {
  assert.equal(hostOf('https://cdn.wavlake.com/track/abc.mp3'), 'cdn.wavlake.com');
  assert.equal(hostOf('http://Example.COM:8080/a'), 'example.com');
  assert.equal(hostOf('not a url'), null);
  assert.equal(hostOf(''), null);
  assert.equal(hostOf(null), null);
  assert.equal(hostOf(undefined), null);
});

test('STATIC_ALLOWED_HOSTS: carries the audio path hosts and has no duplicates', () => {
  assert.ok(STATIC_ALLOWED_HOSTS.includes('wavlake.com'));
  assert.ok(STATIC_ALLOWED_HOSTS.includes('doerfelverse.com'), 'from CORS_PROBLEMATIC_DOMAINS');
  assert.ok(STATIC_ALLOWED_HOSTS.includes('heycitizen.xyz'), 'from DIRECT_FIRST_DOMAINS');
  assert.equal(new Set(STATIC_ALLOWED_HOSTS).size, STATIC_ALLOWED_HOSTS.length);
});

test('checkProxyTarget: a static host is allowed without touching the database', async () => {
  // No DATABASE_URL is configured in this test run, so reaching the catalog
  // query at all would show up as a failure or a hang here.
  assert.deepEqual(await checkProxyTarget('https://cdn.wavlake.com/t.mp3', 'enforce'), {
    allowed: true,
    host: 'cdn.wavlake.com',
    reason: 'static',
  });
  assert.deepEqual(await checkProxyTarget('https://stablekraft.app/x.png', 'enforce'), {
    allowed: true,
    host: 'stablekraft.app',
    reason: 'static',
  });
});

test('checkProxyTarget: an unparseable url is allowed, not refused', async () => {
  assert.deepEqual(await checkProxyTarget('nonsense', 'enforce'), {
    allowed: true,
    host: null,
    reason: 'unavailable',
  });
});

/** A stand-in for what the catalog query returns. */
const CATALOG = new Set(['media.example-artist.com', 'files.someartist.net']);

test('checkProxyTarget: a catalog host and its subdomains are allowed', async () => {
  assert.deepEqual(await checkProxyTarget('https://media.example-artist.com/a.mp3', 'enforce', CATALOG), {
    allowed: true,
    host: 'media.example-artist.com',
    reason: 'catalog',
  });
  assert.equal(
    (await checkProxyTarget('https://cdn.files.someartist.net/x.png', 'enforce', CATALOG)).reason,
    'catalog'
  );
});

test('checkProxyTarget: enforce mode REFUSES a host the catalog never references', async () => {
  // The abuse being closed: piping any file on the internet through this server.
  assert.deepEqual(await checkProxyTarget('https://attacker.example/huge.iso', 'enforce', CATALOG), {
    allowed: false,
    host: 'attacker.example',
    reason: 'foreign',
  });
  // And the suffix-confusion attempt against a real catalog host.
  assert.equal(
    (await checkProxyTarget('https://media.example-artist.com.attacker.net/x', 'enforce', CATALOG)).allowed,
    false
  );
});

test('checkProxyTarget: log mode allows the same foreign host, and says so', async () => {
  assert.deepEqual(await checkProxyTarget('https://attacker.example/huge.iso', 'log', CATALOG), {
    allowed: true,
    host: 'attacker.example',
    reason: 'log-mode',
  });
});

test('checkProxyTarget: a failed catalog load allows everything rather than breaking the catalog', async () => {
  assert.deepEqual(await checkProxyTarget('https://attacker.example/huge.iso', 'enforce', null), {
    allowed: true,
    host: 'attacker.example',
    reason: 'unavailable',
  });
});

/** The oversize redirect's inputs for a real catalog GIF, loaded by an <img>. */
const BIG_GIF = 'https://media.example-artist.com/art/show%20art.gif';
const oversize = (over: Partial<Parameters<typeof oversizeImageRedirect>[0]> = {}) =>
  oversizeImageRedirect({
    fetchUrl: BIG_GIF,
    finalUrl: new URL(BIG_GIF),
    fetchDest: 'image',
    catalogHostsOverride: CATALOG,
    ...over,
  });

test('oversizeImageRedirect: an <img> load of a catalog image is sent to the artist host', async () => {
  // Pixel Palace: an 18 MB cover GIF, over MAX_IMAGE_BYTES, rendered as the placeholder.
  assert.equal(await oversize(), BIG_GIF);
  assert.equal(
    await oversize({ fetchUrl: 'https://cdn.wavlake.com/big.gif', finalUrl: new URL('https://cdn.wavlake.com/big.gif') }),
    'https://cdn.wavlake.com/big.gif',
    'a static host counts as vouched for too'
  );
});

test('oversizeImageRedirect: only an image load, never a navigation or a fetch', async () => {
  // A link to /api/proxy-image?url=… is a top-level navigation. Redirecting it
  // would make stablekraft.app an open redirect to whatever that host serves
  // to a browser, and the catalog admits shared hosts (github.io, imgur.com)
  // and any host an unauthenticated POST /api/feeds adds.
  assert.equal(await oversize({ fetchDest: 'document' }), null);
  assert.equal(await oversize({ fetchDest: 'iframe' }), null);
  // fetch() — downloadImage in lib/downloads — keeps the placeholder it gets today.
  assert.equal(await oversize({ fetchDest: 'empty' }), null);
  // A browser without Fetch Metadata, or a server-side caller, sends nothing.
  assert.equal(await oversize({ fetchDest: null }), null);
});

test('oversizeImageRedirect: never for a host the catalog does not vouch for', async () => {
  const foreign = 'https://attacker.example/big.gif';
  assert.equal(await oversize({ fetchUrl: foreign, finalUrl: new URL(foreign) }), null, 'log mode allows it, but does not vouch');
  assert.equal(await oversize({ catalogHostsOverride: null }), null, 'nor when the catalog could not be read');
});

test('oversizeImageRedirect: HTTPS at both ends, or the image would be blocked as mixed content', async () => {
  assert.equal(await oversize({ fetchUrl: 'http://media.example-artist.com/a.gif' }), null);
  assert.equal(await oversize({ finalUrl: new URL('http://media.example-artist.com/a.gif') }), null);
  assert.equal(await oversize({ fetchUrl: 'not a url' }), null);
});

test('guardProxyTarget: refusal only in enforce mode against a loaded catalog', async () => {
  assert.deepEqual(await guardProxyTarget('https://attacker.example/x', 'test', 'enforce', CATALOG), {
    refusal: { error: 'Host not allowed', status: 403 },
  });
  assert.deepEqual(await guardProxyTarget('https://attacker.example/x', 'test', 'log', CATALOG), { refusal: null });
  assert.deepEqual(await guardProxyTarget('https://attacker.example/x', 'test', 'enforce', null), { refusal: null });
  assert.deepEqual(await guardProxyTarget('https://cdn.wavlake.com/x', 'test', 'enforce', CATALOG), { refusal: null });
});

/**
 * The drift guard for the three host lists STATIC_ALLOWED_HOSTS seeds from.
 *
 * The HGH and ITDV playlists hardcode their media URLs in data/, and their
 * source feeds are deliberately absent from the catalog, so nothing else proves
 * those hosts are reachable through the proxy. Seeding from only two of the
 * repo's three host lists left three of them matching nothing, which enforce
 * mode would have turned into missing artwork on a real page.
 *
 * Imports the data files here rather than in the module under test: ~220KB of
 * URLs belongs in a test run, not in the server bundle.
 */
test('every host the HGH and ITDV playlists load is covered without asking the catalog', async () => {
  const [hghArt, hghAudio, itdvArt, itdvAudio] = await Promise.all([
    import('../data/hgh-artwork-urls'),
    import('../data/hgh-audio-urls'),
    import('../data/itdv-artwork-urls'),
    import('../data/itdv-audio-urls'),
  ]);

  const urls = [
    ...Object.values(hghArt.HGH_ARTWORK_URL_MAP),
    ...Object.values(hghAudio.HGH_AUDIO_URL_MAP),
    ...Object.values(itdvArt.ITDV_ARTWORK_URL_MAP),
    ...Object.values(itdvAudio.ITDV_AUDIO_URL_MAP),
  ] as string[];

  const hosts = new Set<string>();
  for (const url of urls) {
    const host = hostOf(url);
    if (host) hosts.add(host);
  }

  // A sanity floor: if the data files ever stop exporting what we think, an
  // empty set would make the assertion below pass while proving nothing.
  assert.ok(hosts.size > 50, `expected many playlist hosts, found ${hosts.size}`);

  const uncovered = [...hosts].filter((h) => !hostMatches(h, STATIC_ALLOWED_HOSTS)).sort();
  assert.deepEqual(
    uncovered,
    [],
    `these playlist hosts match no static entry, so PROXY_HOST_MODE=enforce would refuse them:\n  ${uncovered.join('\n  ')}\nAdd them to PLAYLIST_MEDIA_HOSTS.`
  );
});

test('STATIC_ALLOWED_HOSTS seeds from all three of the repo host lists', async () => {
  const { CORS_PROBLEMATIC_DOMAINS, DIRECT_FIRST_DOMAINS } = await import('./audio-url-utils');
  const { ALLOWED_IMAGE_DOMAINS } = await import('./cdn-utils');

  for (const host of [...CORS_PROBLEMATIC_DOMAINS, ...DIRECT_FIRST_DOMAINS, ...ALLOWED_IMAGE_DOMAINS]) {
    if (host === 'localhost') continue; // deliberately filtered out; asserted below
    assert.ok(hostMatches(host, STATIC_ALLOWED_HOSTS), `${host} is in a repo host list but not allowed`);
  }

  // ALLOWED_IMAGE_DOMAINS carries localhost for next/image in development. The
  // seed must not carry it through: isSafePublicUrl rejects loopback first, but
  // the allowlist should not claim loopback is a fine proxy target either.
  assert.ok(!hostMatches('localhost', STATIC_ALLOWED_HOSTS), 'loopback is never a proxy target');
  assert.ok(!hostMatches('127.0.0.1', STATIC_ALLOWED_HOSTS));

  // The two that seeding from only audio-url-utils missed.
  assert.ok(hostMatches('socialmedia101pro.com', STATIC_ALLOWED_HOSTS));
  assert.ok(hostMatches('bobcatindex.us-southeast-1.linodeobjects.com', STATIC_ALLOWED_HOSTS));

  // Still not an open proxy.
  assert.ok(!hostMatches('attacker.example', STATIC_ALLOWED_HOSTS));
  assert.ok(!hostMatches('wavlake.com.attacker.net', STATIC_ALLOWED_HOSTS));
});

/**
 * The catalog cache — the half of this module that holds state, and the half
 * that had no coverage at all. Every other test drives catalogHostsOverride,
 * which skips the TTL, the stampede collapse, the cooldown and the
 * stale-while-revalidate path.
 */
test('getCatalogHosts: the first call waits, and later calls inside the TTL do not reload', async () => {
  let loads = 0;
  setCatalogHostLoaderForTests(async () => {
    loads += 1;
    return new Set(['first.example']);
  });

  assert.deepEqual([...((await getCatalogHosts(0)) ?? [])], ['first.example']);
  assert.equal(loads, 1);

  await getCatalogHosts(CATALOG_HOSTS_TTL_MS - 1);
  assert.equal(loads, 1, 'inside the TTL nothing reloads');

  setCatalogHostLoaderForTests(null);
});

test('getCatalogHosts: concurrent callers collapse into one load', async () => {
  let loads = 0;
  setCatalogHostLoaderForTests(async () => {
    loads += 1;
    await new Promise((r) => setTimeout(r, 10));
    return new Set(['one.example']);
  });

  const results = await Promise.all([getCatalogHosts(0), getCatalogHosts(0), getCatalogHosts(0)]);
  assert.equal(loads, 1, 'a page load fires many proxy requests at once');
  for (const set of results) assert.ok(set?.has('one.example'));

  setCatalogHostLoaderForTests(null);
});

test('getCatalogHosts: past the TTL it answers from the stale set and refreshes behind the request', async () => {
  let loads = 0;
  setCatalogHostLoaderForTests(async () => {
    loads += 1;
    await new Promise((r) => setTimeout(r, 10));
    return new Set([`load${loads}.example`]);
  });

  await getCatalogHosts(0);
  assert.equal(loads, 1);

  // The whole point: this call must NOT wait on the query. It returns the old
  // set immediately, so no user pays 170-650ms for a refresh they did not ask
  // for — which in log mode would be latency a mode switch is meant to prevent.
  const stale = await getCatalogHosts(CATALOG_HOSTS_TTL_MS + 1);
  assert.ok(stale?.has('load1.example'), 'answered from the stale set');
  assert.equal(loads, 2, 'and started a refresh anyway');

  await new Promise((r) => setTimeout(r, 30));
  const refreshed = await getCatalogHosts(CATALOG_HOSTS_TTL_MS + 2);
  assert.ok(refreshed?.has('load2.example'), 'the refresh landed');

  setCatalogHostLoaderForTests(null);
});

test('getCatalogHosts: a failed load keeps the previous set rather than dropping it', async () => {
  let fail = false;
  setCatalogHostLoaderForTests(async () => (fail ? null : new Set(['good.example'])));

  await getCatalogHosts(0);
  fail = true;
  const after = await getCatalogHosts(CATALOG_HOSTS_TTL_MS + 1);
  assert.ok(after?.has('good.example'), 'a database hiccup must not empty the allowlist');

  setCatalogHostLoaderForTests(null);
});

test('getCatalogHosts: a failed first load returns null, which callers read as allow', async () => {
  setCatalogHostLoaderForTests(async () => null);
  assert.equal(await getCatalogHosts(0), null);
  setCatalogHostLoaderForTests(null);
});

test('getCatalogHosts: a failure is not retried until the cooldown passes', async () => {
  let loads = 0;
  setCatalogHostLoaderForTests(async () => {
    loads += 1;
    return null;
  });

  await getCatalogHosts(0);
  assert.equal(loads, 1);

  // With no cooldown, a database that is down makes EVERY proxy request start
  // its own doomed query, during exactly the incident when the proxy has to
  // stay quick.
  await getCatalogHosts(CATALOG_HOSTS_RETRY_MS - 1);
  assert.equal(loads, 1, 'still cooling off');

  await getCatalogHosts(CATALOG_HOSTS_RETRY_MS + 1);
  assert.equal(loads, 2, 'and retries once it has passed');

  setCatalogHostLoaderForTests(null);
});

test('getCatalogHosts: a loader that REJECTS does not wedge the module', async () => {
  // loadCatalogHosts catches everything today, so this cannot happen today. If
  // it ever can, clearing inFlight only on success would leave a permanently
  // rejected promise here and every later caller would throw — and
  // app/api/proxy-audio/route.ts calls guardProxyTarget outside its try, so
  // that is a 500 on every audio request until the instance restarts.
  let calls = 0;
  setCatalogHostLoaderForTests(async () => {
    calls += 1;
    throw new Error('connection reset');
  });

  assert.equal(await getCatalogHosts(0), null, 'a rejection reads as unavailable, not a throw');

  setCatalogHostLoaderForTests(async () => new Set(['recovered.example']));
  const recovered = await getCatalogHosts(0);
  assert.ok(recovered?.has('recovered.example'), 'and the module still works afterwards');
  assert.equal(calls, 1);

  setCatalogHostLoaderForTests(null);
  resetCatalogHostCache();
});
