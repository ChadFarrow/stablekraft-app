/**
 * What the dead-feed sweep (`/api/admin/check-dead-feeds`) does with one feed.
 *
 * Imports only pure modules (no database, no network), so `dead-feed-decision.test.ts`
 * loads the shipping module — and the shipping blacklist.
 *
 * WHY THIS EXISTS. RSS Blue shut down (2026), and every one of its feeds answers
 * 410 Gone. 266 albums stayed in the catalog as "active" for months, none of them
 * playable, because the sweep only ever looked at feeds Podcast Index had marked
 * `dead` — and PI had last crawled them on 2026-05-27, when they still answered 200.
 * Half of those albums had not gone anywhere: the artists re-published them on
 * epochradio.com and Fountain under the SAME `<podcast:guid>` (and, on the albums
 * checked, the same item guids), and PI's record for that guid already points there. Nothing
 * redirects (a bare 410, no `Location`), so the guid is the only thread to follow.
 *
 * So a feed becomes a CANDIDATE on any of three signals, and is only ever acted on
 * after its own URL is fetched and answers a hard 404/410:
 *   - `pi-dead`       PI's crawler marked it dead (the original signal)
 *   - `refresh-gone`  our own refresh recorded `HTTP 404`/`HTTP 410` in `lastError`
 *   - `moved`         PI's record for our guid now lives on a DIFFERENT HOST
 *
 * A confirmed-dead feed whose guid has a verified new home — answers 200, is RSS,
 * declares the same `<podcast:guid>`, is not blacklisted, and lists every stored track
 * under the same item guid — is RELOCATED (its `originalUrl` and its tracks' audio
 * move together); a new home that is gone too, or another feed, means HIDDEN via
 * `markedDead`. Anything uncertain — including a new home that fails for now — is
 * reported, not acted on.
 */

import { isBlacklistedFeedUrl } from '../feed-exclusions';
import { normalizeUrl } from '../url-utils';

export type DeadFeedSignal = 'pi-dead' | 'refresh-gone' | 'moved';

/** True when a refresh's recorded error is a hard "this URL is gone". */
export function refreshSaysGone(lastError: string | null | undefined): boolean {
  return typeof lastError === 'string' && /\bHTTP (404|410)\b/.test(lastError);
}

/** Lower-cased host without a leading `www.`, or null for anything that is not an http(s) URL. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const isWavlake = (host: string) => host === 'wavlake.com' || host.endsWith('.wavlake.com');

/**
 * The cheap, catalog-wide MOVE signal: PI's record for our guid lives on another host.
 *
 * Same-host differences (`wavlake.com/feed/music/<id>` vs `www.wavlake.com/feed/<id>`,
 * http vs https, a trailing slash) are NOT a move — they are the same feed spelled two
 * ways, and treating them as candidates would send a confirm fetch to Wavlake for
 * thousands of feeds, which 429-rate-limits Railway after ~50. A feed whose OWN host is
 * Wavlake never raises this signal for the same reason; Wavlake removals reach the sweep
 * through `pi-dead` and `refresh-gone`.
 */
export function isHostMove(ourUrl: string, piUrl: string | null | undefined): boolean {
  const ours = hostOf(ourUrl);
  const theirs = hostOf(piUrl);
  if (!ours || !theirs || ours === theirs) return false;
  return !isWavlake(ours);
}

