import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { setCatalogHostLoaderForTests } from './proxy-host-allowlist';
import { MAX_IMAGE_BYTES } from './safe-fetch';

/**
 * /api/proxy-image against an image bigger than MAX_IMAGE_BYTES, end to end
 * through the real route handler. `fetch` is stubbed; safeFetch reads the
 * global at call time and isSafePublicUrl does no DNS, so nothing leaves the
 * process.
 *
 * Pixel Palace (2026-10-24): its 18 MB cover GIF, and a 41 MB 12 Rods GIF,
 * rendered as the placeholder because the proxy will not buffer that much.
 */

const ARTIST_HOST = 'music.example-artist.com';
setCatalogHostLoaderForTests(async () => new Set([ARTIST_HOST]));

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  setCatalogHostLoaderForTests(null);
});

/** Serve `bytes` of GIF for every request, and record whether the body was abandoned. */
function stubImage(bytes: number, { declareLength = true } = {}) {
  const seen = { requests: 0, cancelled: false };
  globalThis.fetch = (async () => {
    seen.requests += 1;
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        const n = Math.min(chunk.byteLength, bytes - sent);
        sent += n;
        controller.enqueue(chunk.slice(0, n));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    const headers: Record<string, string> = { 'content-type': 'image/gif' };
    if (declareLength) headers['content-length'] = String(bytes);
    return new Response(body, { status: 200, headers });
  }) as typeof fetch;
  return seen;
}

async function proxy(imageUrl: string, fetchDest?: string) {
  const { GET } = await import('../app/api/proxy-image/route');
  const headers: Record<string, string> = {};
  if (fetchDest) headers['sec-fetch-dest'] = fetchDest;
  return GET(
    new NextRequest(`http://localhost:3000/api/proxy-image?url=${encodeURIComponent(imageUrl)}`, { headers })
  );
}

const OVER = MAX_IMAGE_BYTES + 5 * 1024 * 1024;

test('an <img> load of an oversized catalog image is redirected to the artist host', async () => {
  const seen = stubImage(OVER);
  const url = `https://${ARTIST_HOST}/pixel_palace/pixel%20palace%20show%20art.gif`;
  const res = await proxy(url, 'image');

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), url);
  assert.match(res.headers.get('vary') ?? '', /sec-fetch-dest/i, 'a cached redirect must not answer a fetch()');
  assert.equal(seen.cancelled, true, 'the declared length is enough; the body is not downloaded');
});

test('a body with no Content-Length that runs past the cap is redirected too', async () => {
  stubImage(OVER, { declareLength: false });
  const url = `https://${ARTIST_HOST}/chunked/big.gif`;
  const res = await proxy(url, 'image');

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), url);
});

test('a navigation to the same URL gets the placeholder, not a redirect', async () => {
  stubImage(OVER);
  const res = await proxy(`https://${ARTIST_HOST}/nav/big.gif`, 'document');

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-image-placeholder'), 'true');
  assert.match(res.headers.get('vary') ?? '', /sec-fetch-dest/i, 'a cached placeholder must not answer a later <img>');
});

test('fetch() and header-less callers keep the placeholder', async () => {
  for (const dest of ['empty', undefined]) {
    stubImage(OVER);
    const res = await proxy(`https://${ARTIST_HOST}/fetch/${dest ?? 'none'}.gif`, dest);
    assert.equal(res.status, 200, `dest=${dest}`);
    assert.equal(res.headers.get('x-image-placeholder'), 'true', `dest=${dest}`);
  }
});

test('an oversized image on a host the catalog does not reference gets the placeholder', async () => {
  stubImage(OVER);
  const res = await proxy('https://attacker.example/big.gif', 'image');

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-image-placeholder'), 'true');
  assert.equal(res.headers.get('location'), null);
});
