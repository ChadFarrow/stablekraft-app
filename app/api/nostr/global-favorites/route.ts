import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  fetchCommunityFavorites,
  fetchCommunityProfiles,
  rankRelaysByPopularity,
  isExcludedCommunityPubkey,
  type ParsedFavorite,
} from '@/lib/nostr/community-favorites';
import {
  resolveFavoriteItems,
  type FavoriteMatch,
} from '@/lib/nostr/favorite-item-lookup';
import { normalizePubkey } from '@/lib/nostr/normalize';
import {
  isBlacklistedFeedId,
  isBlacklistedFeedUrl,
  isHenrikFlymanWavlakeMirror,
} from '@/lib/feed-exclusions';
import {
  decideCacheAction,
  getCommunityCacheEntry,
  refreshCommunityCache,
} from '@/lib/caches/community-favorites-cache';

/**
 * What other site users have favorited, read from Nostr.
 *
 * The response is grouped by person, because the tab is a people-first view — see
 * app/favorites/page.tsx. `excludeSelf` drops the requester's own card rather than
 * filtering individual rows.
 */

// The cached payload is the UNFILTERED people list; excludeSelf is applied per-request
// below, so one relay sweep serves every visitor regardless of who they are.
// Freshness policy and the stale-while-revalidate state live in
// lib/caches/community-favorites-cache.ts.

interface CommunityItem {
  type: 'track' | 'album';
  item: {
    id: string;
    title: string;
    artist?: string;
    image?: string;
    duration?: number;
    feedId?: string;
    trackCount?: number;
    type?: string;
    singleTrack?: { id: string; title: string };
  };
  favoritedAt: number;
  nostrEventId: string;
  /**
   * The CANONICAL DB id (Track.id / Feed.id) — never the raw `d` tag.
   *
   * The UI feeds this straight into FavoriteButton as trackId/feedId. 69 of 121
   * community favorites store a track's `guid` in `d`, so echoing the tag back would
   * write guid-shaped ids into the favorites API the moment the guid rung went live.
   */
  originalItemId: string;
  /** The raw `d` tag, for debugging only. */
  dTag: string;
  matchedVia: string;
}

interface CommunityPerson {
  pubkey: string;
  npub: string;
  displayName?: string;
  avatar?: string;
  nip05?: string;
  favoriteCount: number;
  mostRecentAt: number;
  favorites: CommunityItem[];
}

/**
 * A feed hidden or banned anywhere else must stay hidden here. The community tab is a
 * feed-listing surface like any other (CLAUDE.md), and without this a feed you hid via
 * admin could walk back onto the page through someone's months-old favorite.
 */
function isHiddenFeed(feed: {
  id: string;
  originalUrl: string;
  markedDead: boolean;
  blocked: boolean;
  artist: string | null;
}): boolean {
  if (feed.markedDead) return true;
  // The feed's own <podcast:block> keeps it off StableKraft (lib/feeds/podcast-block.ts).
  if (feed.blocked) return true;
  if (isBlacklistedFeedId(feed.id)) return true;
  if (isBlacklistedFeedUrl(feed.originalUrl)) return true;
  if (isHenrikFlymanWavlakeMirror({ artist: feed.artist, feedUrl: feed.originalUrl })) return true;
  return false;
}

