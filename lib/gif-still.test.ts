import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GIF_STILL_WIDTH,
  CATALOG_GIF_MAX_BYTES,
  parseStillWidth,
  isCatalogCover,
  gifByteCap,
  gifStillSrc,
} from './gif-still';

const DEFAULT_CAP = 12 * 1024 * 1024;
const covers = new Set([
  'https://behindthesch3m3s.com/wp-content/uploads/2024/03/12-Rods-Disco-Frankiepaint-hires.gif',
  'https://www.doerfelverse.com/art/autumn.gif?skv=abcdefgh',
]);

test('the card asks for a 640 px still, the URL-encoded cover in `url`', () => {
  assert.equal(GIF_STILL_WIDTH, 640);
  assert.equal(
    gifStillSrc('https://x.test/a b.gif?skv=q'),
    '/api/gif-placeholder?url=https%3A%2F%2Fx.test%2Fa%20b.gif%3Fskv%3Dq&w=640'
  );
});

test('w is clamped to 64..1024; missing or junk means the original size, as before', () => {
  assert.equal(parseStillWidth('640'), 640);
  assert.equal(parseStillWidth('10'), 64);
  assert.equal(parseStillWidth('99999'), 1024);
  assert.equal(parseStillWidth(null), null);
  assert.equal(parseStillWidth(''), null);
  assert.equal(parseStillWidth('abc'), null);
  assert.equal(parseStillWidth('-5'), null);
});

// The larger read is the abuse surface: it must be bound to the catalogue, not
// to "any public host" — PROXY_HOST_MODE still ships in log mode.
test('only a catalogue cover may be read past the default cap', () => {
  const big = 'https://behindthesch3m3s.com/wp-content/uploads/2024/03/12-Rods-Disco-Frankiepaint-hires.gif';
  assert.equal(gifByteCap(big, covers, DEFAULT_CAP), CATALOG_GIF_MAX_BYTES);
  assert.equal(gifByteCap('https://evil.example/huge.gif', covers, DEFAULT_CAP), DEFAULT_CAP);
  assert.equal(gifByteCap(big + '?x=1', covers, DEFAULT_CAP), DEFAULT_CAP, 'a different URL is not the cover');
  assert.ok(CATALOG_GIF_MAX_BYTES >= 42 * 1024 * 1024, 'the largest cover in the catalogue was 41 MB on 2026-11-01');
});

// Feed.image may carry our own ?skv=<version>; the card may or may not.
test('a cover matches with or without our ?skv image version', () => {
  assert.equal(isCatalogCover('https://www.doerfelverse.com/art/autumn.gif', covers), true);
  assert.equal(isCatalogCover('https://www.doerfelverse.com/art/autumn.gif?skv=zzzzzzzz', covers), true);
  assert.equal(isCatalogCover('https://www.doerfelverse.com/art/other.gif', covers), false);
  assert.equal(isCatalogCover('not a url', covers), false);
});

test('AlbumCard shows the still for a GIF cover and falls back to the full GIF, not the placeholder', () => {
  const source = readFileSync(join(process.cwd(), 'components/AlbumCard.tsx'), 'utf8');
  assert.match(source, /gifStillSrc\(rawCover\)/);
  assert.match(source, /isGifSource\(rawCover\)/);
  assert.match(source, /stillFailed/);
});

test('the still-frame route reads the cap through gifByteCap and resizes through parseStillWidth', () => {
  const source = readFileSync(join(process.cwd(), 'app/api/gif-placeholder/route.ts'), 'utf8');
  assert.match(source, /gifByteCap\(/);
  assert.match(source, /parseStillWidth\(/);
  assert.doesNotMatch(source, /readCappedArrayBuffer\(response, MAX_IMAGE_BYTES\)/, 'the old fixed cap');
});
