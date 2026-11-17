import type { Event, Filter } from 'nostr-tools';

import { installNodeWebSocket } from './node-websocket';
import { getDefaultRelays, filterReachableRelays } from './relay';
import { publicKeyToNpub } from './keys';

/**
 * Reading other site users' favorites off Nostr.
 *
 * This replaces the old `global-favorites.ts` (deleted), which asked relays for the
 * newest ~1600 kind-30001/30002 events NETWORK-WIDE and then discarded everything that
 * wasn't from a site user. Kind 30001 is generic NIP-51 ("categorized bookmarks / sets")
 * — every Nostr client on the network publishes it — so our own users never made it into
 * the window. Measured against prod on 2026-07-26: 800 events came back, the only site
 * user inside them was the requester, and since the UI asks for excludeSelf the tab
 * rendered empty for everyone. It was not that nobody had favorited anything; 8 other
 * people's favorites were sitting on relays the whole time, unreachable.
 *
 * The `authors` filter is the fix. Same query, scoped: 26s → ~1.7s, zero wasted events.
 */

// NIP-51 parameterized-replaceable. 30002 is the legacy album kind we used to publish.
export const FAVORITE_KIND = 30001;
export const FAVORITE_ALBUM_KIND = 30002;

// Measured: the author-scoped sweep completes in 1.3–1.7s against healthy relays, so
// these are backstops for stragglers, not the expected cost.
const RELAY_QUERY_TIMEOUT_MS = 5_000;
const PROFILE_QUERY_TIMEOUT_MS = 4_000;
const MAX_RELAYS = 20;

/**
 * Relays cap the size of a single filter, so a growing user base has to be split across
 * several. 44 pubkeys fits comfortably today; this keeps it correct at 10x that.
 */
export const AUTHORS_PER_FILTER = 200;

/**
 * Pubkeys kept out of the Community tab — test accounts, mostly.
 *
 * Hex, lowercase. These are still ordinary site users everywhere else; this only stops
 * them being presented to other people as someone worth discovering. Filtered out of the
 * author list *before* the relay query, so their events are never even fetched.
 *
 * - 35aeede1… (npub1xkhwmcf…) — "ChadF Clave test account"
 * - 2d24a6c8… (npub195j2dj9…) — "schilling3016" test account
 */
export const EXCLUDED_COMMUNITY_PUBKEYS = new Set<string>([
  '35aeede13e32b41845dcc8888224b4d0c1bad5de38e894788f26ffa50e8cac78',
  '2d24a6c8be568547a14884eec5f78bca8452b536cf5ceb2d1ccbc1ce49ecb316',
]);

/** Is this pubkey hidden from the Community tab? */
export function isExcludedCommunityPubkey(pubkey: string): boolean {
  return EXCLUDED_COMMUNITY_PUBKEYS.has(pubkey.toLowerCase());
}

export interface ParsedFavorite {
  type: 'track' | 'album';
  itemId: string;
  title?: string;
  artist?: string;
  favoritedBy: { pubkey: string; npub: string };
  favoritedAt: number;
  nostrEventId: string;
}

export interface CommunityProfile {
  displayName?: string;
  avatar?: string;
  nip05?: string;
}

/**
 * A relay query has THREE outcomes and collapsing them loses the important one — the
 * same lesson `nwc-backup.ts` records. "We couldn't ask" must never render as "nobody
 * here has favorites", or the empty state lies during a relay outage.
 */
export type CommunityFetchResult =
  | { status: 'ok'; favorites: ParsedFavorite[]; rawEventCount: number }
  | { status: 'empty'; favorites: []; rawEventCount: number }
  | { status: 'error'; favorites: []; rawEventCount: 0; error: string };

// ── pure helpers (unit-tested — see community-favorites.test.ts) ───────────

