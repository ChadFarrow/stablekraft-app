/**
 * One-off backfill for `Feed.medium` from Podcast Index.
 *
 *   npx tsx scripts/backfill-feed-medium.ts                    # dry run (default)
 *   npx tsx scripts/backfill-feed-medium.ts --apply
 *   npx tsx scripts/backfill-feed-medium.ts --apply --limit 50
 *
 * Against production:
 *   railway run --service StableKraft --environment production \
 *     npx tsx scripts/backfill-feed-medium.ts --apply
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * `Feed.medium` is written by the reparse paths, so the nightly cron fills it
 * eventually — one full feed fetch and parse at a time. This does the same job
 * in one pass off a much cheaper source: Podcast Index already parsed every
 * feed's `<podcast:medium>` and hands it back in a small JSON.
 *
 * It matters because the cross-app favorites list publishes this value at tag
 * position 4, and that is how another app tells a music album from a talk show
 * without resolving every entry. Until a row has one, its favorites go on the
 * wire with no medium at all.
 *
 * ---------------------------------------------------------------------------
 * The one rule
 *
 * **A medium is recorded only when a feed declared one.** Podcast Index returns
 * an empty string for a feed that didn't, and that stays NULL here — it is not
 * `music`, and it is not `Feed.type`, which defaults to "album" and would be a
 * guess. A guess published to the shared list is sticky: no other app will
 * correct it, and by the format's own rules this app may not either.
 */

import { PrismaClient } from '@prisma/client';
import { generatePodcastIndexHeaders } from '../lib/podcast-index-api';
import { parsePodcastMediumFromXML } from '../lib/rss-parser-db';
import { USER_AGENT } from '../lib/user-agent';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : undefined;

// Deliberately low. This is ~5,000 requests against someone else's free API for
// a housekeeping job that nothing is waiting on, and the cron would otherwise
// do it for free over a few nights.
//
// Concurrency alone is the wrong dial, and two runs proved it. Four workers
// with no pacing sailed through a 25-feed trial and then took HTTP 429 on 3,270
// of 5,003. Pacing at 4/s did the same thing more slowly: the limiter is
// Cloudflare in front of Podcast Index, it answers 429 with `retry-after: 9`,
// and once you are over the line every worker spends its time waiting — the
// run went from ~250 feeds a minute to a standstill while still looking alive.
//
// So: one request at a time, one per second, and let it take the forty minutes
// it takes. Nothing waits on this, reruns are free (only NULL rows are
// selected), and a burst that gets the app's API key throttled costs the parts
// of the app that need Podcast Index in real time.
const concArg = process.argv.indexOf('--concurrency');
const CONCURRENCY = concArg > -1 ? parseInt(process.argv[concArg + 1], 10) : 1;
// The XML pass looked like it talked to hundreds of hosts. It does not: 573 of
// the 594 feeds this pass exists for are wavlake.com, so "different origins, no
// shared limiter" was wrong in exactly the case that mattered — Wavlake answered
// 429 to four-at-a-time and the pass recorded that as "refused".
//
// Which is the symptom, not the problem. CLAUDE.md's stack rule is "Podcast
// Index API for all feed lookups and resolution (never fetch directly from
// Wavlake — use PI API)", and this pass was doing exactly that. The 429s are
// what the rule exists to prevent. So Wavlake is not asked directly, at any
// rate: if Podcast Index has no answer for one of its feeds, the answer is that
// we don't have one.
//
// For other hosts the pass stays, because it works and it is the only source
// for a feed PI hasn't indexed. Workers run parallel ACROSS hosts and serialize
// WITHIN one, since "hundreds of hosts" was an assumption worth not repeating.
const XML_CONCURRENCY = 4;
const xmlRpsArg = process.argv.indexOf('--xml-rps');
const XML_RPS_PER_HOST = xmlRpsArg > -1 ? parseFloat(process.argv[xmlRpsArg + 1]) : 1;

const hostSlots = new Map<string, number>();
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}
async function paceHost(host: string): Promise<void> {
  const gap = 1000 / XML_RPS_PER_HOST;
  const now = Date.now();
  const slot = Math.max(now, hostSlots.get(host) ?? 0);
  hostSlots.set(host, slot + gap);
  if (slot > now) await sleep(slot - now);
}
const rpsArg = process.argv.indexOf('--rps');
const RPS = rpsArg > -1 ? parseFloat(process.argv[rpsArg + 1]) : 1;

