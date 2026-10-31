/**
 * npx tsx --test lib/feeds/dead-feed-decision.test.ts
 *
 * The dead-feed sweep's rules, with the RSS Blue shutdown (2026) as the fixture:
 * every feed answers a bare 410, half moved to epochradio.com under the same guid.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideDeadFeed,
  hostOf,
  isHostMove,
  nextPageOffset,
  refreshSaysGone,
  sameFeedUrl,
  type NewHomeCheck,
} from './dead-feed-decision';

const RSSBLUE = 'https://feeds.rssblue.com/raskolnikov';
const EPOCH = 'https://epochradio.com/feed/jack-phemister-raskolnikov';
const home = (over: Partial<NewHomeCheck> = {}): NewHomeCheck => ({
  url: EPOCH, status: 200, isRss: true, guidMatches: true, collidesWith: null, ...over,
});

// --- signals -------------------------------------------------------------------

test('refreshSaysGone reads the message the refresh paths record', () => {
  // lib/rss-parser-db.ts fetchFeedXml → parseRSSFeed wraps it, recordRefreshFailure stores it.
  assert.equal(refreshSaysGone('Failed to parse RSS feed: HTTP 410 Gone'), true);
  assert.equal(refreshSaysGone('Failed to parse RSS feed: Failed to parse RSS feed: HTTP 404 Not Found'), true);
  assert.equal(refreshSaysGone('HTTP 404'), true);
});

test('refreshSaysGone: a refusal or an outage is not "gone"', () => {
  for (const e of ['Failed to parse RSS feed: HTTP 429 Too Many Requests', 'HTTP 403 Forbidden', 'HTTP 500', 'HTTP 4100', 'fetch failed', '', null, undefined]) {
    assert.equal(refreshSaysGone(e as any), false, String(e));
  }
});

test('a different HOST is a move', () => {
  assert.equal(isHostMove(RSSBLUE, EPOCH), true);
  assert.equal(isHostMove('https://feeds.rssblue.com/runnin', 'https://feeds.fountain.fm/nLddnuKGmKvOU9QGTTlL'), true);
});

test('the same feed spelled two ways is NOT a move — no confirm fetch to Wavlake', () => {
  assert.equal(isHostMove('https://wavlake.com/feed/music/abc', 'https://www.wavlake.com/feed/abc'), false);
  assert.equal(isHostMove('http://example.com/feed.xml', 'https://example.com/feed.xml/'), false);
  assert.equal(isHostMove('https://Example.com/a', 'https://www.example.com/b'), false);
});

test('a feed on Wavlake never raises the move signal, even toward another host', () => {
  assert.equal(isHostMove('https://wavlake.com/feed/music/abc', 'https://henrikflyman.com/feed.xml'), false);
});

test('no PI URL, or a junk one, is not a move', () => {
  assert.equal(isHostMove(RSSBLUE, null), false);
  assert.equal(isHostMove(RSSBLUE, ''), false);
  assert.equal(isHostMove(RSSBLUE, 'javascript:alert(1)'), false);
  assert.equal(hostOf('ftp://feeds.rssblue.com/x'), null);
});

test('sameFeedUrl ignores spelling, keeps real differences', () => {
  assert.equal(sameFeedUrl('https://www.Example.com/a%20b/', 'http://example.com/a b'), true);
  assert.equal(sameFeedUrl('https://example.com/a', 'https://example.com/b'), false);
  assert.equal(sameFeedUrl('https://example.com/feed?id=1', 'https://example.com/feed?id=2'), false);
});

// --- decisions -----------------------------------------------------------------

test('RSS Blue, moved: 410 + verified new home → relocate', () => {
  const d = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home() });
  assert.equal(d.action, 'relocate');
  assert.equal(d.action === 'relocate' && d.to, EPOCH);
});

test('RSS Blue, gone: 410 and no new home → hide', () => {
  assert.equal(decideDeadFeed({ signals: ['refresh-gone'], ownStatus: 410 }).action, 'hide');
  assert.equal(decideDeadFeed({ signals: ['pi-dead'], ownStatus: 404, newHome: null }).action, 'hide');
});

test('the new home must prove it is THIS feed', () => {
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ guidMatches: false }) }).action, 'hide');
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ isRss: false }) }).action, 'hide');
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ status: 404 }) }).action, 'hide');
});

test('a new home that did not answer is NOT a reason to hide', () => {
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ status: 'error' }) }).action, 'unconfirmed');
});

test('a new home already in the catalog goes to review — never merged or hidden blind', () => {
  const d = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ collidesWith: 'epoch-raskolnikov' }) });
  assert.equal(d.action, 'needsReview');
  assert.match(d.reason, /epoch-raskolnikov/);
});

test('our URL still serving: only a PI dead flag is worth a human', () => {
  assert.equal(decideDeadFeed({ signals: ['pi-dead'], ownStatus: 200 }).action, 'needsReview');
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 200, newHome: home() }).action, 'ignore');
  assert.equal(decideDeadFeed({ signals: ['refresh-gone'], ownStatus: 200 }).action, 'ignore');
});

test('anything but a hard 404/410 changes nothing', () => {
  for (const s of [403, 429, 500, 503, 301]) {
    assert.equal(decideDeadFeed({ signals: ['refresh-gone', 'moved'], ownStatus: s, newHome: home() }).action, 'unconfirmed', String(s));
  }
  assert.equal(decideDeadFeed({ signals: ['pi-dead'], ownStatus: 'error' }).action, 'unconfirmed');
});

// --- paging --------------------------------------------------------------------

test('a page that HID feeds does not skip the feeds that moved up', () => {
  // 1000 visible feeds, pages of 300. Page 1 hides 40: rows 300..339 are now 260..299.
  assert.equal(nextPageOffset(0, 300, 1000, 40), 260);
  assert.equal(nextPageOffset(0, 300, 1000, 0), 300);
  assert.equal(nextPageOffset(900, 100, 1000, 5), null);
  assert.equal(nextPageOffset(700, 300, 1000, 0), null);
});