/** Split a pubkey list into filter-sized chunks. */
export function chunkAuthors(pubkeys: string[], size: number = AUTHORS_PER_FILTER): string[][] {
  if (size <= 0) throw new Error('chunkAuthors: size must be positive');
  const chunks: string[][] = [];
  for (let i = 0; i < pubkeys.length; i += size) {
    chunks.push(pubkeys.slice(i, i + size));
  }
  return chunks;
}

/** Read the first value of a tag, or undefined. */
function tagValue(event: Event, name: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1] || undefined;
}

/**
 * Parse one of OUR favorite events. Returns null for anything else.
 *
 * The type MUST come from an explicit signal. The previous parser defaulted any
 * untyped kind-30001 to 'track', which swept in every
 * other app's NIP-51 list published by the same users — measured on prod: `bookmark`,
 * `pdf`, `communities`, `grasp-servers`, `pubcastr-*`, `Edufeed/*`, `recipies`. They
 * then failed to resolve against our DB and were dropped silently, so the only visible
 * symptom was a short list. Requiring the type is what makes the foreign lists
 * identifiable rather than merely unresolvable.
 */
export function parseFavoriteEvent(event: Event): ParsedFavorite | null {
  try {
    if (event.kind !== FAVORITE_KIND && event.kind !== FAVORITE_ALBUM_KIND) return null;

    let type: 'track' | 'album' | undefined;
    let itemId: string | undefined;

    // Current format: ["d", itemId] + ["t", "track"|"album"]
    const tTag = tagValue(event, 't');
    if (tTag === 'track' || tTag === 'album') {
      type = tTag;
      itemId = tagValue(event, 'd');
    }

    // Legacy format: ["trackId", id] / ["feedId", id]. Only 6 of these remain on relays,
    // but they're real favorites from real users — keep reading them.
    if (!type) {
      const legacyTrack = tagValue(event, 'trackId');
      const legacyFeed = tagValue(event, 'feedId');
      if (legacyTrack) {
        type = 'track';
        itemId = legacyTrack;
      } else if (legacyFeed) {
        type = 'album';
        itemId = legacyFeed;
      }
    }

    let title = tagValue(event, 'title');
    let artist = tagValue(event, 'artist');

    // Content fallback — our own JSON shape only.
    if ((!type || !itemId) && event.content) {
      try {
        const content = JSON.parse(event.content);
        if (content?.type === 'track' || content?.type === 'album') {
          type = type || content.type;
          itemId = itemId || content.id || content.trackId || content.feedId;
          title = title || content.title;
          artist = artist || content.artist;
        }
      } catch {
        // not JSON — not ours
      }
    }

    if (!type || !itemId) return null;

    return {
      type,
      itemId,
      title,
      artist,
      favoritedBy: { pubkey: event.pubkey, npub: publicKeyToNpub(event.pubkey) },
      favoritedAt: event.created_at,
      nostrEventId: event.id,
    };
  } catch {
    return null;
  }
}

/**
 * Collapse parameterized-replaceable events to one per (pubkey, d-tag).
 *
 * Kinds 30001/30002 are replaceable, so relays legitimately hand back several versions
 * of the same coordinate and different relays disagree about which is newest. Deduping
 * by event id alone (what the old code did) left all of them in, inflating counts and
 * letting a stale unfavorite outrank the current state.
 */
export function dedupeReplaceable(events: Event[]): Event[] {
  const latest = new Map<string, Event>();
  for (const event of events) {
    const d = event.tags.find((t) => t[0] === 'd')?.[1];
    if (d === undefined) continue;
    const key = `${event.pubkey}|${event.kind}|${d}`;
    const current = latest.get(key);
    if (
      !current ||
      event.created_at > current.created_at ||
      // Deterministic tie-break so two relays returning the same second agree.
      (event.created_at === current.created_at && event.id > current.id)
    ) {
      latest.set(key, event);
    }
  }
  return [...latest.values()];
}

