/**
 * The stream-vs-download asymmetry regression tests.
 *
 * An album whose host sent no `Access-Control-Allow-Origin` streamed perfectly
 * and refused to download, because playback walked an ordered candidate list
 * (proxy first, direct as fallback) while the download path fired a single shot
 * decided by a hand-maintained allowlist that had drifted from playback's copy.
 * These tests pin the shared ordering and the fallback walk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audioUrlCandidates,
  getProxiedAudioUrl,
  CORS_PROBLEMATIC_DOMAINS,
  DIRECT_FIRST_DOMAINS,
} from '../audio-url-utils';

const proxied = (u: string) => `/api/proxy-audio?url=${encodeURIComponent(u)}`;

test('unknown external host is proxied FIRST with a direct fallback', () => {
  // This is the case that was broken: not on any list, so the old download path
  // fetched it directly with mode:'cors' and no retry.
  const url = 'https://some-new-music-cdn.example/track.mp3';
  assert.deepEqual(audioUrlCandidates(url), [proxied(url), url]);
});

test('known CORS-hostile host is proxy-only — no wasted direct attempt', () => {
  const url = 'https://d1abc.cloudfront.net/track.mp3';
  assert.deepEqual(audioUrlCandidates(url), [proxied(url)]);
});

test('cypherpunk.today and thunderroad.media are covered (the drifted entries)', () => {
  // These were in AudioContext's list but missing from the download-side copy,
  // so they were guaranteed-broken downloads before the lists were merged.
  for (const host of ['cypherpunk.today', 'thunderroad.media']) {
    const url = `https://${host}/track.mp3`;
    assert.deepEqual(audioUrlCandidates(url), [proxied(url)], `${host} should be proxy-only`);
  }
});

test('direct-first host tries direct then falls back to the proxy', () => {
  const url = 'https://rssblue.com/track.mp3';
  assert.deepEqual(audioUrlCandidates(url), [url, proxied(url)]);
});

test('op3.dev wrapper is unwrapped before the host check', () => {
  // Judged on wavlake.com (proxy-only), not on op3.dev (which would have got a
  // pointless direct fallback). Matches getAudioUrlsToTry and primaryPlaybackKey.
  const inner = 'https://wavlake.com/track.mp3';
  const wrapped = `https://op3.dev/e/${inner}`;
  assert.deepEqual(audioUrlCandidates(wrapped), [proxied(inner)]);
});

test('stray spaces are encoded before the host check', () => {
  const candidates = audioUrlCandidates('https://rssblue.com/my track.mp3');
  assert.deepEqual(candidates[0], 'https://rssblue.com/my%20track.mp3');
});

test('http is NOT upgraded — the proxy accepts it and the feed may be http-only', () => {
  // primaryPlaybackKey upgrades http→https for the cache key; doing the same to
  // the fetch URL made http-only hosts stream fine and fail to download.
  const url = 'http://some-new-music-cdn.example/track.mp3';
  assert.deepEqual(audioUrlCandidates(url), [proxied(url), url]);
});

test('an already-proxied URL is not double-proxied', () => {
  const url = 'https://stablekraft.app/api/proxy-audio?url=https%3A%2F%2Fx.example%2Fa.mp3';
  assert.deepEqual(audioUrlCandidates(url), [url]);
});

test('unparseable URL is passed through (space-encoded, as playback does)', () => {
  assert.deepEqual(audioUrlCandidates('not a url'), ['not%20a%20url']);
  assert.deepEqual(audioUrlCandidates('/local/path.mp3'), ['/local/path.mp3']);
  assert.deepEqual(audioUrlCandidates(''), []);
});

test('getProxiedAudioUrl is the first candidate', () => {
  const url = 'https://some-new-music-cdn.example/track.mp3';
  assert.equal(getProxiedAudioUrl(url), audioUrlCandidates(url)[0]);
  assert.equal(getProxiedAudioUrl(''), '');
});

test('the two domain lists are single copies, not mirrors that can drift', () => {
  // The lists previously lived in BOTH lib/audio-url-utils.ts and
  // contexts/AudioContext.tsx behind a "keep in sync" comment, and drifted by
  // two entries. If someone re-inlines them, this asserts the shared export is
  // still the one carrying the entries playback depends on.
  assert.ok(CORS_PROBLEMATIC_DOMAINS.includes('cypherpunk.today'));
  assert.ok(CORS_PROBLEMATIC_DOMAINS.includes('thunderroad.media'));
  assert.ok(CORS_PROBLEMATIC_DOMAINS.includes('wavlake.com'));
  assert.ok(DIRECT_FIRST_DOMAINS.includes('rssblue.com'));
});

// ---- the fallback walk in downloadBytes ---------------------------------

type FetchCall = { url: string; signal?: AbortSignal };

/**
 * Drive `downloadBytes` with a stubbed global fetch + Cache API. Returns the
 * URLs attempted, in order.
 */
