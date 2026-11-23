import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
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

/**
 * The album DETAIL route is the second most visited, and it answered every album
 * as raw JSON while the catalog routes around it were gzipped. Every success
 * return must go through compressedJson; a new branch added with
 * NextResponse.json would silently go back to raw. Redirects, 404s and 500s are
 * small, and stay as they are.
 */
test('/api/albums/[slug] gzips every album it returns', () => {
  const source = readFileSync(new URL('../app/api/albums/[slug]/route.ts', import.meta.url), 'utf8');
  const successReturns = source.match(/return compressedJson\(request, \{\s*album: /g) ?? [];
  // Five since the Top 100 branch was removed (2026-11-01); it was the sixth.
  assert.ok(successReturns.length >= 5, `expected the album returns to use compressedJson, found ${successReturns.length}`);
  assert.doesNotMatch(
    source,
    /NextResponse\.json\(\{\s*album: (?!null)/,
    'an album is returned with NextResponse.json — use compressedJson, or it ships uncompressed'
  );
});

/**
 * Next sends a route handler's Response through its own `sendResponse`, and that
 * function decides which headers reach the wire. Next 15.5.29 started dropping
 * `content-encoding`, `content-length` and `transfer-encoding` from every route
 * response (its fix for GHSA-pc58-hwjq-p385), so the gzipped body went out with
 * no Content-Encoding: browsers read gzip bytes as JSON, and the catalog, album
 * page, search and every playlist broke — under a green build, typecheck and
 * this file's other tests, which all stop at the Response object. Found on a
 * production build of the upgrade, 2026-11-22. This drives Next's real
 * sendResponse over a real socket, so an upgrade that strips the header fails
 * here instead of on stablekraft.app.
 */
test("Next's sendResponse keeps compressedJson's Content-Encoding on the wire", async () => {
  const { createServer, get } = await import('node:http');
  const { sendResponse } = await import('next/dist/server/send-response.js');
  const { NodeNextRequest, NodeNextResponse } = await import('next/dist/server/base-http/node.js');

  const server = createServer(async (rawReq, rawRes) => {
    const response = await compressedJson(req('gzip, deflate, br'), big);
    await sendResponse(new NodeNextRequest(rawReq as never), new NodeNextResponse(rawRes), response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    // node:http, not fetch: fetch would decode the body and hide a missing header.
    const { headers, body } = await new Promise<{ headers: Record<string, unknown>; body: Buffer }>(
      (resolve, reject) => {
        get({ host: '127.0.0.1', port, path: '/', headers: { 'accept-encoding': 'gzip' } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        }).on('error', reject);
      }
    );
    assert.equal(
      headers['content-encoding'],
      'gzip',
      'Next dropped Content-Encoding from a route response: compressedJson now ships gzip bytes as plain JSON (see CLAUDE.md, "Next is pinned to 15.5.28")'
    );
    assert.deepEqual(JSON.parse(gunzipSync(body).toString('utf8')), big);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