/**
 * Index the NIP-09 deletions a user has published against their own favorites.
 *
 * Unfavoriting publishes a kind-5 with `['e', <favorite event id>]`
 * (`lib/nostr/favorites.ts:263-268`). Nothing read those back, so an item someone
 * removed months ago still showed up as their favorite. A deletion is only honoured
 * when the kind-5 and the favorite share a pubkey — otherwise anyone could erase
 * anyone else's favorites from the tab.
 *
 * Also handles `['a', '<kind>:<pubkey>:<d>']` coordinate deletions: we don't emit them,
 * but other clients do, and for a replaceable event NIP-09 scopes them to versions at or
 * before the deletion's own `created_at` — so a later re-favorite correctly survives.
 */
export function collectDeletions(deletionEvents: Event[]): {
  byEventId: Set<string>;
  byCoordinate: Map<string, number>;
} {
  const byEventId = new Set<string>();
  const byCoordinate = new Map<string, number>();

  for (const event of deletionEvents) {
    if (event.kind !== 5) continue;
    for (const tag of event.tags) {
      if (tag[0] === 'e' && tag[1]) {
        byEventId.add(`${event.pubkey}|${tag[1]}`);
      } else if (tag[0] === 'a' && tag[1]) {
        const [kind, pubkey, d] = tag[1].split(':');
        // Only the author's own coordinates, and only our kinds.
        if (pubkey !== event.pubkey) continue;
        if (kind !== String(FAVORITE_KIND) && kind !== String(FAVORITE_ALBUM_KIND)) continue;
        const key = `${pubkey}|${kind}|${d ?? ''}`;
        byCoordinate.set(key, Math.max(byCoordinate.get(key) ?? 0, event.created_at));
      }
    }
  }

  return { byEventId, byCoordinate };
}

/** Drop favorites their author has since deleted. */
export function applyDeletions(
  events: Event[],
  deletions: { byEventId: Set<string>; byCoordinate: Map<string, number> }
): Event[] {
  return events.filter((event) => {
    if (deletions.byEventId.has(`${event.pubkey}|${event.id}`)) return false;
    const d = event.tags.find((t) => t[0] === 'd')?.[1] ?? '';
    const deletedAt = deletions.byCoordinate.get(`${event.pubkey}|${event.kind}|${d}`);
    // A coordinate deletion only kills versions at or before it — re-favoriting later
    // publishes a newer event at the same coordinate and must survive.
    if (deletedAt !== undefined && event.created_at <= deletedAt) return false;
    return true;
  });
}

/**
 * Relay set, deduped and capped — `primary` first, because the cap evicts the tail.
 *
 * Callers pass the DEFAULT relays as primary and user-declared ones as secondary, and
 * that order is load-bearing. Site users between them declare 97 distinct relays; with
 * user relays first, the cap threw away every default and the sweep ran against 20
 * arbitrary hosts instead. Dead relays never EOSE, so the query paid its full maxWait
 * (14.7s vs 1.7s) and profiles that live on the defaults came back missing — the top
 * contributor rendered as a raw npub. Defaults are the known-good, high-coverage set;
 * user relays are supplementary outbox-model coverage for whatever they don't carry.
 */
export function buildCommunityRelays(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...primary, ...secondary]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return filterReachableRelays(out).slice(0, MAX_RELAYS);
}

/**
 * Order user-declared relays by how many users list them.
 *
 * The cap means we can only take a handful, so take the ones the most people publish to
 * rather than whichever happened to sort first — a relay two users share is far likelier
 * to be alive and to hold their events than a single user's private outbox.
 */
