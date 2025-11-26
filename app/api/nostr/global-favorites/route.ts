import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  fetchGlobalFavorites,
  fetchProfiles,
  FAVORITE_TRACK_KIND,
  FAVORITE_ALBUM_KIND,
} from '@/lib/nostr/global-favorites';

export interface EnrichedGlobalFavorite {
  type: 'track' | 'album';
  item: {
    id: string;
    title: string;
    artist?: string;
    image?: string;
    duration?: number;
    feedId?: string;
    // For albums/feeds
    trackCount?: number;
    type?: string;
  } | null;
  favoritedBy: {
    pubkey: string;
    npub: string;
    displayName?: string;
    avatar?: string;
  };
  favoritedAt: number;
  nostrEventId: string;
  // Original item ID from the event (useful for favoriting)
  originalItemId: string;
}

/**
 * GET /api/nostr/global-favorites
 * Fetch global favorites from Nostr relays and enrich with database data
 * Only shows favorites from users who have signed into this app
 *
 * Query params:
 * - type: 'all' | 'tracks' | 'albums' (default: 'all')
 * - limit: number (default: 50, max: 100)
 * - excludeSelf: 'true' | 'false' (default: 'true')
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const excludeSelf = searchParams.get('excludeSelf') !== 'false';
    const userPubkey = request.headers.get('x-nostr-pubkey');

    // Get all known user pubkeys from the database
    // This ensures we only show favorites from users of this site
    const knownUsers = await prisma.user.findMany({
      select: { nostrPubkey: true },
    });
    const knownPubkeys = new Set(knownUsers.map((u) => u.nostrPubkey).filter(Boolean));

    if (knownPubkeys.size === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'No users have signed into this app yet',
      });
    }

    // Determine which kinds to fetch
    let kinds: number[];
    switch (type) {
      case 'tracks':
        kinds = [FAVORITE_TRACK_KIND];
        break;
      case 'albums':
        kinds = [FAVORITE_ALBUM_KIND];
        break;
      default:
        kinds = [FAVORITE_TRACK_KIND, FAVORITE_ALBUM_KIND];
    }

    // Fetch favorites from Nostr relays
    const favorites = await fetchGlobalFavorites({
      limit: limit * 4, // Fetch more to account for filtering
      kinds,
      excludePubkey: excludeSelf && userPubkey ? userPubkey : undefined,
      timeout: 10000,
    });

    // Filter to only include favorites from known users of this site
    const siteUserFavorites = favorites.filter((f) => knownPubkeys.has(f.favoritedBy.pubkey));

    if (siteUserFavorites.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'No favorites from site users found on Nostr relays',
      });
    }

    // Separate tracks and albums (from site user favorites only)
    const trackFavorites = siteUserFavorites.filter((f) => f.type === 'track');
    const albumFavorites = siteUserFavorites.filter((f) => f.type === 'album');

    // Get unique item IDs
    const trackIds = [...new Set(trackFavorites.map((f) => f.itemId))];
    const albumIds = [...new Set(albumFavorites.map((f) => f.itemId))];

    // Batch lookup tracks in database
    const tracksMap = new Map<string, any>();
    if (trackIds.length > 0) {
      // Try to find by id first
      const tracksByIdRaw = await prisma.track.findMany({
        where: { id: { in: trackIds } },
        include: {
          Feed: {
            select: {
              title: true,
              artist: true,
              image: true,
              id: true,
            },
          },
        },
      });

      for (const track of tracksByIdRaw) {
        tracksMap.set(track.id, track);
      }

      // Find unmatched IDs and try by guid
      const unmatchedIds = trackIds.filter((id) => !tracksMap.has(id));
      if (unmatchedIds.length > 0) {
        const tracksByGuidRaw = await prisma.track.findMany({
          where: { guid: { in: unmatchedIds } },
          include: {
            Feed: {
              select: {
                title: true,
                artist: true,
                image: true,
                id: true,
              },
            },
          },
        });

        for (const track of tracksByGuidRaw) {
          tracksMap.set(track.guid, track);
        }
      }
    }

    // Batch lookup albums/feeds in database
    const albumsMap = new Map<string, any>();
    if (albumIds.length > 0) {
      const albumsRaw = await prisma.feed.findMany({
        where: { id: { in: albumIds } },
        include: {
          _count: {
            select: { Track: true },
          },
        },
      });

      for (const album of albumsRaw) {
        albumsMap.set(album.id, album);
      }
    }

    // Fetch profiles for all unique pubkeys (from site user favorites only)
    const uniquePubkeys = [...new Set(siteUserFavorites.map((f) => f.favoritedBy.pubkey))];
    const profiles = await fetchProfiles(uniquePubkeys);

    // Build enriched favorites list
    const enrichedFavorites: EnrichedGlobalFavorite[] = [];

    for (const favorite of siteUserFavorites) {
      let item: EnrichedGlobalFavorite['item'] = null;

      if (favorite.type === 'track') {
        const track = tracksMap.get(favorite.itemId);
        if (track) {
          item = {
            id: track.id,
            title: track.title,
            artist: track.Feed?.artist || track.artist,
            image: track.Feed?.image || track.image,
            duration: track.duration,
            feedId: track.Feed?.id || track.feedId,
          };
        }
      } else {
        const album = albumsMap.get(favorite.itemId);
        if (album) {
          item = {
            id: album.id,
            title: album.title,
            artist: album.artist,
            image: album.image,
            trackCount: album._count?.Track,
            type: album.type,
          };
        }
      }

      // Skip items that couldn't be resolved from database
      // (they might be from a different app or deleted)
      if (!item) {
        continue;
      }

      // Enrich with profile data
      const profile = profiles.get(favorite.favoritedBy.pubkey);

      enrichedFavorites.push({
        type: favorite.type,
        item,
        favoritedBy: {
          pubkey: favorite.favoritedBy.pubkey,
          npub: favorite.favoritedBy.npub,
          displayName: profile?.displayName,
          avatar: profile?.avatar,
        },
        favoritedAt: favorite.favoritedAt,
        nostrEventId: favorite.nostrEventId,
        originalItemId: favorite.itemId,
      });

      // Stop once we have enough enriched favorites
      if (enrichedFavorites.length >= limit) {
        break;
      }
    }

    return NextResponse.json({
      success: true,
      data: enrichedFavorites,
      count: enrichedFavorites.length,
      totalFromRelays: favorites.length,
      totalFromSiteUsers: siteUserFavorites.length,
      knownUsersCount: knownPubkeys.size,
    });
  } catch (error) {
    console.error('Error fetching global favorites:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch global favorites',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
