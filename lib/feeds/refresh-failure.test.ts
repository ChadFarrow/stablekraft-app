// Run: npx tsx --test lib/feeds/refresh-failure.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordRefreshFailure, refreshFailureData } from './refresh-failure';

test('a failed refresh of a feed with tracks records the error and leaves the feed visible', () => {
  const data = refreshFailureData('HTTP 429 Too Many Requests', true);
  assert.equal(data.lastError, 'HTTP 429 Too Many Requests');
  assert.ok(data.lastFetched instanceof Date);
  assert.equal('status' in data, false);
});

test('a failed refresh of a feed with no tracks marks it error, as before', () => {
  const data = refreshFailureData('Unable to parse XML.', false);
  assert.equal(data.status, 'error');
  assert.equal(data.lastError, 'Unable to parse XML.');
});

test('recordRefreshFailure counts the tracks of THAT feed and writes the matching shape', async () => {
  const writes: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const fakeDb = (trackCount: number) => ({
    track: {
      count: async (args: { where: { feedId: string } }) => {
        assert.deepEqual(args.where, { feedId: 'feed-1' });
        return trackCount;
      },
    },
    feed: {
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        writes.push(args);
        return {};
      },
    },
  });

  await recordRefreshFailure(fakeDb(12) as any, 'feed-1', 'HTTP 429');
  await recordRefreshFailure(fakeDb(0) as any, 'feed-1', 'HTTP 404');

  assert.deepEqual(writes.map((w) => w.where), [{ id: 'feed-1' }, { id: 'feed-1' }]);
  assert.equal('status' in writes[0].data, false);
  assert.equal(writes[1].data.status, 'error');
});

// ---- every refresh path goes through it ---------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// What `status: 'error'` beside a `lastError` write looks like. It hides the feed from
// every listing (albums-fast, search, publishers all filter status 'active').
const HIDING_WRITE = /status: 'error',\s*\n\s*lastError/;

test('every path that refreshes an existing feed records a failure through recordRefreshFailure', () => {
  // Found by surveying every `status: 'error'` write (2026-10-18). The nightly reparse
  // marked ~2,000 Wavlake feeds error on every run — the host refused the burst — and the
  // recovery step that sets them back sometimes ran before the reparse finished, so about
  // half the catalog stayed hidden until the next night.
  const paths = [
    'app/api/admin/reparse-feeds/route.ts', // nightly
    'app/api/admin/refresh-all-feeds/route.ts',
    'app/api/feeds/refresh-by-url/route.ts', // podping
    'app/api/admin/feeds/[id]/reparse/route.ts',
    'app/api/feeds/[id]/refresh/route.ts',
  ];
  for (const p of paths) {
    const src = read(p);
    assert.match(src, /recordRefreshFailure\(prisma, /, p);
    assert.doesNotMatch(src, HIDING_WRITE, `${p}: writes status 'error' itself`);
  }
});

test('nothing else writes status error beside lastError, except a brand-new feed row', () => {
  // POST /api/feeds creates a `feed-error-*` row when the first parse fails; that row has no
  // tracks, so the rule above would mark it error anyway.
  const allowed = new Set(['app/api/feeds/route.ts']);
  const offenders: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const entry of readdirSync(join(process.cwd(), dir), { recursive: true }) as string[]) {
      const p = `${dir}/${entry}`;
      if (!/\.tsx?$/.test(p) || p.endsWith('.test.ts') || allowed.has(p)) continue;
      if (HIDING_WRITE.test(read(p))) offenders.push(p);
    }
  }
  assert.deepEqual(offenders, []);
});
