import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * POST /api/favorites/migrate-single-tracks
 * Migrate single-track album favorites to track favorites
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = request.headers.get('x-nostr-user-id');

    if (!sessionId && !userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Session ID or user ID required'
        },
        { status: 400 }
      );
    }

    // Build where clause
    const where: any = {};
    if (userId) {
      where.userId = userId;
    } else if (sessionId) {
      where.sessionId = sessionId;
    }

    // Get all favorite albums for this user/session
    const favoriteAlbums = await prisma.favoriteAlbum.findMany({
      where
    });

    if (favoriteAlbums.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No favorite albums to migrate',
        migrated: 0
      });
    }

    // Get feed details with track counts
    const feedIds = favoriteAlbums.map(fa => fa.feedId);
    const feeds = await prisma.feed.findMany({
      where: { id: { in: feedIds } },
      include: {
        Track: {
          orderBy: { trackOrder: 'asc' },
          select: {
            id: true,
            guid: true,
            audioUrl: true,
            title: true
          }
        }
      }
    });

    // Create a map of feedId -> feed
    const feedMap = new Map(feeds.map(feed => [feed.id, feed]));

    let migratedCount = 0;
    const migratedAlbums: string[] = [];

    // Process each favorite album
    for (const favorite of favoriteAlbums) {
      const feed = feedMap.get(favorite.feedId);

      // Skip if feed not found or has more than 1 track
      if (!feed || feed.Track.length !== 1) {
        continue;
      }

      const track = feed.Track[0];
      // Use guid, audioUrl, or composite ID as trackId
      const trackId = track.guid || track.audioUrl || `${favorite.feedId}-${track.title}`;

      if (!trackId) {
        console.warn(`Skipping album ${favorite.feedId}: no valid track ID`);
        continue;
      }

      // Check if track favorite already exists
      let existingTrack;
      if (userId) {
        existingTrack = await prisma.favoriteTrack.findFirst({
          where: { userId, trackId }
        });
      } else if (sessionId) {
        existingTrack = await prisma.favoriteTrack.findFirst({
          where: { sessionId, trackId }
        });
      }

      if (!existingTrack) {
        // Create track favorite
        await prisma.favoriteTrack.create({
          data: {
            ...(userId ? { userId } : {}),
            ...(sessionId ? { sessionId } : {}),
            trackId,
            nostrEventId: favorite.nostrEventId,
            createdAt: favorite.createdAt // Preserve original favorite date
          }
        });
      }

      // Delete album favorite (use deleteMany to avoid error if already deleted)
      await prisma.favoriteAlbum.deleteMany({
        where: { id: favorite.id }
      });

      migratedCount++;
      migratedAlbums.push(feed.title);
    }

    return NextResponse.json({
      success: true,
      message: `Migrated ${migratedCount} single-track album(s) to track favorites`,
      migrated: migratedCount,
      albums: migratedAlbums
    });
  } catch (error) {
    console.error('Error migrating favorites:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to migrate favorites',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
