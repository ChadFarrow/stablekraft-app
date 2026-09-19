import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { acceptsGzip, compressedJson, MIN_GZIP_BYTES } from './compressed-json';

const big = { albums: Array.from({ length: 200 }, (_, i) => ({ id: `album-${i}`, title: 'A title' })) };

function req(acceptEncoding?: string): Request {
  return new Request('https://stablekraft.app/api/albums-fast', {
    headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding },
  });
}

test('acceptsGzip: what browsers and Node send', () => {
  assert.equal(acceptsGzip('gzip, deflate, br, zstd'), true);
  assert.equal(acceptsGzip('gzip, deflate'), true);
  assert.equal(acceptsGzip('br;q=1.0, gzip;q=0.8, *;q=0.1'), true);
});

test('acceptsGzip: absent, identity-only, or refused with q=0', () => {
  assert.equal(acceptsGzip(null), false);
  assert.equal(acceptsGzip(''), false);
  assert.equal(acceptsGzip('identity'), false);
  assert.equal(acceptsGzip('br'), false);
  assert.equal(acceptsGzip('gzip;q=0'), false);
  assert.equal(acceptsGzip('gzip; q=0.0, br'), false);
});

test('acceptsGzip: a wildcard allows gzip unless gzip is named and refused', () => {
  assert.equal(acceptsGzip('*'), true);
  assert.equal(acceptsGzip('*;q=0'), false);
  assert.equal(acceptsGzip('gzip;q=0, *'), false);
});

test('gzips a large body, and it decompresses to exactly the JSON', async () => {
  const res = await compressedJson(req('gzip, deflate, br'), big);
  assert.equal(res.headers.get('content-encoding'), 'gzip');
  assert.equal(res.headers.get('content-type'), 'application/json');
  const raw = Buffer.from(await res.arrayBuffer());
  assert.equal(res.headers.get('content-length'), String(raw.byteLength));
  assert.ok(raw.byteLength < JSON.stringify(big).length);
  assert.deepEqual(JSON.parse(gunzipSync(raw).toString('utf8')), big);
});

test('plain JSON when the caller does not accept gzip (curl without --compressed)', async () => {
  const res = await compressedJson(req(), big);
  assert.equal(res.headers.get('content-encoding'), null);
  assert.deepEqual(await res.json(), big);
});

test('plain JSON below the size threshold', async () => {
  const small = { success: true };
  assert.ok(JSON.stringify(small).length < MIN_GZIP_BYTES);
  const res = await compressedJson(req('gzip'), small);
  assert.equal(res.headers.get('content-encoding'), null);
  assert.deepEqual(await res.json(), small);
});

test('Vary: Accept-Encoding on both paths, so a cache cannot mix encodings', async () => {
  for (const ae of ['gzip', undefined]) {
    const res = await compressedJson(req(ae), big);
    assert.match(res.headers.get('vary') ?? '', /Accept-Encoding/i);
  }
});

test('keeps the status and every header the caller passed', async () => {
  const res = await compressedJson(req('gzip'), big, {
    status: 203,
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      'Access-Control-Allow-Origin': 'https://stablekraft.app',
      Vary: 'Origin',
    },
  });
  assert.equal(res.status, 203);
  assert.equal(res.headers.get('cache-control'), 'public, s-maxage=60, stale-while-revalidate=120');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://stablekraft.app');
  assert.equal(res.headers.get('vary'), 'Origin, Accept-Encoding');
});