// Serialize request starts at no more than RPS per second, across all workers.
let nextSlot = 0;
async function pace(): Promise<void> {
  const gap = 1000 / RPS;
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + gap;
  if (slot > now) await sleep(slot - now);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Row = { id: string; guid: string | null; originalUrl: string };

type Outcome =
  | { kind: 'declared'; medium: string }
  | { kind: 'none' } // PI knows the feed; the feed declares no medium
  | { kind: 'unknown' } // PI has never heard of it
  | { kind: 'rejected'; message: string } // PI refused the query; rerunning won't help
  | { kind: 'pi-only'; message: string } // PI had no answer and we may not ask the host
  | { kind: 'error'; message: string };

async function lookup(row: Row, attempt = 0): Promise<Outcome> {
  const url = row.guid
    ? `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(row.guid)}`
    : `https://api.podcastindex.org/api/1.0/podcasts/byfeedurl?url=${encodeURIComponent(row.originalUrl)}`;

  await pace();
  const res = await fetch(url, {
    headers: await generatePodcastIndexHeaders(),
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 429) {
    // Back off and retry rather than counting it as a failure: a 429 says
    // "later", and treating it as an answer would leave 3,000 feeds looking
    // permanently unresolvable when nothing is wrong with any of them.
    if (attempt >= 5) return { kind: 'error', message: 'HTTP 429 after 5 retries' };
    const retryAfter = parseFloat(res.headers.get('retry-after') ?? '');
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000 * 2 ** attempt;
    // Being throttled means the chosen rate is wrong, not just that this row is
    // unlucky — so slow the whole run down, not only this request. Without
    // this, every worker rediscovers the limit on every row.
    nextSlot = Math.max(nextSlot, Date.now() + wait);
    await sleep(wait);
    return lookup(row, attempt + 1);
  }
  // A 4xx that isn't a 429 is about this row — a URL Podcast Index won't accept,
  // usually — and no amount of rerunning changes it.
  if (res.status >= 400 && res.status < 500) {
    return { kind: 'rejected', message: `HTTP ${res.status}` };
  }
  if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };

  const body = await res.json();
  const feed = body?.feed;
  // `byguid` returns an object, `byfeedurl` sometimes an array of one.
  const found = Array.isArray(feed) ? feed[0] : feed;
  if (!found || !found.url) return { kind: 'unknown' };

  const medium = typeof found.medium === 'string' ? found.medium.trim().toLowerCase() : '';
  return medium ? { kind: 'declared', medium } : { kind: 'none' };
}

/**
 * The feed's own answer, for the ones Podcast Index can't give. Uses the same
 * parser the reparse paths do, so a value written here is identical to the one
 * the nightly cron would eventually write — `channelMetadataXml` first, because
 * channel-level tags can sit after the `<item>`s and a naive regex would pick
 * up an item's medium instead.
 */
// Hosts this script may not fetch directly, whatever the reason PI came up
// empty. Podcast Index is the interface to these, per CLAUDE.md.
const PI_ONLY_HOSTS = ['wavlake.com'];

async function lookupFromFeed(row: Row, attempt = 0): Promise<Outcome> {
  const host = hostOf(row.originalUrl);
  if (PI_ONLY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { kind: 'pi-only', message: host };
  }
  await paceHost(host);
  const res = await fetch(row.originalUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  });

  if (res.status === 429) {
    // Same rule as the Podcast Index pass: a 429 is "later", not "no". Recording
    // it as a refusal is what wrote off feeds that were serving fine.
    if (attempt >= 5) return { kind: 'error', message: 'feed HTTP 429 after 5 retries' };
    const retryAfter = parseFloat(res.headers.get('retry-after') ?? '');
    const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000 * 2 ** attempt;
    hostSlots.set(host, Date.now() + wait); // slow this host, not the whole run
    await sleep(wait);
    return lookupFromFeed(row, attempt + 1);
  }
  if (!res.ok) return { kind: 'rejected', message: `feed HTTP ${res.status}` };

  const xml = await res.text();
  const medium = parsePodcastMediumFromXML(xml);
  return medium ? { kind: 'declared', medium: medium.toLowerCase() } : { kind: 'none' };
}

