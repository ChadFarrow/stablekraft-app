import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  fetchGlobalFavorites,
  fetchProfiles,
  FAVORITE_KIND,
  FAVORITE_ALBUM_KIND,
} from '@/lib/nostr/global-favorites';
import { normalizePubkey } from '@/lib/nostr/normalize';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 500);
    const excludeSelf = searchParams.get('excludeSelf') !== 'false';

    // Normalize incoming pubkey from header
    const requesterPubkey = normalizePubkey(
      request.headers.get('x-nostr-pubkey') || null
    );

    // Get all known pubkeys (site users only)
    const knownUsers = await prisma.user.findMany({
      select: { nostrPubkey: true, relays: true },
    });

    const knownPubkeys = new Set(
      knownUsers
        .map((u) => normalizePubkey(u.nostrPubkey))
        .filter((v) => v !== null)
    );

    if (knownPubkeys.size === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'No site users found',
      });
    }

    // Collect unique relays from users
    const relaySet = new Set<string>();
    for (const user of knownUsers) {
      if (Array.isArray(user.relays)) {
        for (const r of user.relays) {
          if (
            r.includes('127.0.0.1') ||
            r.includes('localhost') ||
            r.endsWith('.local') ||
            r.includes('.onion')
          ) {
            continue;
          }
          relaySet.add(r);
        }
      }
    }

    const relays = relaySet.size > 0 ? [...relaySet] : undefined;

    // Fetch favorites
    const favorites = await fetchGlobalFavorites({
      limit: limit * 4,
      kinds: [FAVORITE_KIND, FAVORITE_ALBUM_KIND],
      type: type === 'tracks' ? 'track' : type === 'albums' ? 'album' : 'all',
      excludePubkey: excludeSelf ? requesterPubkey || undefined : undefined,
      relays,
      timeout: 15000,
    });

    // Normalize all event pubkeys
    const normalizedFavorites = favorites
      .map((f) => {
        const normalized = normalizePubkey(f.favoritedBy.pubkey);
        if (!normalized) return null;
        return { ...f, favoritedBy: { ...f.favoritedBy, pubkey: normalized } };
      })
      .filter(Boolean);

    // Filter to only favorites from site users
    const siteUserFavorites = normalizedFavorites.filter((f) =>
      knownPubkeys.has(f.favoritedBy.pubkey)
    );

    if (siteUserFavorites.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'No favorites found from site users',
      });
    }

    // Separate types
    const trackFavs = siteUserFavorites.filter((f) => f.type === 'track');
    const albumFavs = siteUserFavorites.filter((f) => f.type === 'album');

    // Track IDs
    const trackIds = [...new Set(trackFavs.map((f) => f.itemId))];
    const albumIds = [...new Set(albumFavs.map((f) => f.itemId))];

    // Fetch tracks
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      include: {
        Feed: {
          select: { id: true, title: true, artist: true, image: true },
        },
      },
    });

    const tracksMap = new Map(tracks.map((t) => [t.id, t]));

    // Fetch albums
    const albums = await prisma.feed.findMany({
      where: { id: { in: albumIds } },
      include: {
        _count: { select: { Track: true } },
        Track: {
          take: 1,
          orderBy: { trackOrder: 'asc' },
          select: { id: true, title: true },
        },
      },
    });

    const albumsMap = new Map(albums.map((a) => [a.id, a]));

    // Load Nostr profiles
    const pubkeysToLookup = [...new Set(siteUserFavorites.map((f) => f.favoritedBy.pubkey))];
    const profiles = await fetchProfiles(pubkeysToLookup);

    const enriched = [];

    for (const fav of siteUserFavorites) {
      let item = null;

      if (fav.type === 'track') {
        const t = tracksMap.get(fav.itemId);
        if (!t) continue;

        item = {
          id: t.id,
          title: t.title,
          artist: t.Feed?.artist || t.artist,
          image: t.Feed?.image || t.image,
          duration: t.duration,
          feedId: t.Feed?.id || t.feedId,
        };
      } else {
        const a = albumsMap.get(fav.itemId);
        if (!a) continue;

        item = {
          id: a.id,
          title: a.title,
          artist: a.artist,
          image: a.image,
          trackCount: a._count?.Track || 0,
          type: a.type,
          singleTrack:
            a._count?.Track === 1 && a.Track[0]
              ? { id: a.Track[0].id, title: a.Track[0].title }
              : undefined,
        };
      }

      const profile = profiles.get(fav.favoritedBy.pubkey);

      enriched.push({
        type: fav.type,
        item,
        favoritedBy: {
          pubkey: fav.favoritedBy.pubkey,
          npub: fav.favoritedBy.npub,
          displayName: profile?.displayName,
          avatar: profile?.avatar,
        },
        favoritedAt: fav.favoritedAt,
        nostrEventId: fav.nostrEventId,
        originalItemId: fav.itemId,
      });

      if (enriched.length >= limit) break;
    }

    return NextResponse.json({
      success: true,
      data: enriched,
      count: enriched.length,
      totalFromRelays: favorites.length,
      knownUsersCount: knownPubkeys.size,
    });
  } catch (err: any) {
    console.error('Error in global favorites:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to load favorites' },
      { status: 500 }
    );
  }
}