function toCommunityItem(
  favorite: ParsedFavorite,
  match: FavoriteMatch
): CommunityItem | null {
  if (match.kind === 'track') {
    const { track } = match;
    if (track.Feed && isHiddenFeed(track.Feed)) return null;
    return {
      type: 'track',
      item: {
        id: track.id,
        title: track.title,
        artist: track.Feed?.artist || track.artist || undefined,
        image: track.Feed?.image || track.image || undefined,
        duration: track.duration ?? undefined,
        feedId: track.Feed?.id || track.feedId || undefined,
      },
      favoritedAt: favorite.favoritedAt,
      nostrEventId: favorite.nostrEventId,
      originalItemId: track.id, // canonical, NOT favorite.itemId
      dTag: favorite.itemId,
      matchedVia: match.matchedVia,
    };
  }

  const { feed } = match;
  if (isHiddenFeed(feed)) return null;
  return {
    type: 'album',
    item: {
      id: feed.id,
      title: feed.title,
      artist: feed.artist || undefined,
      image: feed.image || undefined,
      trackCount: feed._count?.Track || 0,
      type: feed.type || undefined,
      singleTrack:
        feed._count?.Track === 1 && feed.Track[0]
          ? { id: feed.Track[0].id, title: feed.Track[0].title }
          : undefined,
    },
    favoritedAt: favorite.favoritedAt,
    nostrEventId: favorite.nostrEventId,
    originalItemId: feed.id, // canonical, NOT favorite.itemId
    dTag: favorite.itemId,
    matchedVia: match.matchedVia,
  };
}

