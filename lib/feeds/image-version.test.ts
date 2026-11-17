// Run: npx tsx --test lib/feeds/image-version.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAlbumArtworkUrl, isAnimatedArtworkUrl } from '../cdn-utils';
import type { FetchLike } from '../safe-fetch';
import {
  IMAGE_VERSION_PARAM,
  isVersionable,
  preserveImageVersion,
  resolveImageUrls,
  resolveImageVersion,
  stripImageVersion,
  versionToken,
  withImageVersion,
} from './image-version';

/**
 * An artist can replace a cover file at the SAME URL and send a podping from
 * anywhere (podping.me, any Hive account). The re-read then writes the same URL
 * back and every cache keeps the old art (Hip-Hop Taoist, 2026-09-26). The fix
 * is a version of the image, taken from the image HOST, stored in the URL.
 */

const COVER = 'https://media.basspistol.com/mans1.ch/hiphoptaoist/Hip-Hop%20Taoist%20Tape.jpg';

/** A fetch that answers from a table keyed by method + URL, and counts calls. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl: FetchLike = async (input, init) => {
    const key = `${init?.method || 'GET'} ${input}`;
    calls.push(key);
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return route();
  };
  return { impl, calls };
}

// ---- the token -------------------------------------------------------------

test('a token is 8 letters a-p, deterministic, and never contains 404', () => {
  const a = versionToken('"6ab7851f-5b988"|Sat, 26 Sep 2026 08:41:03 GMT|375176');
  assert.match(a, /^[a-p]{8}$/);
  assert.equal(a, versionToken('"6ab7851f-5b988"|Sat, 26 Sep 2026 08:41:03 GMT|375176'));
  assert.notEqual(a, versionToken('"5f3c0a11-7a2b4"|Wed, 10 Sep 2026 10:00:00 GMT|412000'));
  // getAlbumArtworkUrl swaps any URL containing "404" for a placeholder, so a
  // token must be unable to spell it. Letters only makes that structural.
  for (let i = 0; i < 2000; i++) assert.doesNotMatch(versionToken(`input-${i}`), /\d/);
});

test('bytes and strings both hash', () => {
  assert.match(versionToken(new Uint8Array([1, 2, 3])), /^[a-p]{8}$/);
});

// ---- adding and removing the version ------------------------------------------

test('withImageVersion appends with ? or &, and replaces an existing version', () => {
  assert.equal(withImageVersion(COVER, 'abcdefgh'), `${COVER}?${IMAGE_VERSION_PARAM}=abcdefgh`);
  assert.equal(withImageVersion('https://h.com/a.jpg?w=1', 'abcdefgh'), 'https://h.com/a.jpg?w=1&skv=abcdefgh');
  assert.equal(withImageVersion(`${COVER}?skv=aaaaaaaa`, 'bbbbbbbb'), `${COVER}?skv=bbbbbbbb`);
  assert.equal(withImageVersion('https://h.com/a.jpg#x', 'abcdefgh'), 'https://h.com/a.jpg?skv=abcdefgh#x');
});

test('stripImageVersion removes only our parameter and keeps every other byte', () => {
  assert.equal(stripImageVersion(`${COVER}?skv=abcdefgh`), COVER);
  assert.equal(stripImageVersion('https://h.com/a.jpg?w=1&skv=abcdefgh'), 'https://h.com/a.jpg?w=1');
  assert.equal(stripImageVersion('https://h.com/a.jpg?skv=abcdefgh&w=1'), 'https://h.com/a.jpg?w=1');
  assert.equal(stripImageVersion('https://h.com/a b.jpg?skv=abcdefgh#x'), 'https://h.com/a b.jpg#x');
  // Not ours: wrong alphabet or length, or a different name.
  assert.equal(stripImageVersion('https://h.com/a.jpg?skv=123'), 'https://h.com/a.jpg?skv=123');
  assert.equal(stripImageVersion('https://h.com/a.jpg?askv=abcdefgh'), 'https://h.com/a.jpg?askv=abcdefgh');
  assert.equal(stripImageVersion(COVER), COVER);
});

test('with and strip are inverse and idempotent', () => {
  for (const url of [COVER, 'https://h.com/a.jpg?w=1', 'https://h.com/a b.jpg#frag']) {
    const v = withImageVersion(url, 'hcpadkfb');
    assert.equal(stripImageVersion(v), url);
    assert.equal(withImageVersion(v, 'hcpadkfb'), v);
    assert.equal(stripImageVersion(stripImageVersion(v)), url);
  }
});

test('a versioned URL still works everywhere the app reads artwork', () => {
  const v = withImageVersion(COVER, 'hcpadkfb');
  assert.match(getAlbumArtworkUrl(v, 'medium', true), /^\/api\/proxy-image\?url=/);
  assert.equal(isAnimatedArtworkUrl(withImageVersion('https://h.com/a.gif', 'hcpadkfb')), true);
  assert.equal(isAnimatedArtworkUrl(v), false);
});

// ---- which URLs get a version ----------------------------------------------------

test('isVersionable skips URLs that must stay as the feed gives them', () => {
  assert.equal(isVersionable(COVER), true);
  assert.equal(isVersionable('http://example.com/cover.png'), true);
  // Wavlake: never hit directly, and a new upload gets a new UUID anyway.
  assert.equal(isVersionable('https://d12wklypp119aj.cloudfront.net/image/2cf957e6-38d4-495e-aa32-12fbc19a6f2f.jpg'), false);
  assert.equal(isVersionable('https://www.wavlake.com/art.jpg'), false);
  // Content-addressed (Blossom): the hash IS the version.
  assert.equal(isVersionable(`https://blossom.band/${'a'.repeat(64)}.jpg`), false);
  // Signed: an extra parameter breaks the signature.
  assert.equal(isVersionable('https://b.s3.amazonaws.com/c.jpg?X-Amz-Signature=abc&X-Amz-Expires=60'), false);
  assert.equal(isVersionable('https://cdn.example.com/c.jpg?Expires=1&Signature=x&Key-Pair-Id=y'), false);
  assert.equal(isVersionable('https://cdn.example.com/c.jpg?token=abc'), false);
  // Ours, relative, or not http.
  assert.equal(isVersionable('/api/proxy-image?url=x'), false);
  assert.equal(isVersionable('https://stablekraft.app/stablekraft-rocket.png'), false);
  assert.equal(isVersionable('data:image/png;base64,AAAA'), false);
  assert.equal(isVersionable(''), false);
});

// ---- asking the host --------------------------------------------------------------

test('resolveImageVersion uses HEAD validators when the host sends them', async () => {
  const { impl, calls } = fakeFetch({
    [`HEAD ${COVER}`]: () =>
      new Response(null, {
        status: 200,
        headers: { etag: '"6ab7851f-5b988"', 'last-modified': 'Sat, 26 Sep 2026 08:41:03 GMT', 'content-length': '375176' },
      }),
  });
  const token = await resolveImageVersion(COVER, { fetchImpl: impl });
  assert.match(token!, /^[a-p]{8}$/);
  assert.deepEqual(calls, [`HEAD ${COVER}`]);
});

test('a weak ETag gives the same version as the strong one', async () => {
  const head = (etag: string) =>
    fakeFetch({ [`HEAD ${COVER}`]: () => new Response(null, { status: 200, headers: { etag } }) }).impl;
  assert.equal(
    await resolveImageVersion(COVER, { fetchImpl: head('W/"abc"') }),
    await resolveImageVersion(COVER, { fetchImpl: head('"abc"') })
  );
});

test('a changed file gives a changed version', async () => {
  const head = (etag: string) =>
    fakeFetch({ [`HEAD ${COVER}`]: () => new Response(null, { status: 200, headers: { etag } }) }).impl;
  assert.notEqual(
    await resolveImageVersion(COVER, { fetchImpl: head('"old"') }),
    await resolveImageVersion(COVER, { fetchImpl: head('"new"') })
  );
});

test('with no validators, the bytes are hashed', async () => {
  const bytes = (b: number[]) =>
    fakeFetch({
      [`HEAD ${COVER}`]: () => new Response(null, { status: 200 }),
      [`GET ${COVER}`]: () => new Response(new Uint8Array(b), { status: 200 }),
    });
  const one = bytes([1, 2, 3]);
  const a = await resolveImageVersion(COVER, { fetchImpl: one.impl });
  assert.deepEqual(one.calls, [`HEAD ${COVER}`, `GET ${COVER}`]);
  assert.equal(a, await resolveImageVersion(COVER, { fetchImpl: bytes([1, 2, 3]).impl }));
  assert.notEqual(a, await resolveImageVersion(COVER, { fetchImpl: bytes([1, 2, 4]).impl }));
});

test('a host that refuses HEAD is asked with GET', async () => {
  const { impl } = fakeFetch({
    [`HEAD ${COVER}`]: () => new Response(null, { status: 405 }),
    [`GET ${COVER}`]: () => new Response(new Uint8Array([9]), { status: 200 }),
  });
  assert.match((await resolveImageVersion(COVER, { fetchImpl: impl }))!, /^[a-p]{8}$/);
});

test('failures give null, never a version', async () => {
  const down: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await resolveImageVersion(COVER, { fetchImpl: down }), null);
  const missing = fakeFetch({ [`HEAD ${COVER}`]: () => new Response(null, { status: 404 }) });
  assert.equal(await resolveImageVersion(COVER, { fetchImpl: missing.impl }), null);
  // A private address is refused by the SSRF guard before any request.
  const never: FetchLike = async () => { throw new Error('must not be called'); };
  assert.equal(await resolveImageVersion('http://127.0.0.1/a.jpg', { fetchImpl: never }), null);
});

test('an unversionable URL is never fetched', async () => {
  const never: FetchLike = async () => { throw new Error('must not be called'); };
  assert.equal(await resolveImageVersion('https://www.wavlake.com/art.jpg', { fetchImpl: never }), null);
});

// ---- the refresh entry point ----------------------------------------------------------

const TRACK_ART = 'https://media.basspistol.com/mans1.ch/hiphoptaoist/side-b.jpg';

function hostWith(etags: Record<string, string>) {
  const routes: Record<string, () => Response> = {};
  for (const [url, etag] of Object.entries(etags)) {
    routes[`HEAD ${url}`] = () => new Response(null, { status: 200, headers: { etag } });
  }
  return fakeFetch(routes);
}

test('resolveImageUrls versions every distinct image once, and tracks share the feed URL', async () => {
  const { impl, calls } = hostWith({ [COVER]: '"a"', [TRACK_ART]: '"b"' });
  const map = await resolveImageUrls([COVER, COVER, TRACK_ART, null, undefined], [], { fetchImpl: impl });
  const cover = map(COVER)!;
  assert.match(cover, /\?skv=[a-p]{8}$/);
  assert.equal(stripImageVersion(cover), COVER);
  assert.notEqual(map(TRACK_ART), cover);
  assert.equal(map(null), null);
  assert.equal(map(undefined), undefined);
  assert.equal(calls.length, 2, 'one request per distinct URL');
});

test('resolveImageUrls keeps the stored version when the host cannot be reached', async () => {
  const down: FetchLike = async () => { throw new Error('down'); };
  const stored = withImageVersion(COVER, 'hcpadkfb');
  const map = await resolveImageUrls([COVER], [stored, 'https://other.example/x.jpg'], { fetchImpl: down });
  assert.equal(map(COVER), stored);
  // With nothing stored for that URL, the plain URL goes through unchanged.
  const fresh = await resolveImageUrls([COVER], [], { fetchImpl: down });
  assert.equal(fresh(COVER), COVER);
});

test('resolveImageUrls accepts an already-versioned input and re-checks its base', async () => {
  const { impl } = hostWith({ [COVER]: '"new"' });
  const map = await resolveImageUrls([withImageVersion(COVER, 'aaaaaaaa')], [], { fetchImpl: impl });
  const out = map(withImageVersion(COVER, 'aaaaaaaa'))!;
  assert.equal(stripImageVersion(out), COVER);
  assert.notEqual(out, withImageVersion(COVER, 'aaaaaaaa'));
});

// ---- paths that do not ask the host --------------------------------------------------

test('preserveImageVersion keeps the stored version when the URL is otherwise the same', () => {
  const stored = withImageVersion(COVER, 'hcpadkfb');
  assert.equal(preserveImageVersion(COVER, stored), stored);
  // A different URL is a real change: take it as given.
  assert.equal(preserveImageVersion(TRACK_ART, stored), TRACK_ART);
  // Nothing stored, or nothing new: unchanged.
  assert.equal(preserveImageVersion(COVER, null), COVER);
  assert.equal(preserveImageVersion(undefined, stored), undefined);
  assert.equal(preserveImageVersion(null, stored), null);
});

// ---- every path that overwrites an existing image keeps the version ---------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

test('the podping refresh and the admin re-read ask the host for feed AND track images', () => {
  for (const p of ['app/api/feeds/refresh-by-url/route.ts', 'app/api/admin/feeds/[id]/reparse/route.ts']) {
    const src = read(p);
    assert.match(src, /await resolveImageUrls\(/, p);
    assert.match(src, /image: feedImage,/, `${p}: feed image`);
    assert.match(src, /versionImage\(matchedItem\.image\)/, `${p}: existing tracks`);
    assert.match(src, /image: versionImage\(item\.image\)/, `${p}: new tracks`);
  }
});

test('every other path that overwrites an existing feed image keeps our version', () => {
  // Found by surveying every Feed.image write (2026-09-26). Without the guard,
  // each of these writes the plain URL back and the next podping adds the
  // version again — the URL flips and every cache downloads the art again.
  const paths = [
    'app/api/admin/reparse-feeds/route.ts', // nightly
    'app/api/feeds/[id]/refresh/route.ts',
    'app/api/admin/refresh-all-feeds/route.ts',
    'lib/feed-parsing.ts', // nightly playlist path, Podcast Index image
    'app/api/playlist/parse-feeds-stream/route.ts', // Podcast Index image
  ];
  for (const p of paths) {
    const src = read(p);
    assert.match(src, /preserveImageVersion\(/, p);
    assert.doesNotMatch(src, /^\s*image: parsedFeed\.image,$/m, `${p}: plain RSS image write`);
    assert.doesNotMatch(src, /^\s*image: feedData\.image \|\| undefined,$/m, `${p}: plain PI image write`);
  }
});
