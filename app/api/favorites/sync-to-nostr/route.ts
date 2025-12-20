import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePubkey } from '@/lib/nostr/normalize';

export interface UnpublishedFavorite {
  type: 'track' | 'album';
  id: string;           // trackId or feedId
  title?: string;
  artist?: string;
  feedId?: string;      // For tracks, the parent feed ID
}

/**
 * GET /api/favorites/sync-to-nostr
 * Get list of unpublished favorites with metadata for publishing to Nostr
 * Query params:
 * - force=true: Return items needing NIP-51 republishing
 * - force=all: Return ALL favorites (for complete re-sync)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    const forceParam = request.nextUrl.searchParams.get('force');
    const forceNip51 = forceParam === 'true';
    const forceAll = forceParam === 'all';

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User must be authenticated with Nostr'
      }, { status: 401 });
    }

    const items: UnpublishedFavorite[] = [];

    // Get track favorites:
    // - If force=all: get ALL favorites (complete re-sync)
    // - If force=true: get those that need NIP-51 republishing (published but not in NIP-51 format)
    // - Otherwise: get unpublished ones
    const trackWhere: { userId: string; nostrEventId?: { not: null } | null; nip51Format?: boolean } = { userId };
    if (forceAll) {
      // Get all favorites
    } else if (forceNip51) {
      trackWhere.nostrEventId = { not: null };
      trackWhere.nip51Format = false;
    } else {
      trackWhere.nostrEventId = null;
    }

    const trackFavorites = await prisma.favoriteTrack.findMany({
      where: trackWhere,
      orderBy: { createdAt: 'desc' }
    });

    // Get track metadata for each favorite
    if (trackFavorites.length > 0) {
      const trackIds = trackFavorites.map(ft => ft.trackId);

      // Try to find tracks by id first
      const tracksById = await prisma.track.findMany({
        where: { id: { in: trackIds } },
        include: {
          Feed: {
            select: { id: true, title: true, artist: true }
          }
        }
      });

      const trackMap = new Map(tracksById.map(t => [t.id, t]));

      // Try to find unmatched by guid
      const unmatchedIds = trackIds.filter(id => !trackMap.has(id));
      if (unmatchedIds.length > 0) {
        const tracksByGuid = await prisma.track.findMany({
          where: { guid: { in: unmatchedIds } },
          include: {
            Feed: {
              select: { id: true, title: true, artist: true }
            }
          }
        });
        tracksByGuid.forEach(t => {
          if (t.guid) trackMap.set(t.guid, t);
        });
      }

      // Build items for tracks
      for (const fav of trackFavorites) {
        const track = trackMap.get(fav.trackId);
        items.push({
          type: 'track',
          id: fav.trackId,
          title: track?.title,
          artist: (track?.Feed?.artist || track?.artist) ?? undefined,
          feedId: (track?.Feed?.id || track?.feedId) ?? undefined
        });
      }
    }

    // Get album favorites:
    // - If force=all: get ALL favorites (complete re-sync)
    // - If force=true: get those that need NIP-51 republishing (published but not in NIP-51 format)
    // - Otherwise: get unpublished ones
    const albumWhere: { userId: string; nostrEventId?: { not: null } | null; nip51Format?: boolean } = { userId };
    if (forceAll) {
      // Get all favorites
    } else if (forceNip51) {
      albumWhere.nostrEventId = { not: null };
      albumWhere.nip51Format = false;
    } else {
      albumWhere.nostrEventId = null;
    }

    const albumFavorites = await prisma.favoriteAlbum.findMany({
      where: albumWhere,
      orderBy: { createdAt: 'desc' }
    });

    if (albumFavorites.length > 0) {
      const feedIds = albumFavorites.map(fa => fa.feedId);

      const feeds = await prisma.feed.findMany({
        where: { id: { in: feedIds } },
        select: { id: true, title: true, artist: true }
      });

      const feedMap = new Map(feeds.map(f => [f.id, f]));

      // Build items for albums
      for (const fav of albumFavorites) {
        const feed = feedMap.get(fav.feedId);
        items.push({
          type: 'album',
          id: fav.feedId,
          title: feed?.title,
          artist: feed?.artist ?? undefined
        });
      }
    }

    return NextResponse.json({
      success: true,
      items,
      count: items.length
    });
  } catch (error) {
    console.error('Error getting unpublished favorites:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get unpublished favorites' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/favorites/sync-to-nostr
 * Update a favorite with its nostrEventId after successful publish
 */
export async function PATCH(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User must be authenticated with Nostr'
      }, { status: 401 });
    }

    const body = await request.json();
    const { type, id, nostrEventId } = body;

    if (!type || !id || !nostrEventId) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields: type, id, nostrEventId'
      }, { status: 400 });
    }

    if (type === 'track') {
      await prisma.favoriteTrack.updateMany({
        where: {
          userId,
          trackId: id
        },
        data: { nostrEventId, nip51Format: true }
      });
    } else if (type === 'album') {
      await prisma.favoriteAlbum.updateMany({
        where: {
          userId,
          feedId: id
        },
        data: { nostrEventId, nip51Format: true }
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'Invalid type: must be "track" or "album"'
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${type} ${id} with nostrEventId`
    });
  } catch (error) {
    console.error('Error updating favorite with nostrEventId:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update favorite' },
      { status: 500 }
    );
  }
}