/** Two spellings of the same feed URL: host case, `www.`, scheme, trailing slash, percent-encoding. */
export function sameFeedUrl(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      const u = new URL(s);
      let path = u.pathname;
      try { path = decodeURI(path); } catch { /* keep as is */ }
      return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path.replace(/\/+$/, '')}${u.search}`;
    } catch {
      return s.trim();
    }
  };
  return norm(a) === norm(b);
}

export type ConfirmStatus = number | 'error';

export interface NewHomeCheck {
  url: string;
  status: ConfirmStatus;
  isRss: boolean;
  /** The new feed's channel-level `<podcast:guid>` equals ours. */
  guidMatches: boolean;
  /** Another catalog row already holds this URL. */
  collidesWith: string | null;
  /** Our stored tracks, and how many of them the new feed lists under the same item guid. */
  tracks: { stored: number; matched: number };
}

export interface StoredTrack {
  id: string;
  guid: string | null;
  audioUrl: string | null;
}

export interface NewFeedItem {
  guid?: string | null;
  audioUrl?: string | null;
}

/**
 * Which of our tracks the new feed still lists, and the audio each should now play.
 *
 * Matches the way `refresh-by-url` and the nightly reparse do — exact item guid,
 * through a `Map`, so a guid listed twice resolves to its last item there too. Their
 * fallback match on the stored `audioUrl` is left out on purpose: after a host shut
 * down, that URL is the dead one, so it never matches anything in the new feed.
 *
 * An item with no enclosure does not count: re-pointing a track at nothing would
 * leave it as unplayable as before.
 */
export function matchTracksByGuid(
  stored: StoredTrack[],
  items: NewFeedItem[]
): { stored: number; matched: number; audioMoves: Array<{ id: string; audioUrl: string }> } {
  const byGuid = new Map(items.filter((i) => i.guid).map((i) => [i.guid as string, i]));
  let matched = 0;
  const audioMoves: Array<{ id: string; audioUrl: string }> = [];
  for (const t of stored) {
    const audioUrl = t.guid ? byGuid.get(t.guid)?.audioUrl : null;
    if (!audioUrl) continue;
    matched++;
    if (audioUrl !== t.audioUrl) audioMoves.push({ id: t.id, audioUrl });
  }
  return { stored: stored.length, matched, audioMoves };
}

export type DeadFeedAction =
  | { action: 'relocate'; to: string; reason: string }
  | { action: 'hide'; reason: string }
  | { action: 'needsReview'; reason: string }
  | { action: 'unconfirmed'; reason: string }
  | { action: 'ignore'; reason: string };

/**
 * Decide what to do once the feed's own URL has been fetched.
 *
 * `newHome` is present only when PI holds our guid under a different URL; the route
 * fetches it only for a feed whose own URL is confirmed gone.
 */
export function decideDeadFeed(input: {
  signals: DeadFeedSignal[];
  ownStatus: ConfirmStatus;
  newHome?: NewHomeCheck | null;
}): DeadFeedAction {
  const { signals, ownStatus, newHome } = input;

  if (ownStatus === 'error') return { action: 'unconfirmed', reason: 'own URL did not answer' };

  if (ownStatus >= 200 && ownStatus < 300) {
    // Only PI's dead flag against a live URL is worth a human: PI lag or a false
    // positive. A stale `lastError` or a feed served from two hosts is not.
    if (signals.includes('pi-dead')) {
      return { action: 'needsReview', reason: 'PI marked dead but URL still returns 200' };
    }
    return {
      action: 'ignore',
      reason: signals.includes('moved') ? 'PI lists another host, but our URL still serves' : 'URL serves again',
    };
  }

  if (ownStatus !== 404 && ownStatus !== 410) {
    return { action: 'unconfirmed', reason: `HTTP ${ownStatus}` };
  }

  // Confirmed gone. Follow the guid if PI knows a new home.
  if (newHome) {
    if (newHome.status === 'error') {
      // Never hide a feed whose new home merely failed to answer this once.
      return { action: 'unconfirmed', reason: `HTTP ${ownStatus}; new home ${newHome.url} did not answer` };
    }
    if (newHome.collidesWith) {
      return {
        action: 'needsReview',
        reason: `HTTP ${ownStatus}; its new home ${newHome.url} is already in the catalog as ${newHome.collidesWith}`,
      };
    }
    // Only an answer that SAYS something may hide: the other URL is gone too, or it
    // serves an RSS feed that is not ours. A hide is permanent for this sweep (it reads
    // only `markedDead: false`), so a 429, a 5xx, a 403 or a 200 challenge page on one
    // Monday must never hide an album that would have moved the next.
    if (newHome.status === 404 || newHome.status === 410) {
      return { action: 'hide', reason: `HTTP ${ownStatus}; PI's other URL ${newHome.url} is gone too (HTTP ${newHome.status})` };
    }
    if (newHome.status < 200 || newHome.status >= 300 || !newHome.isRss) {
      return {
        action: 'unconfirmed',
        reason: `HTTP ${ownStatus}; new home ${newHome.url} answered HTTP ${newHome.status}${newHome.isRss ? '' : ', not RSS'}, so it could not be checked`,
      };
    }
    if (!newHome.guidMatches) {
      return { action: 'hide', reason: `HTTP ${ownStatus}; PI's other URL ${newHome.url} serves a different podcast:guid` };
    }
    // It is this feed. A URL every import path refuses is still no home for it.
    if (isBlacklistedFeedUrl(newHome.url)) {
      return { action: 'hide', reason: `HTTP ${ownStatus}; its new home ${newHome.url} is on the feed blacklist` };
    }
    // refresh-by-url matches tracks by item guid and never deletes one, so a track the
    // new feed lists under another guid would be added beside its dead copy.
    const { stored, matched } = newHome.tracks;
    if (matched < stored) {
      return {
        action: 'needsReview',
        reason: `HTTP ${ownStatus}; same podcast:guid at ${newHome.url}, but only ${matched} of ${stored} tracks keep their item guid there — a move would list the rest twice`,
      };
    }
    // Stored the way every write path stores a feed URL, so the URL ladder finds it.
    const to = normalizeUrl(newHome.url);
    return { action: 'relocate', to, reason: `HTTP ${ownStatus}; same podcast:guid now at ${to}` };
  }
  return { action: 'hide', reason: `HTTP ${ownStatus}` };
}

