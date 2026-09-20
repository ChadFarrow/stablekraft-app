import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED_IMAGE_DOMAINS } from './cdn-utils';
import {
  DATA_SAVER_KEY,
  DATA_SAVER_QUALITY,
  DATA_SAVER_FALLBACK_ART,
  readDataSaverFlag,
  isOwnImageRoute,
  isGifSource,
  artworkPlan,
  fallbackArtworkSrc,
  isNextOptimizable,
  type ArtworkBaseline,
} from './data-saver';

/** A storage stub. `null` for a key that was never written. */
const storage = (value: string | null) => ({ getItem: (k: string) => (k === DATA_SAVER_KEY ? value : null) });

// ---------------------------------------------------------------- the flag

test('the flag is off unless it is exactly "1"', () => {
  assert.equal(readDataSaverFlag(storage('1')), true);
  assert.equal(readDataSaverFlag(storage('0')), false);
  assert.equal(readDataSaverFlag(storage(null)), false, 'never written');
  assert.equal(readDataSaverFlag(storage('true')), false, 'only "1" counts');
  assert.equal(readDataSaverFlag(storage('')), false);
});

test('unreadable storage reads as OFF, and does not throw', () => {
  // A private window, blocked site data, or a sandboxed iframe. Off is the
  // behaviour every user has today, so it is the safe answer — the same call
  // shape lib/monitoring.ts uses for sk_offline_mode.
  const hostile = {
    getItem() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  };
  assert.equal(readDataSaverFlag(hostile), false);
  assert.equal(readDataSaverFlag(null), false);
  assert.equal(readDataSaverFlag(undefined), false);
});

// ------------------------------------------------- OFF is identical to today

test('OFF returns the caller baseline field for field — this is the contract', () => {
  // Every artwork surface in the app, with the values it uses TODAY. If any of
  // these drift, the promise that "off changes nothing" has been broken and
  // this test is the thing that says so.
  const surfaces: Array<{ name: string; src: string; baseline: ArtworkBaseline }> = [
    // components/AlbumCard.tsx — hardcodes `unoptimized`, no quality prop.
    { name: 'grid card', src: 'https://d12wklypp119aj.cloudfront.net/image/a.jpg', baseline: { quality: 75, unoptimized: true } },
    // components/CDNImage.tsx — quality defaults to 85.
    { name: 'CDNImage remote', src: 'https://music.behindthesch3m3s.com/art.png', baseline: { quality: 85, unoptimized: false } },
    // components/CDNImage.tsx — our own route, already unoptimized today.
    { name: 'CDNImage proxied', src: '/api/proxy-image?url=https%3A%2F%2Fx.test%2Fa.jpg', baseline: { quality: 85, unoptimized: true } },
    // components/ArtworkImage.tsx — no unoptimized, Next handles it.
    { name: 'ArtworkImage', src: 'https://f4.bcbits.com/img/a.jpg', baseline: { quality: 90, unoptimized: false } },
    // An animated cover, which is unoptimized today because Next cannot resize it.
    { name: 'animated cover', src: 'https://www.doerfelverse.com/art/alandace.gif', baseline: { quality: 85, unoptimized: true } },
  ];

  for (const { name, src, baseline } of surfaces) {
    const plan = artworkPlan({ src, dataSaver: false, baseline });
    assert.equal(plan.quality, baseline.quality, `${name}: quality untouched`);
    assert.equal(plan.unoptimized, baseline.unoptimized, `${name}: unoptimized untouched`);
    assert.equal(plan.allowAnimation, true, `${name}: animation still allowed`);
  }
});

test('OFF keeps the caller own fallback artwork', () => {
  assert.equal(fallbackArtworkSrc(false, '/stablekraft-rocket.png'), '/stablekraft-rocket.png');
});

// ------------------------------------------------------------- ON reduces

test('ON lets the optimizer resize a remote cover — the largest single saving', () => {
  // A representative Wavlake cover is 1400x1400 / 1.26 MB, drawn in a 180px
  // box. `unoptimized` on components/AlbumCard.tsx is what stops Next resizing
  // it; 271a6ba8 added that deliberately to fix blurriness, so it is only ever
  // lifted when the user asks.
  const plan = artworkPlan({
    src: 'https://d12wklypp119aj.cloudfront.net/image/a.jpg',
    dataSaver: true,
    baseline: { quality: 75, unoptimized: true },
  });
  assert.equal(plan.unoptimized, false);
  assert.equal(plan.quality, DATA_SAVER_QUALITY);
});

test('ON still refuses to optimize OUR OWN routes — server self-fetch', () => {
  // `unoptimized: false` on a /api/proxy-image URL makes /_next/image fetch our
  // own proxy SERVER-SIDE. That proxy exists solely for browser CORS, which a
  // server fetch does not have. 3b8c1da8 removed exactly that hop; fdc87176
  // wrote the rule down. Data Saver must not reintroduce it by the back door.
  for (const src of [
    '/api/proxy-image?url=https%3A%2F%2Fx.test%2Fa.jpg',
    '/api/optimized-images/autumn.gif',
    '/api/placeholder-image/large',
    '/api/gif-placeholder?url=https%3A%2F%2Fx.test%2Fa.gif',
  ]) {
    assert.equal(isOwnImageRoute(src), true, `${src} is ours`);
    const plan = artworkPlan({ src, dataSaver: true, baseline: { quality: 85, unoptimized: true } });
    assert.equal(plan.unoptimized, true, `${src} must stay unoptimized`);
  }
});

