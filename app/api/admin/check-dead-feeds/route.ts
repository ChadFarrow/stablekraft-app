import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { podcastIndexAPI } from '@/lib/podcast-index-api';
import { invalidateAlbumsFastCache } from '@/lib/caches/albums-fast-cache';
import { invalidateSearchCache } from '@/lib/caches/search-cache';
import { findFeedIdByUrl } from '@/lib/feed-lookup';
import { parsePodcastGuidFromXML, parseRSSFeed } from '@/lib/rss-parser-db';
import { safeFetch, readCappedText, MAX_FEED_BYTES, type FetchLike } from '@/lib/safe-fetch';
import {
  decideDeadFeed,
  isHostMove,
  matchTracksByGuid,
  nextPageOffset,
  refreshSaysGone,
  sameFeedUrl,
  type ConfirmStatus,
  type DeadFeedSignal,
  type NewHomeCheck,
} from '@/lib/feeds/dead-feed-decision';

/**
 * POST /api/admin/check-dead-feeds
 *
 * Periodic "did an artist take their catalog down?" sweep. Catches feeds whose
 * RSS URL has gone dead upstream (404 / removed from Wavlake, etc.) — the album
 * keeps showing because its tracks are cached in the DB even though the feed is
 * gone. `status` can't durably flag these: the nightly `fix-feed-status` step
 * flips any error feed that still has tracks back to 'active', and a taken-down
 * feed still has its cached tracks. So we hide via the orthogonal `markedDead`
 * flag (same durable, reversible mechanism as the admin "Hide Feed" card).
 *
 * Two-signal, so nothing is hidden on a hunch:
 *   1. DISCOVER (cheap, catalog-wide): a feed is a candidate when PodcastIndex
 *      marked it `dead`, when OUR refresh recorded `HTTP 404`/`HTTP 410` in
 *      `lastError`, or when PI's record for our guid now lives on another HOST.
 *      We never HTTP-probe the whole catalog ourselves (Wavlake 429-rate-limits
 *      Railway after ~50 fetches); the move signal skips same-host spellings and
 *      Wavlake for exactly that reason (lib/feeds/dead-feed-decision.ts).
 *   2. CONFIRM (only the candidates): directly fetch the feed URL and require a
 *      hard 404/410 before acting. Then follow the guid: if PI holds it under
 *      another URL that answers 200, is RSS and declares the same
 *      `<podcast:guid>`, and lists every stored track under the same item guid,
 *      the feed is RELOCATED there: `originalUrl` and each track's `audioUrl`
 *      move in ONE transaction, so a moved album plays even if no refresh ever
 *      follows (the caller still refreshes it, for artwork and metadata).
 *      Otherwise it is HIDDEN. PI-says-dead-but-URL-200 and a new home whose
 *      item guids changed go to `needsReview`; transient errors, at either
 *      URL, go to `unconfirmed`. Neither is touched.
 *
 * Why the extra signals: RSS Blue shut down in 2026 and its 266 albums stayed
 * "active" for months — PI had last crawled them while they still answered 200,
 * so none was ever a candidate. Half had moved to epochradio.com under the same
 * guid and item guids; the rest were gone (410, no redirect).
 *
 * Body: { dryRun?: boolean (default false), limit?: number, offset?: number }
 * In dryRun mode nothing is written: confirmed feeds come back as `wouldHide`
 * and `wouldRelocate`.
 */

const PI_BATCH_SIZE = 15;
const PI_BATCH_DELAY_MS = 250;
const CONFIRM_TIMEOUT_MS = 15000;
// Paginate: the active-feed set is large (thousands), so a single request
// processes one bounded slice and returns `nextOffset`. The weekly workflow
// (and any caller) loops until `nextOffset` is null. Keeps each request well
// under edge/function timeouts.
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;

type FeedRow = {
  id: string;
  title: string;
  artist: string | null;
  originalUrl: string;
  cdnUrl: string | null;
  guid: string | null;
  lastError: string | null;
};

