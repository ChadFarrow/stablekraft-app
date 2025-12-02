import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User must be authenticated with Nostr'
      }, { status: 401 });
    }

    const items: UnpublishedFavorite[] = [];

    // Get unpublished track favorites with track metadata
    const unpublishedTracks = await prisma.favoriteTrack.findMany({
      where: {
        userId,
        nostrEventId: null
      },
      orderBy: { createdAt: 'desc' }
    });

    // Get track metadata for each favorite
    if (unpublishedTracks.length > 0) {
      const trackIds = unpublishedTracks.map(ft => ft.trackId);

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
      for (const fav of unpublishedTracks) {
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

    // Get unpublished album favorites with feed metadata
    const unpublishedAlbums = await prisma.favoriteAlbum.findMany({
      where: {
        userId,
        nostrEventId: null
      },
      orderBy: { createdAt: 'desc' }
    });

    if (unpublishedAlbums.length > 0) {
      const feedIds = unpublishedAlbums.map(fa => fa.feedId);

      const feeds = await prisma.feed.findMany({
        where: { id: { in: feedIds } },
        select: { id: true, title: true, artist: true }
      });

      const feedMap = new Map(feeds.map(f => [f.id, f]));

      // Build items for albums
      for (const fav of unpublishedAlbums) {
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
        data: { nostrEventId }
      });
    } else if (type === 'album') {
      await prisma.favoriteAlbum.updateMany({
        where: {
          userId,
          feedId: id
        },
        data: { nostrEventId }
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