test('ON shows an animated cover as a still frame', () => {
  // Measured live: 7.58 MB and 11.86 MB. A comment in CDNImage cites ~19 MB for
  // Homegrown Hits. The still frame already exists — CDNImage fetches it and
  // then loads the full GIF anyway, so today the placeholder saves latency and
  // no bytes at all.
  for (const src of [
    'https://www.doerfelverse.com/art/alandace.gif',
    'https://x.test/cover.GIF',
    'https://x.test/cover?format=gif',
  ]) {
    assert.equal(isGifSource(src), true, `${src} reads as animated`);
    const plan = artworkPlan({ src, dataSaver: true, baseline: { quality: 85, unoptimized: true } });
    assert.equal(plan.allowAnimation, false, `${src}: animation refused`);
    assert.equal(plan.unoptimized, true, 'the optimizer cannot resize an animation anyway');
  }
});

test('ON swaps the 1.60 MB fallback for the 12 KB one', () => {
  assert.equal(fallbackArtworkSrc(true, '/stablekraft-rocket.png'), DATA_SAVER_FALLBACK_ART);
});

test('a non-animated remote cover still allows animation, so nothing else branches on it', () => {
  const plan = artworkPlan({
    src: 'https://x.test/cover.jpg',
    dataSaver: true,
    baseline: { quality: 85, unoptimized: false },
  });
  assert.equal(plan.allowAnimation, true);
});

// --------------------------------------------- hosts Next cannot even fetch

test('ON refuses to optimize a host Next is not configured to fetch', () => {
  // MEASURED against a dev server: /_next/image answers HTTP 400 — a 30-byte
  // error body — for any host missing from `images.remotePatterns`. Lifting
  // `unoptimized` there does not make the image smaller, it makes it absent.
  // hogstory.net and music.jimmyv4v.com both carry real catalogue artwork and
  // are both absent from that list.
  for (const src of [
    'https://hogstory.net/wp-content/uploads/cover.jpg',
    'https://music.jimmyv4v.com/art.png',
    'https://justcast.sfo2.digitaloceanspaces.com/a/cover.jpg',
  ]) {
    assert.equal(isNextOptimizable(src), false, `${src} is not fetchable by Next`);
    const plan = artworkPlan({ src, dataSaver: true, baseline: { quality: 75, unoptimized: true } });
    assert.equal(plan.unoptimized, true, `${src} must stay unoptimized`);
  }
});

test('ON does optimize the hosts Next IS configured for', () => {
  for (const src of [
    'https://d12wklypp119aj.cloudfront.net/image/a.jpg',
    'https://static.wixstatic.com/media/a.png',
    'https://www.doerfelverse.com/art/a.png',
    'https://f4.bcbits.com/img/a.jpg',
    'https://sub.wavlake.com/a.jpg', // subdomain match
    '/album-placeholder-thumbnail.png', // our own origin, served from public/
  ]) {
    assert.equal(isNextOptimizable(src), true, `${src} is fetchable by Next`);
    const plan = artworkPlan({ src, dataSaver: true, baseline: { quality: 75, unoptimized: true } });
    assert.equal(plan.unoptimized, false, `${src} should be optimized`);
  }
});

test('host matching is dot-boundary, never substring', () => {
  // CLAUDE.md: `includes` accepts wavlake.com.attacker.net.
  assert.equal(isNextOptimizable('https://wavlake.com.attacker.net/a.jpg'), false);
  assert.equal(isNextOptimizable('https://notwavlake.com/a.jpg'), false);
  assert.equal(isNextOptimizable('https://wavlake.com/a.jpg'), true);
});

test('unparseable, data and blob sources are never handed to the optimizer', () => {
  for (const src of ['', 'not a url', 'data:image/gif;base64,R0lGOD', 'blob:http://x/abc']) {
    assert.equal(isNextOptimizable(src), false, JSON.stringify(src));
  }
});

test('every ALLOWED_IMAGE_DOMAINS host is also in next.config.js remotePatterns', () => {
  /*
   * `isNextOptimizable` above trusts ALLOWED_IMAGE_DOMAINS to answer "can
   * /_next/image fetch this". That is only true while the two lists agree, and
   * they are hand-mirrored: next.config.js is CommonJS, loaded before the app,
   * and cannot import the TypeScript one (CLAUDE.md says so about this exact
   * pair). A host added to cdn-utils alone would be handed to the optimizer and
   * answered with HTTP 400 — a missing cover, in Data Saver only, on whichever
   * feed happens to use that host.
   */
  const config = readFileSync(new URL('../next.config.js', import.meta.url), 'utf8');
  const start = config.indexOf('remotePatterns: [');
  assert.ok(start > -1, 'remotePatterns still exists in next.config.js');

  // Walk to the matching bracket rather than regexing to the first `]`.
  let depth = 0;
  let end = start;
  for (let i = config.indexOf('[', start); i < config.length; i++) {
    if (config[i] === '[') depth++;
    else if (config[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  const block = config.slice(start, end);
  const configured = new Set(
    [...block.matchAll(/hostname:\s*'([^']+)'/g)].map((m) => m[1].toLowerCase())
  );
  assert.ok(configured.size > 10, `parsed ${configured.size} hostnames — the parser broke, not the config`);

  const missing = ALLOWED_IMAGE_DOMAINS.filter((d) => !configured.has(d.toLowerCase()));
  assert.deepEqual(missing, [], `hosts in ALLOWED_IMAGE_DOMAINS but not in remotePatterns: ${missing.join(', ')}`);
});