type FlaggedFeed = {
  id: string;
  title: string;
  artist: string | null;
  url: string;
  piDead: number;
  httpStatus: number | null;
  signals: DeadFeedSignal[];
  reason?: string;
};

type Relocation = FlaggedFeed & { to: string; tracksRepointed: number };

type Candidate = {
  feed: FeedRow;
  piDead: number;
  signals: DeadFeedSignal[];
  /** PI's URL for our guid, when it differs from ours. */
  piUrl: string | null;
};

/**
 * GET a URL for its status. The body is read only when asked (the new-home check
 * needs the XML to compare guids); a feed's own URL only needs its status, so its
 * body is cancelled rather than downloaded.
 *
 * Through `safeFetch`, because both URLs come from outside: the new home is
 * whatever PI's record says, and anyone can put a URL in PI. Every redirect hop is
 * checked against private addresses, and the body is capped by counting bytes, not
 * by trusting `content-length`. Could-not-verify is never "is not this feed", so
 * every refusal here is `'error'`, which never hides.
 */
async function fetchStatus(
  url: string,
  readBody = false
): Promise<{ status: ConfirmStatus; reason?: string; body?: string }> {
  // safeFetch's own timeout stops once the headers arrive. This one deadline spans
  // every redirect hop AND the body read, so a slow-drip server cannot hold a page.
  const deadline = AbortSignal.timeout(CONFIRM_TIMEOUT_MS);
  const withDeadline: FetchLike = (u, init) =>
    fetch(u, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  try {
    const got = await safeFetch(url, {
      allowHttp: true,
      timeoutMs: CONFIRM_TIMEOUT_MS,
      headers: { 'User-Agent': 'StableKraft-Feed-Parser/1.0' },
      fetchImpl: withDeadline,
    });
    if (!got.ok) return { status: 'error', reason: got.error };
    const res = got.response;
    if (!readBody || !res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status };
    }
    const read = await readCappedText(res, MAX_FEED_BYTES);
    if (!read.ok) return { status: 'error', reason: `${read.error}, too large to verify` };
    return { status: res.status, body: read.value };
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : 'fetch failed' };
  }
}

type NewHome = {
  check: NewHomeCheck;
  /** Why the new home could not be checked, when it could not. */
  reason?: string;
  /** Each matched track whose audio the move re-points, from the feed just verified. */
  audioMoves: Array<{ id: string; audioUrl: string }>;
};

/**
 * Does PI's other URL for this guid really serve THIS feed, is it free in the
 * catalog, and does it still list our tracks under the same item guids?
 */
