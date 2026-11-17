/**
 * What the nightly bulk reparse (`POST /api/admin/reparse-feeds`) fetches, and in
 * what order. Pure and import-free so the rules are tested without a database.
 *
 * Two faults made that run useless for weeks (checked back to 2026-10-07, and
 * #287 saw the same back to 2026-09-19):
 *
 * 1. **HTTP 502 on about half the nights.** The whole catalog went through ONE
 *    request, and Railway's edge cuts any request at 300 s — every 502 arrived
 *    exactly 5:00 after the call. The server carried on in the background, so the
 *    workflow saw nothing of the result. Now a call stops starting work once its
 *    time budget is spent and reports `remaining`; the workflow calls again.
 *
 * 2. **~2,000 failures a night, nearly all Wavlake.** 3,309 of the 4,362 catalog
 *    feeds are on wavlake.com, and the run fetched every due one straight from
 *    Wavlake, five at a time — a burst Wavlake refuses with 429. CLAUDE.md's rule is
 *    to ask Podcast Index, not Wavlake. Wavlake feeds now leave the parallel lane:
 *    one PI batch call says which changed, and only those are fetched, one at a
 *    time with a pause between them.
 *
 * Non-Wavlake feeds keep the old rule exactly: due when not fetched within the
 * `maxAgeHours` window.
 */

/** Days a FAILED Wavlake feed stays eligible for a catch-up fetch after PI saw it change. */
export const WAVLAKE_LOOKBACK_DAYS_DEFAULT = 60;
/** Pause between two Wavlake fetches. */
export const WAVLAKE_SPACING_MS_DEFAULT = 1500;
/** Time after which a call starts no new feed. Railway cuts a request at 300 s; one more
 *  batch (fetch timeout 30 s + writes) must still fit under it. */
export const BUDGET_SECONDS_DEFAULT = 240;

/** Hosted on wavlake.com (dot-boundary, never a substring — `wavlake.com.evil.net` is not). */
export function isWavlakeFeedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'wavlake.com' || host.endsWith('.wavlake.com');
  } catch {
    return false;
  }
}

export interface WavlakeCandidate {
  id: string;
  guid: string | null;
  lastFetched: Date | null;
  lastError: string | null;
}

/**
 * Is this Wavlake feed due tonight? `piLastUpdateSec` is Podcast Index's
 * `lastUpdateTime` for the feed's `podcast:guid` (unix seconds) — the last time PI
 * saw its content change — or undefined when PI has no record of it.
 *
 * - Fetched (or tried) within the `maxAgeHours` window → not due. One attempt per
 *   window, success or failure, so repeated calls in one night always finish.
 * - Never fetched → due.
 * - PI saw a change after our last attempt → due.
 * - Our last attempt FAILED and PI saw a change within the lookback → due. This is the
 *   catch-up: a refusal writes `lastFetched` too (lib/feeds/refresh-failure.ts), so a
 *   feed that changed during the weeks every nightly fetch was refused has an attempt
 *   newer than its change but no data from it.
 * - Otherwise, including no PI record → not due. The podping consumer
 *   (`/api/feeds/refresh-by-url`) still refreshes it whenever Wavlake pings.
 */
export function wavlakeDue(
  c: WavlakeCandidate,
  piLastUpdateSec: number | undefined,
  nowMs: number,
  cutoffMs: number,
  lookbackMs: number,
): boolean {
  const last = c.lastFetched ? c.lastFetched.getTime() : null;
  if (last !== null && last >= cutoffMs) return false;
  if (last === null) return true;
  if (piLastUpdateSec === undefined || !Number.isFinite(piLastUpdateSec)) return false;
  const changedMs = piLastUpdateSec * 1000;
  if (changedMs > last) return true;
  return Boolean(c.lastError) && changedMs >= nowMs - lookbackMs;
}

export interface WavlakePlan<T extends WavlakeCandidate> {
  /** Due feeds, most recent PI change first (never-fetched ones first of all). */
  due: T[];
  /** Candidates with no `podcast:guid` stored, so PI cannot be asked about them. */
  noGuid: number;
  /** Candidates whose guid PI did not return. */
  notInPI: number;
}

export function planWavlakeLane<T extends WavlakeCandidate>(
  candidates: T[],
  piLastUpdateByGuid: Map<string, number>,
  nowMs: number,
  cutoffMs: number,
  lookbackMs: number,
): WavlakePlan<T> {
  let noGuid = 0;
  let notInPI = 0;
  const due: Array<{ c: T; changed: number }> = [];
  for (const c of candidates) {
    const guid = c.guid?.trim().toLowerCase() || '';
    if (!guid) noGuid++;
    const pi = guid ? piLastUpdateByGuid.get(guid) : undefined;
    if (guid && pi === undefined) notInPI++;
    if (wavlakeDue(c, pi, nowMs, cutoffMs, lookbackMs)) {
      due.push({ c, changed: c.lastFetched === null ? Number.POSITIVE_INFINITY : pi ?? 0 });
    }
  }
  due.sort((a, b) => b.changed - a.changed);
  return { due: due.map((d) => d.c), noGuid, notInPI };
}

/** Error class for the run's summary. `HTTP 429` is the one that matters most here. */
export function categorizeReparseError(error: string): string {
  const e = error.toLowerCase();
  if (/\bhttp 429\b/.test(e) || e.includes('too many requests')) return 'RATE_LIMITED_429';
  if (/\bhttp 410\b/.test(e)) return 'GONE_410';
  if (e.includes('enotfound') || e.includes('getaddrinfo')) return 'DNS_LOOKUP_FAILED';
  if (e.includes('econnrefused')) return 'CONNECTION_REFUSED';
  if (e.includes('econnreset') || e.includes('socket hang up')) return 'CONNECTION_RESET';
  if (e.includes('etimedout') || e.includes('timeout') || e.includes('aborted')) return 'TIMEOUT';
  if (e.includes('404') || e.includes('not found')) return 'NOT_FOUND_404';
  if (e.includes('403') || e.includes('forbidden')) return 'FORBIDDEN_403';
  if (e.includes('500') || e.includes('internal server')) return 'SERVER_ERROR_5XX';
  if (e.includes('ssl') || e.includes('certificate') || e.includes('cert')) return 'SSL_ERROR';
  if (e.includes('parse') || e.includes('xml') || e.includes('invalid')) return 'PARSE_ERROR';
  if (e.includes('no items') || e.includes('empty')) return 'EMPTY_FEED';
  return 'OTHER';
}
