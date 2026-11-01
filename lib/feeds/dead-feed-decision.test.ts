/**
 * npx tsx --test lib/feeds/dead-feed-decision.test.ts
 *
 * The dead-feed sweep's rules, with the RSS Blue shutdown (2026) as the fixture:
 * every feed answers a bare 410, half moved to epochradio.com under the same guid.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAudioCheck,
  audioVerdict,
  decideDeadFeed,
  hostOf,
  isHostMove,
  matchTracksByGuid,
  nextPageOffset,
  refreshSaysGone,
  sameFeedUrl,
  type NewHomeCheck,
} from './dead-feed-decision';

const RSSBLUE = 'https://feeds.rssblue.com/raskolnikov';
const EPOCH = 'https://epochradio.com/feed/jack-phemister-raskolnikov';
const home = (over: Partial<NewHomeCheck> = {}): NewHomeCheck => ({
  url: EPOCH, status: 200, isRss: true, guidMatches: true, collidesWith: null, tracks: { stored: 1, matched: 1 }, ...over,
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
  // An RSS feed that declares another guid, or a URL that is gone too: no new home.
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ guidMatches: false }) }).action, 'hide');
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ status: 404 }) }).action, 'hide');
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ status: 410 }) }).action, 'hide');
});

test('a new home that did not answer is NOT a reason to hide', () => {
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ status: 'error' }) }).action, 'unconfirmed');
});

test('a new home that refuses or fails FOR NOW is not a reason to hide either', () => {
  // A hide is permanent for the sweep (it reads only markedDead:false), so a 429 on
  // one Monday would hide a playable album for good.
  for (const s of [403, 429, 500, 502, 503, 301]) {
    const d = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ status: s, isRss: false, guidMatches: false }) });
    assert.equal(d.action, 'unconfirmed', String(s));
    assert.match(d.reason, new RegExp(`HTTP ${s}`));
  }
  // A 200 that is not RSS — a challenge page, a parked domain — proves nothing.
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ isRss: false, guidMatches: false }) }).action, 'unconfirmed');
});

test('a new home on the feed blacklist is never moved to — the album is hidden', () => {
  // lib/feed-exclusions.ts bans this exact URL; every import path refuses it.
  const banned = 'https://epochradio.com/feed/phantom-power-business-hour';
  const d = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ url: banned }) });
  assert.equal(d.action, 'hide');
  assert.match(d.reason, /blacklist/);
  // The blacklist matches loosely (scheme, slash), like every other path that asks it.
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ url: `${banned}/` }) }).action, 'hide');
});

test('a move stores the URL the way every write path does (normalizeUrl)', () => {
  const d = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ url: `${EPOCH}/` }) });
  assert.equal(d.action === 'relocate' && d.to, EPOCH);
  const f = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ url: 'http://feeds.fountain.fm/nLddnuKGmKvOU9QGTTlL' }) });
  assert.equal(f.action === 'relocate' && f.to, 'https://feeds.fountain.fm/nLddnuKGmKvOU9QGTTlL');
});

test('a move whose tracks changed their item guids goes to review — a refresh would list them twice', () => {
  // refresh-by-url matches by item guid (then by the old, dead audio URL) and never
  // deletes a track, so every unmatched item would be added beside a dead copy.
  const d = decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ tracks: { stored: 10, matched: 0 } }) });
  assert.equal(d.action, 'needsReview');
  assert.match(d.reason, /0 of 10/);
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ tracks: { stored: 10, matched: 9 } }) }).action, 'needsReview');
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ tracks: { stored: 10, matched: 10 } }) }).action, 'relocate');
  // No tracks stored: nothing to duplicate.
  assert.equal(decideDeadFeed({ signals: ['moved'], ownStatus: 410, newHome: home({ tracks: { stored: 0, matched: 0 } }) }).action, 'relocate');
});

// --- moving the audio with the feed --------------------------------------------

const OLD_AUDIO = 'https://op3.dev/e,pg=c8ee8930-289b-5e6f-b5a2-d9305897b620/media.rssblue.com/raskolnikov.mp3';
const NEW_AUDIO = 'https://op3.dev/e,pg=c8ee8930-289b-5e6f-b5a2-d9305897b620/files.epochradio.com/raskolnikov.mp3';

test('matchTracksByGuid: each stored track takes the audio its item guid has in the new feed', () => {
  const m = matchTracksByGuid(
    [{ id: 't1', guid: 'g1', audioUrl: OLD_AUDIO }, { id: 't2', guid: 'g2', audioUrl: NEW_AUDIO }],
    [{ guid: 'g1', audioUrl: NEW_AUDIO }, { guid: 'g2', audioUrl: NEW_AUDIO }, { guid: 'g3', audioUrl: 'https://x/bonus.mp3' }]
  );
  assert.deepEqual({ stored: m.stored, matched: m.matched }, { stored: 2, matched: 2 });
  // Only the track whose audio actually changes is written; a bonus item is not ours to add here.
  assert.deepEqual(m.audioMoves, [{ id: 't1', audioUrl: NEW_AUDIO }]);
});

test('matchTracksByGuid: a track with no guid, or an item with no audio, does not match', () => {
  const m = matchTracksByGuid(
    [{ id: 't1', guid: null, audioUrl: OLD_AUDIO }, { id: 't2', guid: 'g2', audioUrl: OLD_AUDIO }, { id: 't3', guid: 'g3', audioUrl: OLD_AUDIO }],
    [{ guid: 'g2', audioUrl: null }, { guid: 'g3', audioUrl: NEW_AUDIO }, { guid: undefined, audioUrl: NEW_AUDIO }]
  );
  assert.deepEqual({ stored: m.stored, matched: m.matched }, { stored: 3, matched: 1 });
  assert.deepEqual(m.audioMoves, [{ id: 't3', audioUrl: NEW_AUDIO }]);
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

// --- never hide an album that still plays ------------------------------------
// 4 of the 126 RSS Blue albums with no new home kept their audio on Fountain
// (Catacomb, lemons, socrates, Worried): the feed answers 410, the tracks play.

test('audioVerdict: one track that plays keeps the album', () => {
  const v = audioVerdict([{ status: 410 }, { status: 206, contentType: 'audio/mpeg' }], 2);
  assert.deepEqual(v, { verdict: 'plays', playing: 1, probed: 2 });
  // A 200 whose type is not a web page counts as playable — be generous here.
  assert.equal(audioVerdict([{ status: 200, contentType: 'application/octet-stream' }], 1).verdict, 'plays');
  assert.equal(audioVerdict([{ status: 200, contentType: null }], 1).verdict, 'plays');
});

test('audioVerdict: 404, 410 and a web page in place of the audio are silent', () => {
  // Stereon Music: one track 410, the other redirected to the rssblue.com home page.
  assert.equal(audioVerdict([{ status: 410 }, { status: 200, contentType: 'text/html; charset=utf-8' }], 2).verdict, 'silent');
  assert.equal(audioVerdict([{ status: 404 }], 1).verdict, 'silent');
});

test('audioVerdict: an error, a refusal or an outage proves nothing', () => {
  for (const s of ['error', 401, 403, 429, 500, 503, 302] as const) {
    assert.equal(audioVerdict([{ status: 410 }, { status: s }], 2).verdict, 'unknown', String(s));
  }
});

test('audioVerdict: silent needs EVERY stored track checked', () => {
  // The route stops probing at a cap; an unprobed track might play.
  assert.equal(audioVerdict([{ status: 410 }, { status: 410 }], 3).verdict, 'unknown');
  // No tracks stored: nothing that plays can be lost.
  assert.equal(audioVerdict([], 0).verdict, 'silent');
});

test('a dead feed whose tracks still play is never hidden — it goes to review', () => {
  const d = applyAudioCheck({ action: 'hide', reason: 'HTTP 410' }, audioVerdict([{ status: 206, contentType: 'audio/mpeg' }], 1));
  assert.equal(d.action, 'needsReview');
  assert.match(d.reason, /HTTP 410/);
  assert.match(d.reason, /1 track\(s\) still play/);
});

test('a hide waits when the audio could not be checked', () => {
  const d = applyAudioCheck({ action: 'hide', reason: 'HTTP 410' }, audioVerdict([{ status: 'error' }], 1));
  assert.equal(d.action, 'unconfirmed');
  assert.match(d.reason, /could not be checked/);
});

test('a silent feed is hidden, and the reason says no track plays', () => {
  const d = applyAudioCheck({ action: 'hide', reason: 'HTTP 410' }, audioVerdict([{ status: 410 }, { status: 410 }], 2));
  assert.equal(d.action, 'hide');
  assert.match(d.reason, /HTTP 410; none of 2 track\(s\) plays/);
  assert.equal(applyAudioCheck({ action: 'hide', reason: 'HTTP 410' }, audioVerdict([], 0)).action, 'hide');
});

test('applyAudioCheck changes only a hide', () => {
  const plays = audioVerdict([{ status: 206, contentType: 'audio/mpeg' }], 1);
  const relocate = { action: 'relocate' as const, to: EPOCH, reason: 'moved' };
  assert.deepEqual(applyAudioCheck(relocate, plays), relocate);
  const review = { action: 'needsReview' as const, reason: 'x' };
  assert.deepEqual(applyAudioCheck(review, plays), review);
});