async function main() {
  const rows: Row[] = await prisma.feed.findMany({
    where: { medium: null },
    select: { id: true, guid: true, originalUrl: true },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`${rows.length} feeds with no medium${LIMIT ? ` (limited to ${LIMIT})` : ''}`);
  console.log(APPLY ? '⚠️  APPLY: rows will be written\n' : 'DRY RUN — pass --apply to write\n');
  if (rows.length === 0) return;

  // Probe first, then batch. One sequential request, and if the endpoint is
  // down we find out now rather than by opening a socket per feed against it.
  const probe = await lookup(rows[0]);
  if (probe.kind === 'error') {
    console.error(`❌ Probe failed (${probe.message}) — stopping before the fan-out.`);
    process.exitCode = 1;
    return;
  }

  const counts = { declared: 0, none: 0, unknown: 0, rejected: 0, error: 0, 'pi-only': 0 };
  const byMedium = new Map<string, number>();
  const errors: string[] = [];
  const resolved = new Set<string>(); // ids the PI pass settled, either way
  let done = 0;

  const record = async (row: Row, outcome: Outcome, source: 'pi' | 'xml' = 'pi') => {
    counts[outcome.kind] += 1;
    if (outcome.kind === 'error' || outcome.kind === 'rejected') {
      errors.push(`${row.id}: ${outcome.message}${source === 'xml' ? ' (xml)' : ''}`);
    }
    // "Podcast Index couldn't answer" is the only outcome worth a second pass.
    // A feed that answered "no medium declared" has been answered.
    if (source === 'pi' && (outcome.kind === 'declared' || outcome.kind === 'none')) {
      resolved.add(row.id);
    }
    if (outcome.kind === 'declared') {
      byMedium.set(outcome.medium, (byMedium.get(outcome.medium) ?? 0) + 1);
      if (APPLY) {
        // `updatedAt` is deliberately left alone: this is not a change to the
        // feed, it is this app catching up on something the feed always said,
        // and several surfaces sort or sweep on that column.
        await prisma.$executeRaw`UPDATE "Feed" SET "medium" = ${outcome.medium} WHERE "id" = ${row.id} AND "medium" IS NULL`;
      }
    }
    done += 1;
    if (source === 'pi' && done % 250 === 0) console.log(`  … ${done}/${rows.length}`);
  };

  await record(rows[0], probe);

  const queue = rows.slice(1);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < queue.length) {
        const row = queue[next++];
        try {
          await record(row, await lookup(row));
        } catch (error) {
          await record(row, {
            kind: 'error',
            message: error instanceof Error ? error.message : 'unknown',
          });
        }
      }
    })
  );

  // --- second pass: ask the feed itself --------------------------------------
  //
  // A feed Podcast Index has never indexed still declares a medium in its own
  // XML, and that is the authoritative copy anyway — PI is a convenience, not
  // the source. Without this pass those rows wait for the nightly reparse to
  // walk them one full parse at a time, which is the thing this script exists
  // to avoid. Different hosts, no shared limiter, so it runs wider and faster
  // than the PI pass.
  const stragglers = rows.filter((r) => !resolved.has(r.id));
  if (stragglers.length > 0 && !process.argv.includes('--skip-xml')) {
    console.log(`\n${stragglers.length} feeds unanswered by Podcast Index — asking the feeds directly`);
    let xmlNext = 0;
    let xmlDone = 0;
    await Promise.all(
      Array.from({ length: XML_CONCURRENCY }, async () => {
        while (xmlNext < stragglers.length) {
          const row = stragglers[xmlNext++];
          try {
            await record(row, await lookupFromFeed(row), 'xml');
          } catch (error) {
            await record(
              row,
              { kind: 'error', message: error instanceof Error ? error.message : 'unknown' },
              'xml'
            );
          }
          xmlDone += 1;
          if (xmlDone % 250 === 0) console.log(`  … ${xmlDone}/${stragglers.length} (xml)`);
        }
      })
    );
  }

  console.log(`\n${APPLY ? 'Wrote' : 'Would write'} ${counts.declared} mediums.`);
  console.log(
    [...byMedium.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([m, n]) => `  ${m}: ${n}`)
      .join('\n')
  );
  console.log(`\nLeft NULL, correctly:`);
  console.log(`  ${counts.none} feeds Podcast Index knows that declare no medium`);
  console.log(`  ${counts.unknown} feeds Podcast Index has never seen`);
  if (counts['pi-only']) {
    console.log(`  ${counts['pi-only']} feeds on a PI-only host — Podcast Index had no answer and we don't ask the host`);
  }
  if (counts.rejected) {
    console.log(`  ${counts.rejected} feeds Podcast Index refused to look up (rerunning won't help)`);
  }
  if (counts.error || counts.rejected) {
    // Named rather than counted: a rerun is cheap, but only if you can tell a
    // transient timeout from a feed that fails the same way every time.
    console.log(`  ${counts.error} lookups failed — rerun to pick them up:`);
    for (const e of errors.slice(0, 20)) console.log(`    ${e}`);
    if (errors.length > 20) console.log(`    … and ${errors.length - 20} more`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