async function runDownload(
  sourceUrl: string,
  responder: (url: string) => Promise<Response>,
  signal?: AbortSignal
): Promise<{ calls: FetchCall[]; error?: Error; size?: number }> {
  const calls: FetchCall[] = [];
  const stored = new Map<string, unknown>();

  const g = globalThis as any;
  const realFetch = g.fetch;
  const realCaches = g.caches;

  g.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, signal: init?.signal ?? undefined });
    return responder(url);
  };
  g.caches = {
    async open() {
      return {
        async put(k: string, v: unknown) {
          stored.set(k, v);
        },
        async match(k: string) {
          return stored.get(k);
        },
      };
    },
  };

  try {
    const { downloadBytes } = await import('./downloads-cache');
    const size = await downloadBytes('https://key.example/track.mp3', { sourceUrl, signal });
    return { calls, size };
  } catch (err) {
    return { calls, error: err as Error };
  } finally {
    g.fetch = realFetch;
    g.caches = realCaches;
  }
}

/** A minimal streaming Response carrying `bytes` bytes. */
function okResponse(bytes = 8): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes) },
  });
}

test('a CORS rejection on the first candidate falls back to the next', async () => {
  const url = 'https://rssblue.com/track.mp3'; // direct first, proxy second
  const { calls, error, size } = await runDownload(url, async (u) => {
    // Direct attempt rejects the way a real cross-origin CORS failure does.
    if (!u.startsWith('/api/proxy-audio')) throw new TypeError('Failed to fetch');
    return okResponse(16);
  });

  assert.equal(error, undefined);
  assert.equal(size, 16);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, url);
  assert.ok(calls[1].url.startsWith('/api/proxy-audio'));
});

test('a non-ok status also advances to the next candidate', async () => {
  const url = 'https://rssblue.com/track.mp3';
  const { calls, error } = await runDownload(url, async (u) => {
    if (!u.startsWith('/api/proxy-audio')) return new Response(null, { status: 403 });
    return okResponse();
  });
  assert.equal(error, undefined);
  assert.equal(calls.length, 2);
});

test('when every candidate fails the error names the host and each attempt', async () => {
  const url = 'https://rssblue.com/track.mp3';
  const { calls, error } = await runDownload(url, async () => {
    throw new TypeError('Failed to fetch');
  });

  assert.equal(calls.length, 2);
  assert.ok(error, 'expected a throw');
  // The whole point: the next "it won't download" report carries the hostname.
  assert.match(error!.message, /rssblue\.com/);
  assert.match(error!.message, /direct/);
  assert.match(error!.message, /proxy/);
});

test('an already-aborted signal throws AbortError without fetching', async () => {
  const controller = new AbortController();
  controller.abort();
  const { calls, error } = await runDownload(
    'https://rssblue.com/track.mp3',
    async () => okResponse(),
    controller.signal
  );

  assert.equal(calls.length, 0, 'must not fetch after cancel');
  assert.equal(error?.name, 'AbortError');
});

test('an abort mid-walk does NOT fall through to the next candidate', async () => {
  // download-manager reads AbortError as "user cancelled" → idle, and anything
  // else as a failure → error state. Swallowing an abort into "try the next
  // one" would make a cancel look like a failed download.
  const controller = new AbortController();
  const { calls, error } = await runDownload(
    'https://rssblue.com/track.mp3',
    async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    },
    controller.signal
  );

  assert.equal(calls.length, 1, 'must stop at the aborted candidate');
  assert.equal(error?.name, 'AbortError');
});

test('an offline cover survives an image version change', async () => {
  // The refresh adds `?skv=<version>` to image URLs when an artist replaces the
  // file (lib/feeds/image-version.ts). Now Playing looks a downloaded cover up by
  // the track's CURRENT URL, so the key must ignore that version.
  const base = 'https://media.example/album/cover.jpg';
  const stored = new Map<string, Response>();
  const g = globalThis as any;
  const realFetch = g.fetch;
  const realCaches = g.caches;
  g.fetch = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
  g.caches = {
    async open() {
      return {
        async put(k: string, v: Response) { stored.set(k, v); },
        async match(k: string) { return stored.get(k)?.clone(); },
        async delete(k: string) { return stored.delete(k); },
      };
    },
  };
  try {
    const { downloadImage, getImageObjectUrl, deleteImage, coverCacheKey } = await import('./downloads-cache');
    assert.equal(coverCacheKey(`${base}?skv=abcdefgh`), base);
    await downloadImage(`${base}?skv=abcdefgh`);
    assert.deepEqual([...stored.keys()], [base]);
    assert.ok(await getImageObjectUrl(`${base}?skv=ponmlkji`), 'found under a newer version');
    assert.ok(await getImageObjectUrl(base), 'found under the plain URL stored before versioning');
    await deleteImage(`${base}?skv=ponmlkji`);
    assert.equal(stored.size, 0);
  } finally {
    g.fetch = realFetch;
    g.caches = realCaches;
  }
});
