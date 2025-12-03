import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  fetchGlobalFavorites,
  fetchProfiles,
  FAVORITE_KIND,
  FAVORITE_ALBUM_KIND, // Legacy: for backward compatibility reading old events
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
    // For single-track albums, include the track data so it can be favorited as a track
    singleTrack?: {
      id: string;
      title: string;
    };
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

    // Get all known user pubkeys and their relays from the database
    // This ensures we only show favorites from users of this site
    const knownUsers = await prisma.user.findMany({
      select: { nostrPubkey: true, relays: true },
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

    // Collect unique relays from all known users (filter out local/unreachable ones)
    const userRelays = new Set<string>();
    for (const user of knownUsers) {
      if (user.relays && Array.isArray(user.relays)) {
        for (const relay of user.relays as string[]) {
          // Skip local/private relays that won't be reachable
          if (relay.includes('127.0.0.1') ||
              relay.includes('localhost') ||
              relay.endsWith('.local') ||
              relay.includes('.onion')) {
            continue;
          }
          userRelays.add(relay);
        }
      }
    }

    // Determine which type to fetch (NIP-51 compliant: type discrimination via tags, not kinds)
    // Query both kinds for backward compatibility (old events used kind 30002 for albums)
    const kinds = [FAVORITE_KIND, FAVORITE_ALBUM_KIND];
    const typeFilter: 'track' | 'album' | 'all' = type === 'tracks' ? 'track' : type === 'albums' ? 'album' : 'all';

    // Fixed cutoff date: November 27th, 2025 UTC - don't show anything older
    const cutoffTimestamp = Math.floor(Date.UTC(2025, 10, 27) / 1000); // Month is 0-indexed, so 10 = November

    // Combine user relays with default relays for querying
    // This ensures we find favorites published to user-specific relays
    const queryRelays = userRelays.size > 0 ? Array.from(userRelays) : undefined;

    // Fetch favorites from Nostr relays - only from cutoff date onwards
    const favorites = await fetchGlobalFavorites({
      limit: limit * 4, // Fetch more to account for filtering
      kinds,
      type: typeFilter, // NIP-51: filter by type tag instead of kind
      excludePubkey: excludeSelf && userPubkey ? userPubkey : undefined,
      timeout: 15000, // Increased timeout for more relays
      since: cutoffTimestamp, // Only get favorites from Nov 27, 2025 onwards
      relays: queryRelays, // Query user relays if available
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
          if (track.guid) {
            tracksMap.set(track.guid, track);
          }
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
          // Include first track for single-track albums
          Track: {
            take: 1,
            orderBy: { trackOrder: 'asc' },
            select: { id: true, title: true },
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
          const trackCount = album._count?.Track || 0;
          item = {
            id: album.id,
            title: album.title,
            artist: album.artist,
            image: album.image,
            trackCount,
            type: album.type,
            // For single-track albums, include the track data so it can be favorited as a track
            singleTrack: trackCount === 1 && album.Track?.[0] ? {
              id: album.Track[0].id,
              title: album.Track[0].title,
            } : undefined,
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
