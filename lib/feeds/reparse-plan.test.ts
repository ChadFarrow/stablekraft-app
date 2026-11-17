/**
 * The nightly reparse's plan: which Wavlake feeds are due (Podcast Index decides),
 * and how a run's errors are classed.
 *
 *   npx tsx --test lib/feeds/reparse-plan.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  categorizeReparseError,
  isWavlakeFeedUrl,
  planWavlakeLane,
  wavlakeDue,
  type WavlakeCandidate,
} from './reparse-plan';

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = Date.parse('2026-11-01T15:00:00Z');
const CUTOFF = NOW - 24 * H; // maxAgeHours=24
const LOOKBACK = 60 * D;
const sec = (ms: number) => Math.floor(ms / 1000);
const feed = (over: Partial<WavlakeCandidate> = {}): WavlakeCandidate => ({
  id: 'f', guid: '6ba9abcf-919b-5a90-bd3d-0c9e1dea24fd', lastFetched: new Date(NOW - 30 * H), lastError: null, ...over,
});

test('isWavlakeFeedUrl: the host, dot-boundary, never a substring', () => {
  for (const u of [
    'https://wavlake.com/feed/music/60e747dd-97d7-466a-a2e8-59ba524a58ea',
    'https://www.wavlake.com/feed/223da92c-945d-44d0-ba43-1f7e5648e72f',
    'https://WWW.WAVLAKE.COM/feed/x',
  ]) assert.equal(isWavlakeFeedUrl(u), true, u);
  for (const u of [
    'https://wavlake.com.evil.net/feed/x',
    'https://notwavlake.com/feed/x',
    'https://example.com/?u=https://wavlake.com/feed/x',
    'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
    'not a url',
  ]) assert.equal(isWavlakeFeedUrl(u), false, u);
});

test('wavlakeDue: attempted within the window → not due, whatever PI says', () => {
  assert.equal(wavlakeDue(feed({ lastFetched: new Date(NOW - 2 * H) }), sec(NOW - H), NOW, CUTOFF, LOOKBACK), false);
  assert.equal(wavlakeDue(feed({ lastFetched: new Date(NOW - 2 * H), lastError: 'HTTP 429' }), sec(NOW - H), NOW, CUTOFF, LOOKBACK), false,
    'a failure in this window is not retried in the same window — repeated calls in one night must finish');
});

test('wavlakeDue: never fetched → due, even with no PI record', () => {
  assert.equal(wavlakeDue(feed({ lastFetched: null }), undefined, NOW, CUTOFF, LOOKBACK), true);
});

test('wavlakeDue: PI saw a change after our last attempt → due', () => {
  assert.equal(wavlakeDue(feed(), sec(NOW - 26 * H), NOW, CUTOFF, LOOKBACK), true);
});

test('wavlakeDue: unchanged since our last attempt → not due (the common case: albums do not change)', () => {
  assert.equal(wavlakeDue(feed(), sec(Date.parse('2025-01-16T02:52:22Z')), NOW, CUTOFF, LOOKBACK), false);
});

test('wavlakeDue: the catch-up — last attempt FAILED and PI saw a change within the lookback', () => {
  // Changed 20 days ago; every nightly attempt since was refused, the last one 30 h ago.
  const changed = sec(NOW - 20 * D);
  assert.equal(wavlakeDue(feed({ lastError: 'HTTP 429 Too Many Requests' }), changed, NOW, CUTOFF, LOOKBACK), true);
  assert.equal(wavlakeDue(feed({ lastError: null }), changed, NOW, CUTOFF, LOOKBACK), false, 'a success after the change already has the data');
  assert.equal(wavlakeDue(feed({ lastError: 'HTTP 429' }), sec(NOW - 90 * D), NOW, CUTOFF, LOOKBACK), false, 'outside the lookback');
});

test('wavlakeDue: no PI record, or a bad one → not due (podping still refreshes it)', () => {
  assert.equal(wavlakeDue(feed(), undefined, NOW, CUTOFF, LOOKBACK), false);
  assert.equal(wavlakeDue(feed({ lastError: 'HTTP 429' }), undefined, NOW, CUTOFF, LOOKBACK), false);
  assert.equal(wavlakeDue(feed(), Number.NaN, NOW, CUTOFF, LOOKBACK), false);
});

test('planWavlakeLane: picks the due ones, freshest change first, and counts what PI could not answer', () => {
  const pi = new Map<string, number>([
    ['a', sec(NOW - 26 * H)], // changed since our attempt
    ['b', sec(NOW - 400 * D)], // unchanged
    ['c', sec(NOW - 25 * H)], // changed, more recently than a
    ['d', sec(NOW - 10 * D)], // changed 10 days ago, our last attempt failed
  ]);
  const plan = planWavlakeLane(
    [
      feed({ id: 'A', guid: 'A' }), // guids are matched case-insensitively
      feed({ id: 'B', guid: 'b' }),
      feed({ id: 'C', guid: 'c' }),
      feed({ id: 'D', guid: 'd', lastError: 'HTTP 429' }),
      feed({ id: 'E', guid: 'e' }), // not in PI
      feed({ id: 'F', guid: null }), // no guid
      feed({ id: 'G', guid: null, lastFetched: null }), // never fetched
    ],
    pi, NOW, CUTOFF, LOOKBACK,
  );
  assert.deepEqual(plan.due.map((f) => f.id), ['G', 'C', 'A', 'D']);
  assert.equal(plan.notInPI, 1);
  assert.equal(plan.noGuid, 2);
});

test('categorizeReparseError: a refusal is named, not filed under OTHER', () => {
  assert.equal(categorizeReparseError('HTTP 429 Too Many Requests'), 'RATE_LIMITED_429');
  assert.equal(categorizeReparseError('HTTP 410 Gone'), 'GONE_410');
  assert.equal(categorizeReparseError('The operation was aborted due to timeout'), 'TIMEOUT');
  assert.equal(categorizeReparseError('HTTP 404 Not Found'), 'NOT_FOUND_404');
  assert.equal(categorizeReparseError('getaddrinfo ENOTFOUND feeds.example'), 'DNS_LOOKUP_FAILED');
  assert.equal(categorizeReparseError('something odd'), 'OTHER');
});

test('the route keeps Wavlake out of the parallel batches and honours the time budget', () => {
  const src = readFileSync(new URL('../../app/api/admin/reparse-feeds/route.ts', import.meta.url), 'utf8');
  assert.match(src, /filter\(\(f\) => !isWavlakeFeedUrl\(f\.originalUrl\)\)/, 'lane 1 must drop Wavlake feeds');
  assert.match(src, /planWavlakeLane\(/, 'lane 2 must be planned from Podcast Index');
  assert.match(src, /if \(!budgetLeft\(\)\) break;[\s\S]*if \(!budgetLeft\(\)\) break;/, 'both lanes must stop when the budget is spent');
  assert.match(src, /remaining,/, 'the answer must report what is left');
  assert.match(src, /if \(wavlakeMode === 'changed' && wavlakeCandidates\.length > 0\) \{/,
    'the PI lookup must not wait for budget — otherwise a spent budget reports remaining 0 and Wavlake never runs');
  assert.equal(/function categorizeError\(/.test(src), false, 'one classifier, in reparse-plan.ts');
});

test('the workflow calls again while work remains, and never waits past Railway\'s 300 s', () => {
  const wf = readFileSync(new URL('../../.github/workflows/refresh-playlists.yml', import.meta.url), 'utf8');
  const step = wf.slice(wf.indexOf('Step 2: Reparse ALL music feeds'), wf.indexOf('Step 2b:'));
  assert.match(step, /api\/admin\/reparse-feeds\?[^"]*budgetSeconds=\d+/, 'the call must pass a budget');
  assert.match(step, /--max-time\s+(\d+)/, 'curl must give up before the edge does');
  const maxTime = Number(step.match(/--max-time\s+(\d+)/)![1]);
  assert.ok(maxTime < 300, `--max-time ${maxTime} must be under Railway's 300 s`);
  assert.match(step, /\.remaining/, 'the loop must read `remaining`');
  assert.match(step, /errorSummary/, 'the log must show what failed, not just how many');
});