/** One stored track's audio URL, fetched. `contentType` only matters on a 2xx. */
export interface AudioProbe {
  status: number | 'error';
  contentType?: string | null;
}

export interface AudioVerdict {
  verdict: 'plays' | 'silent' | 'unknown';
  /** Probed tracks whose audio answered as something a player can play. */
  playing: number;
  probed: number;
}

/**
 * Does any of a dead feed's stored tracks still play?
 *
 * A feed URL that answers 410 says nothing about its audio. RSS Blue proved it: of the
 * 126 albums with no new home, 122 had audio that answered 410 too, but 4 (Catacomb,
 * lemons, socrates, Worried) kept their audio on Fountain and still played. Hiding
 * those would take playable music out of the catalog.
 *
 * - `plays`: a track answered 2xx with anything but a web page. Generous on purpose.
 * - `silent`: EVERY stored track answered 404/410, or a 2xx web page in place of the
 *   audio (a host that redirects dead files to its home page — Stereon Music's second
 *   track). No tracks at all is silent too: nothing that plays can be lost.
 * - `unknown`: anything else — an error, a timeout, 401/403/429, a 5xx, a 3xx — or
 *   fewer tracks probed than stored. Never hide on it.
 */
export function audioVerdict(probes: AudioProbe[], stored: number): AudioVerdict {
  const isPage = (p: AudioProbe) => /^\s*text\/html\b/i.test(p.contentType ?? '');
  const plays = (p: AudioProbe) => typeof p.status === 'number' && p.status >= 200 && p.status < 300 && !isPage(p);
  const silent = (p: AudioProbe) => p.status === 404 || p.status === 410 || (typeof p.status === 'number' && p.status >= 200 && p.status < 300 && isPage(p));
  const playing = probes.filter(plays).length;
  const verdict = playing > 0 ? 'plays' : probes.every(silent) && probes.length >= stored ? 'silent' : 'unknown';
  return { verdict, playing, probed: probes.length };
}

/**
 * The last word on a HIDE: a dead feed is hidden only when none of its tracks plays.
 * One that still plays goes to `needsReview` and stays visible; one whose audio could
 * not be checked goes to `unconfirmed`. Every other action passes through unchanged.
 */
export function applyAudioCheck(d: DeadFeedAction, a: AudioVerdict): DeadFeedAction {
  if (d.action !== 'hide') return d;
  if (a.verdict === 'plays') {
    return { action: 'needsReview', reason: `${d.reason}; but ${a.playing} track(s) still play, so it stays visible` };
  }
  if (a.verdict === 'unknown') {
    return { action: 'unconfirmed', reason: `${d.reason}; its track audio could not be checked, so it stays visible` };
  }
  return { action: 'hide', reason: `${d.reason}; none of ${a.probed} track(s) plays` };
}

/**
 * The next page's offset. A non-dry run that HID feeds removed them from the
 * `markedDead: false` set it pages over, so every later row moved up by that many;
 * advancing by the full page would skip exactly as many feeds unchecked.
 */
export function nextPageOffset(
  offset: number,
  pageSize: number,
  totalBefore: number,
  hiddenThisPage: number
): number | null {
  if (offset + pageSize >= totalBefore) return null;
  return offset + pageSize - hiddenThisPage;
}
