import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * POST /api/favorites/check
 * Check if tracks/albums are favorited for the current session
 * Body: { trackIds?: string[], feedIds?: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    
    if (!sessionId) {
      return NextResponse.json({
        success: true,
        data: {
          tracks: {},
          albums: {}
        }
      });
    }

    const body = await request.json();
    const { trackIds = [], feedIds = [] } = body;

    const results: {
      tracks: Record<string, boolean>;
      albums: Record<string, boolean>;
    } = {
      tracks: {},
      albums: {}
    };

    // Check tracks
    if (trackIds.length > 0) {
      try {
        const favoriteTracks = await prisma.favoriteTrack.findMany({
          where: {
            sessionId,
            trackId: { in: trackIds }
          },
          select: {
            trackId: true
          }
        });

        const favoritedTrackIds = new Set(favoriteTracks.map(ft => ft.trackId));
        
        trackIds.forEach((trackId: string) => {
          results.tracks[trackId] = favoritedTrackIds.has(trackId);
        });
      } catch (trackError) {
        // If tables don't exist, just set all to false
        console.warn('Error checking favorite tracks (tables may not exist):', trackError);
        trackIds.forEach((trackId: string) => {
          results.tracks[trackId] = false;
        });
      }
    }

    // Check albums
    if (feedIds.length > 0) {
      try {
        const favoriteAlbums = await prisma.favoriteAlbum.findMany({
          where: {
            sessionId,
            feedId: { in: feedIds }
          },
          select: {
            feedId: true
          }
        });

        const favoritedFeedIds = new Set(favoriteAlbums.map(fa => fa.feedId));
        
        feedIds.forEach((feedId: string) => {
          results.albums[feedId] = favoritedFeedIds.has(feedId);
        });
      } catch (albumError) {
        // If tables don't exist, just set all to false
        console.warn('Error checking favorite albums (tables may not exist):', albumError);
        feedIds.forEach((feedId: string) => {
          results.albums[feedId] = false;
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error('Error checking favorites:', error);
    
    // Return empty results if there's any error (tables may not exist yet)
    return NextResponse.json({
      success: true,
      data: {
        tracks: {},
        albums: {}
      }
    });
  }
}