async function checkNewHome(feed: FeedRow, piUrl: string): Promise<NewHome> {
  const got = await fetchStatus(piUrl, true);
  const body = got.body ?? '';
  const declared = body ? parsePodcastGuidFromXML(body) : null;
  const match = await findFeedIdByUrl(piUrl);
  const check: NewHomeCheck = {
    url: piUrl,
    status: got.status,
    isRss: /<rss\b|<channel\b/i.test(body),
    guidMatches: !!declared && !!feed.guid && declared.trim().toLowerCase() === feed.guid.trim().toLowerCase(),
    // The URL ladder's uuid-in-URL rung can match THIS row by its own guid.
    collidesWith: match && match.id !== feed.id ? match.id : null,
    tracks: { stored: 0, matched: 0 },
  };
  if (typeof check.status !== 'number' || check.status < 200 || check.status >= 300 || !check.isRss || !check.guidMatches) {
    return { check, reason: got.reason, audioMoves: [] };
  }

  // Same parser as refresh-by-url, on the XML already fetched, so `audioUrl` is
  // exactly what a refresh would store.
  let items;
  try {
    items = (await parseRSSFeed(piUrl, body)).items;
  } catch (err) {
    return {
      check: { ...check, status: 'error' },
      reason: `new home did not parse: ${err instanceof Error ? err.message : 'unknown error'}`,
      audioMoves: [],
    };
  }
  const stored = await prisma.track.findMany({
    where: { feedId: feed.id },
    select: { id: true, guid: true, audioUrl: true },
  });
  const m = matchTracksByGuid(stored, items);
  return { check: { ...check, tracks: { stored: m.stored, matched: m.matched } }, audioMoves: m.audioMoves };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun: boolean = Boolean(body?.dryRun);
    const limit: number =
      typeof body?.limit === 'number' && body.limit > 0
        ? Math.min(body.limit, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const offset: number =
      typeof body?.offset === 'number' && body.offset > 0 ? Math.floor(body.offset) : 0;

    // --- Step 1: discover candidates via PodcastIndex `dead` flag ------------
    // Stable `id asc` ordering so offset paging is consistent across calls.
    const where = { status: 'active', markedDead: false } as const;
    const totalActive = await prisma.feed.count({ where });
    const feeds: FeedRow[] = await prisma.feed.findMany({
      where,
      select: { id: true, title: true, artist: true, originalUrl: true, cdnUrl: true, guid: true, lastError: true },
      orderBy: { id: 'asc' },
      skip: offset,
      take: limit,
    });
    const candidates: Candidate[] = [];
    // Diagnostics so a zero result is trustworthy: proves we actually reached
    // PI and how many feeds it could resolve (vs. silently returning null).
    let resolvedInPI = 0;
    let notInPI = 0;

    for (let i = 0; i < feeds.length; i += PI_BATCH_SIZE) {
      const batch = feeds.slice(i, i + PI_BATCH_SIZE);
      await Promise.all(
        batch.map(async (feed) => {
          // Prefer an exact GUID lookup. `getFeedByUrl` prefers the newest
          // duplicate by ID, which could mask a dead older entry, so it's only
          // the fallback for feeds we have no GUID for.
          const piFeed = feed.guid
            ? await podcastIndexAPI.getFeedByGuid(feed.guid)
            : await podcastIndexAPI.getFeedByUrl(feed.originalUrl);

          if (piFeed) resolvedInPI++;
          else notInPI++;

          const signals: DeadFeedSignal[] = [];
          const piDead = typeof piFeed?.dead === 'number' ? piFeed.dead : 0;
          if (piDead > 0) signals.push('pi-dead');
          // Our own refresh is the signal for feeds PI has not re-crawled — or
          // does not index at all.
          if (refreshSaysGone(feed.lastError)) signals.push('refresh-gone');
          // Only a GUID lookup says where the same feed lives now; a URL lookup
          // answers about the URL we asked.
          const piUrl =
            feed.guid && piFeed?.url && !sameFeedUrl(piFeed.url, feed.originalUrl) ? piFeed.url : null;
          if (piUrl && isHostMove(feed.originalUrl, piUrl)) signals.push('moved');

          if (signals.length > 0) candidates.push({ feed, piDead, signals, piUrl });
        })
      );
      if (i + PI_BATCH_SIZE < feeds.length) {
        await delay(PI_BATCH_DELAY_MS);
      }
    }

    // --- Step 2: confirm each candidate really 404s, then follow its guid -----
    const confirmed: FlaggedFeed[] = []; // hard 404/410, no new home → hide
    const relocations: Relocation[] = []; // hard 404/410, verified new home → move
    const needsReview: FlaggedFeed[] = []; // PI dead but URL 200, or new home already a row
    const unconfirmed: FlaggedFeed[] = []; // transient / other errors
    let ignored = 0; // a candidate whose own URL still serves (stale lastError, two hosts)
    const audioMovesById = new Map<string, NewHome['audioMoves']>();

    for (const { feed, piDead, signals, piUrl } of candidates) {
      const own = await fetchStatus(feed.originalUrl);
      const base: FlaggedFeed = {
        id: feed.id,
        title: feed.title,
        artist: feed.artist,
        url: feed.originalUrl,
        piDead,
        httpStatus: typeof own.status === 'number' ? own.status : null,
        signals,
      };
      // Fetch the new home only for a feed whose own URL is confirmed gone.
      const gone = own.status === 404 || own.status === 410;
      const newHome = gone && piUrl ? await checkNewHome(feed, piUrl) : null;
      const d = decideDeadFeed({ signals, ownStatus: own.status, newHome: newHome?.check });
      const reason =
        own.status === 'error'
          ? own.reason ?? d.reason
          : d.action === 'unconfirmed' && newHome?.reason
            ? `${d.reason} (${newHome.reason})`
            : d.reason;
      const flagged = { ...base, reason };

      if (d.action === 'relocate') {
        const moves = newHome?.audioMoves ?? [];
        audioMovesById.set(feed.id, moves);
        relocations.push({ ...flagged, to: d.to, tracksRepointed: moves.length });
      } else if (d.action === 'hide') confirmed.push(flagged);
      else if (d.action === 'needsReview') needsReview.push(flagged);
      else if (d.action === 'unconfirmed') unconfirmed.push(flagged);
      else ignored++;
    }

    // --- Step 3: apply (relocate, then auto-hide) ------------------------------
    let hiddenCount = 0;
    const relocated: Relocation[] = [];
    if (!dryRun) {
      for (const r of relocations) {
        const row = candidates.find((c) => c.feed.id === r.id)!.feed;
        const now = new Date();
        try {
          // The URL and the audio move together or not at all. Moved alone, the row
          // would serve the dead host's audio until a refresh rewrote it — and after a
          // move nothing makes the row a candidate again (its URL answers, its
          // `lastError` is clear), and the nightly reparse never rewrites `audioUrl`.
          await prisma.$transaction([
            prisma.feed.update({
              where: { id: r.id },
              data: {
                originalUrl: r.to,
                // cdnUrl mirrors originalUrl on every row the import paths write.
                ...(row.cdnUrl === row.originalUrl ? { cdnUrl: r.to } : {}),
                lastError: null,
                updatedAt: now,
              },
            }),
            ...(audioMovesById.get(r.id) ?? []).map((t) =>
              prisma.track.update({ where: { id: t.id }, data: { audioUrl: t.audioUrl, updatedAt: now } })
            ),
          ]);
          relocated.push(r);
        } catch (err) {
          // Lost a race on @unique originalUrl since the collision check, or a track
          // went away mid-run. The transaction rolled back: nothing moved.
          needsReview.push({ ...r, reason: `could not move to ${r.to}: ${err instanceof Error ? err.message : 'update failed'}` });
        }
      }
      if (confirmed.length > 0) {
        const result = await prisma.feed.updateMany({
          where: { id: { in: confirmed.map((f) => f.id) } },
          data: { markedDead: true },
        });
        hiddenCount = result.count;
      }
      if (hiddenCount > 0 || relocated.length > 0) {
        // A hidden or moved feed changes the grid + search results.
        invalidateAlbumsFastCache();
        invalidateSearchCache();
      }
    }

    // Hidden rows left the `markedDead: false` set this pages over.
    const nextOffset = nextPageOffset(offset, feeds.length, totalActive, hiddenCount);

    return NextResponse.json({
      success: true,
      dryRun,
      totalActive,
      offset,
      checked: feeds.length,
      resolvedInPI,
      notInPI,
      nextOffset,
      candidates: candidates.length,
      ...(dryRun
        ? { wouldHide: confirmed, wouldRelocate: relocations }
        : { hidden: confirmed, hiddenCount, relocated, relocatedCount: relocated.length }),
      needsReview,
      unconfirmed,
      ignored,
      message: dryRun
        ? `Would move ${relocations.length} feed(s) to their new home and hide ${confirmed.length}; ${needsReview.length} need review, ${unconfirmed.length} unconfirmed. (feeds ${offset}–${offset + feeds.length} of ${totalActive})`
        : `Moved ${relocated.length} feed(s) to their new home, hid ${hiddenCount}; ${needsReview.length} need review, ${unconfirmed.length} unconfirmed. (feeds ${offset}–${offset + feeds.length} of ${totalActive})`,
    });
  } catch (error) {
    console.error('Error in check-dead-feeds:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check dead feeds',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
