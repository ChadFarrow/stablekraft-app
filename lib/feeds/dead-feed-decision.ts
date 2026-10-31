/**
 * What the dead-feed sweep (`/api/admin/check-dead-feeds`) does with one feed.
 *
 * Import-free on purpose, so `dead-feed-decision.test.ts` loads the shipping module.
 *
 * WHY THIS EXISTS. RSS Blue shut down (2026), and every one of its feeds answers
 * 410 Gone. 266 albums stayed in the catalog as "active" for months, none of them
 * playable, because the sweep only ever looked at feeds Podcast Index had marked
 * `dead` — and PI had last crawled them on 2026-05-27, when they still answered 200.
 * Half of those albums had not gone anywhere: the artists re-published them on
 * epochradio.com and Fountain under the SAME `<podcast:guid>`, with the same item
 * guids, and PI's record for that guid already points at the new URL. Nothing
 * redirects (a bare 410, no `Location`), so the guid is the only thread to follow.
 *
 * So a feed becomes a CANDIDATE on any of three signals, and is only ever acted on
 * after its own URL is fetched and answers a hard 404/410:
 *   - `pi-dead`       PI's crawler marked it dead (the original signal)
 *   - `refresh-gone`  our own refresh recorded `HTTP 404`/`HTTP 410` in `lastError`
 *   - `moved`         PI's record for our guid now lives on a DIFFERENT HOST
 *
 * A confirmed-dead feed whose guid has a verified new home — answers 200, is RSS,
 * and declares the same `<podcast:guid>` — is RELOCATED (its `originalUrl` moves);
 * otherwise it is HIDDEN via `markedDead`. Anything uncertain is reported, not acted on.
 */

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
    if (newHome.status >= 200 && newHome.status < 300 && newHome.isRss && newHome.guidMatches) {
      return { action: 'relocate', to: newHome.url, reason: `HTTP ${ownStatus}; same podcast:guid now at ${newHome.url}` };
    }
    return {
      action: 'hide',
      reason: `HTTP ${ownStatus}; PI's other URL is not this feed (HTTP ${newHome.status}${newHome.isRss ? '' : ', not RSS'}${newHome.guidMatches ? '' : ', different guid'})`,
    };
  }
  return { action: 'hide', reason: `HTTP ${ownStatus}` };
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