async function buildPeople(): Promise<{
  people: CommunityPerson[];
  totals: Record<string, number>;
  status: 'ok' | 'empty' | 'error';
  error?: string;
}> {
  const knownUsers = await prisma.user.findMany({
    select: { nostrPubkey: true, relays: true },
  });

  // Excluded pubkeys (test accounts) are dropped here rather than after the fact, so
  // their events are never fetched and can't reach the cache or the response.
  const knownPubkeys = [
    ...new Set(
      knownUsers
        .map((u) => normalizePubkey(u.nostrPubkey))
        .filter((v): v is string => v !== null)
        .filter((pubkey) => !isExcludedCommunityPubkey(pubkey))
    ),
  ];

  if (knownPubkeys.length === 0) {
    return {
      people: [],
      totals: { people: 0, favorites: 0, knownUsers: 0, fetchedFromRelays: 0, unresolved: 0 },
      status: 'empty',
    };
  }

  // Site users declare ~97 distinct relays between them, far more than we can query.
  // Rank by how many users publish to each so the cap keeps the well-shared ones;
  // buildCommunityRelays puts the defaults ahead of these regardless.
  const userRelays = rankRelaysByPopularity(knownUsers.map((u) => u.relays)).filter(
    (r) => !r.includes('.onion')
  );

  // THE fix: scope the query to our users. Without `authors` this asked relays for the
  // newest kind-30001 events network-wide and our users never made the window.
  //
  // Profiles are fetched for ALL known users concurrently rather than for the subset
  // that turns out to have favorites — one kind-0 filter costs the same for 44 authors
  // as for 7, and doing it this way takes the profile round-trip off the critical path
  // entirely instead of stacking it after the sweep (~4s of the cold load).
  const [result, profiles] = await Promise.all([
    fetchCommunityFavorites({ pubkeys: knownPubkeys, relays: userRelays }),
    fetchCommunityProfiles(knownPubkeys, userRelays),
  ]);

  if (result.status === 'error') {
    return {
      people: [],
      totals: {
        people: 0,
        favorites: 0,
        knownUsers: knownPubkeys.length,
        fetchedFromRelays: 0,
        unresolved: 0,
      },
      status: 'error',
      error: result.error,
    };
  }

  const favorites = result.favorites;
  if (favorites.length === 0) {
    return {
      people: [],
      totals: {
        people: 0,
        favorites: 0,
        knownUsers: knownPubkeys.length,
        fetchedFromRelays: result.rawEventCount,
        unresolved: 0,
      },
      status: 'empty',
    };
  }

  const matches = await resolveFavoriteItems(favorites.map((f) => f.itemId));

  const byPubkey = new Map<string, CommunityPerson>();
  let unresolved = 0;

  for (const favorite of favorites) {
    const match = matches.get(favorite.itemId);
    if (!match) {
      unresolved++;
      continue;
    }
    const item = toCommunityItem(favorite, match);
    if (!item) continue; // hidden or blacklisted feed

    let person = byPubkey.get(favorite.favoritedBy.pubkey);
    if (!person) {
      person = {
        pubkey: favorite.favoritedBy.pubkey,
        npub: favorite.favoritedBy.npub,
        favoriteCount: 0,
        mostRecentAt: 0,
        favorites: [],
      };
      byPubkey.set(favorite.favoritedBy.pubkey, person);
    }
    person.favorites.push(item);
    person.favoriteCount++;
    person.mostRecentAt = Math.max(person.mostRecentAt, item.favoritedAt);
  }

  for (const [pubkey, person] of byPubkey) {
    const profile = profiles.get(pubkey);
    person.displayName = profile?.displayName;
    person.avatar = profile?.avatar;
    person.nip05 = profile?.nip05;
    person.favorites.sort((a, b) => b.favoritedAt - a.favoritedAt);
  }

  const people = [...byPubkey.values()].sort(
    (a, b) => b.favoriteCount - a.favoriteCount || b.mostRecentAt - a.mostRecentAt
  );

  return {
    people,
    totals: {
      people: people.length,
      favorites: people.reduce((n, p) => n + p.favoriteCount, 0),
      knownUsers: knownPubkeys.length,
      fetchedFromRelays: result.rawEventCount,
      unresolved,
    },
    status: people.length > 0 ? 'ok' : 'empty',
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const excludeSelf = searchParams.get('excludeSelf') !== 'false';
    const refresh = searchParams.get('refresh') === 'true';
    const requesterPubkey = normalizePubkey(request.headers.get('x-nostr-pubkey') || null);

    // Never store a relay failure — a bad sweep must not evict a good answer.
    const storeIfUsable = (p: Awaited<ReturnType<typeof buildPeople>>) => p.status !== 'error';

    const entry = refresh ? null : getCommunityCacheEntry<Awaited<ReturnType<typeof buildPeople>>>();
    const action = decideCacheAction(entry, Date.now());

    let payload;
    let served: 'fresh' | 'stale' | 'fetched';
    if (action === 'serve-fresh' && entry) {
      payload = entry.data;
      served = 'fresh';
    } else if (action === 'serve-stale-and-revalidate' && entry) {
      // Answer from cache NOW and refresh behind the response, so nobody waits on relays
      // just because they happened to arrive after the TTL lapsed. Deliberately not
      // awaited; refreshCommunityCache dedupes so a burst triggers one sweep.
      payload = entry.data;
      served = 'stale';
      void refreshCommunityCache(buildPeople, storeIfUsable).catch((e) =>
        console.warn('community-favorites: background refresh failed:', e)
      );
    } else {
      payload = await refreshCommunityCache(buildPeople, storeIfUsable);
      served = 'fetched';
    }

    const people: CommunityPerson[] =
      excludeSelf && requesterPubkey
        ? payload.people.filter((p: CommunityPerson) => p.pubkey !== requesterPubkey)
        : payload.people;

    return NextResponse.json({
      success: payload.status !== 'error',
      status: payload.status === 'ok' && people.length === 0 ? 'empty' : payload.status,
      people,
      totals: {
        ...payload.totals,
        people: people.length,
        favorites: people.reduce((n, p) => n + p.favoriteCount, 0),
      },
      // How this response was produced, and how old the data is. Lets the client decide
      // whether to revalidate, and makes "is the cache working?" answerable from curl.
      served,
      ageMs: entry && served !== 'fetched' ? Date.now() - entry.timestamp : 0,
      ...(payload.error ? { error: payload.error } : {}),
    });
  } catch (err: any) {
    console.error('Error in global favorites:', err);
    return NextResponse.json(
      {
        success: false,
        status: 'error',
        people: [],
        totals: { people: 0, favorites: 0 },
        error: err.message || 'Failed to load favorites',
      },
      { status: 500 }
    );
  }
}