export function rankRelaysByPopularity(relayLists: Array<string[] | null | undefined>): string[] {
  const counts = new Map<string, number>();
  for (const list of relayLists) {
    if (!Array.isArray(list)) continue;
    for (const url of new Set(list)) {
      if (!url) continue;
      counts.set(url, (counts.get(url) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([url]) => url);
}

/** Keep only the newest kind-0 per pubkey. */
export function pickLatestProfiles(events: Event[]): Map<string, CommunityProfile> {
  const newest = new Map<string, Event>();
  for (const event of events) {
    const current = newest.get(event.pubkey);
    if (!current || event.created_at > current.created_at) newest.set(event.pubkey, event);
  }

  const profiles = new Map<string, CommunityProfile>();
  for (const [pubkey, event] of newest) {
    try {
      const content = JSON.parse(event.content);
      profiles.set(pubkey, {
        displayName: content.display_name || content.name || undefined,
        avatar: content.picture || undefined,
        nip05: content.nip05 || undefined,
      });
    } catch {
      // unparseable kind-0 — the caller falls back to a truncated npub
    }
  }
  return profiles;
}

/**
 * Build the relay filters for a set of site-user pubkeys.
 *
 * Returns a list because `SimplePool.querySync` takes ONE filter per call (nostr-tools
 * 2.23.1) — the caller runs them concurrently and merges.
 */
export function buildFavoriteFilters(pubkeys: string[]): Filter[] {
  return chunkAuthors(pubkeys).flatMap((authors) => [
    // Relay-side type filter. Measured on prod: removes 100% of foreign NIP-51 lists
    // while keeping every one of our typed favorites.
    {
      kinds: [FAVORITE_KIND, FAVORITE_ALBUM_KIND],
      authors,
      '#t': ['track', 'album'],
      limit: 2000,
    },
    // Legacy events predate the ["t"] tag, so the filter above can't see them. NIP-01
    // only indexes single-letter tags, so `trackId`/`feedId` aren't filterable at the
    // relay — an untagged query is the only way to reach them. Safe because `authors`
    // already confines it to site users, and parseFavoriteEvent requires an explicit
    // type, so the foreign lists this also pulls in are rejected.
    { kinds: [FAVORITE_ALBUM_KIND], authors, limit: 500 },
    // NIP-09 deletions, so unfavorites are honoured. Kept modest: kind-5 covers every
    // deletion these users have ever published (mostly kind-1 notes), and NIP-01 can't
    // filter it down to ours — the `e` tag isn't queryable by target kind. Relays return
    // newest-first, so recent unfavorites — the ones that matter — are always in range.
    { kinds: [5], authors, limit: 300 },
  ]);
}

// ── relay access ──────────────────────────────────────────────────────────

/**
 * Fetch favorites published by the given site users.
 *
 * Uses SimplePool + `querySync({ maxWait })` rather than `NostrClient.getEvents`, which
 * resolves on EOSE *or* timeout — but `RelayManager.subscribe` never registers `oneose`,
 * so in practice every query burns its full timeout (15s here). maxWait returns whatever
 * was actually collected by the deadline, so dead relays cost nothing instead of pinning
 * the whole request. Do not wrap this in an outer Promise.race that rejects: that
 * discards events healthy relays already returned (see nwc-backup.ts).
 */
export async function fetchCommunityFavorites(options: {
  pubkeys: string[];
  relays?: string[];
  timeout?: number;
}): Promise<CommunityFetchResult> {
  const { pubkeys, relays: relayOverride, timeout = RELAY_QUERY_TIMEOUT_MS } = options;

  if (pubkeys.length === 0) {
    return { status: 'empty', favorites: [], rawEventCount: 0 };
  }

  // Must precede the pool: `SimplePool` reads the module-level WebSocket in its
  // constructor. This sweep and `connectServerNostrClient` (server-client.ts)
  // are the two places the SERVER opens relay sockets -- the shared kind:10333
  // list is read in the browser. Under the old `node:20-alpine` the server had
  // no WebSocket at all (Node 20 exposes it only behind a flag); under
  // `node:22-alpine` the global is undici's, which recurses with nostr-tools on
  // a failed connect. Either way this sweep needs `ws`. See the connectivity
  // check below for why a sweep that reached nobody would be invisible.
  await installNodeWebSocket();

  const { SimplePool } = await import('nostr-tools/pool');
  const relays = buildCommunityRelays(getDefaultRelays(), relayOverride || []);
  const pool = new SimplePool();

  try {
    // One querySync per filter, run concurrently. A filter that fails outright resolves
    // to [] rather than taking the others down with it.
    const batches = await Promise.all(
      buildFavoriteFilters(pubkeys).map((filter) =>
        pool.querySync(relays, filter, { maxWait: timeout }).catch((error) => {
          console.warn('⚠️ community-favorites: one filter failed:', error);
          return [] as Event[];
        })
      )
    );
    const events = batches.flat();

    // A sweep that reached NO relay is a failure, not an empty result, and nothing
    // else here can tell the two apart: `querySync` swallows a connect failure
    // inside nostr-tools and resolves to [], so the per-filter `catch` above never
    // fires and no warning is logged either. Measured against the local relay with
    // the WebSocket global removed -- `ensureRelay` reports "WebSocket is not
    // defined" while `querySync` returns 0 events and throws nothing. Without this
    // the route answered `success: true`, `status: 'empty'`, zero people: an empty
    // Community tab, and silence in the logs.
    //
    // Reporting 'error' is safe for the cache. The route's `storeIfUsable` refuses
    // to store an error, so a failed sweep cannot evict a good answer.
    const reached = [...pool.listConnectionStatus().values()].filter(Boolean).length;
    if (reached === 0) {
      const detail = `0 of ${relays.length} relays (WebSocket global: ${typeof WebSocket !== 'undefined'})`;
      console.error(`community-favorites: reached ${detail}. Reporting error, NOT empty.`);
      return {
        status: 'error',
        favorites: [],
        rawEventCount: 0,
        error: `Reached none of the ${relays.length} community relays`,
      };
    }

    // Dedupe to the current version of each coordinate FIRST, then apply deletions —
    // so a kind-5 aimed at a superseded version can't take out the live favorite.
    const deletions = collectDeletions(events.filter((e) => e.kind === 5));
    const favorites = applyDeletions(dedupeReplaceable(events), deletions)
      .map(parseFavoriteEvent)
      .filter((f): f is ParsedFavorite => f !== null)
      .sort((a, b) => b.favoritedAt - a.favoritedAt);

    if (favorites.length === 0) {
      return { status: 'empty', favorites: [], rawEventCount: events.length };
    }
    return { status: 'ok', favorites, rawEventCount: events.length };
  } catch (error: any) {
    console.warn('⚠️ community-favorites: relay query failed (reporting as error, NOT as empty):', error);
    return {
      status: 'error',
      favorites: [],
      rawEventCount: 0,
      error: error?.message || 'Relay query failed',
    };
  } finally {
    try {
      pool.close(relays);
    } catch {
      // already closed
    }
  }
}

/**
 * Fetch kind-0 profiles for a set of pubkeys in ONE query.
 *
 * The old path batched 20 at a time and awaited each batch sequentially at 5s apiece,
 * on top of a getEvents that never resolved early. One filter over all 9 users measured
 * 157ms.
 */
export async function fetchCommunityProfiles(
  pubkeys: string[],
  relayOverride?: string[]
): Promise<Map<string, CommunityProfile>> {
  if (pubkeys.length === 0) return new Map();

  // Its own pool, so its own guard. Idempotent -- see the sweep above.
  await installNodeWebSocket();

  const { SimplePool } = await import('nostr-tools/pool');
  const relays = buildCommunityRelays(getDefaultRelays(), relayOverride || []);
  const pool = new SimplePool();

  try {
    const batches = await Promise.all(
      chunkAuthors(pubkeys).map((authors) =>
        pool
          .querySync(relays, { kinds: [0], authors }, { maxWait: PROFILE_QUERY_TIMEOUT_MS })
          .catch(() => [] as Event[])
      )
    );
    return pickLatestProfiles(batches.flat());
  } catch (error) {
    // Profiles are decoration — a failure here degrades to truncated npubs, it must
    // never fail the whole tab.
    console.warn('⚠️ community-favorites: profile query failed, falling back to npubs:', error);
    return new Map();
  } finally {
    try {
      pool.close(relays);
    } catch {
      // already closed
    }
  }
}
