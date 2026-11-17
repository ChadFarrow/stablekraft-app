// Run: npx tsx --test lib/feeds/exists-response.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guidExistsBody } from './exists-response';

/**
 * A podping may name a feed as `podcast:guid:<guid>` instead of by URL. The
 * podping service asks `GET /api/feeds/exists?guid=`, but refresh-by-url needs a
 * URL, and the service has no way to turn a guid into one — so it logged
 * "no URL variant in podping; skip refresh" and the update was lost. We already
 * hold the URL for every feed we know by guid, so `exists` hands it back.
 */

test('a known guid answers exists with the URL we store for it', () => {
  assert.deepEqual(guidExistsBody({ originalUrl: 'https://pc2.basspistol.com/mans1/Hip-Hop_Taoists.xml' }), {
    exists: true,
    url: 'https://pc2.basspistol.com/mans1/Hip-Hop_Taoists.xml',
  });
});

test('an unknown guid answers exists: false, with no url', () => {
  assert.deepEqual(guidExistsBody(null), { exists: false });
});

test('a blacklisted feed answers exists: false, the same as a URL lookup does', () => {
  assert.deepEqual(guidExistsBody({ originalUrl: 'https://zine.bitpunk.fm/feeds/unwound.xml' }), { exists: false });
});

test('the exists route builds its guid answer from the helper', () => {
  const src = readFileSync(join(process.cwd(), 'app/api/feeds/exists/route.ts'), 'utf8');
  assert.match(src, /guidExistsBody\(/);
  assert.match(src, /select: \{[^}]*originalUrl: true/);
});
