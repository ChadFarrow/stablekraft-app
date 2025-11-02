import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * GET /api/favorites/tracks
 * Get all favorite tracks for the current session
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    
    if (!sessionId) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No session ID provided'
      });
    }

    const favoriteTracks = await prisma.favoriteTrack.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' }
    });

    // Get track details for each favorite
    const trackIds = favoriteTracks.map(ft => ft.trackId);
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      include: {
        Feed: {
          select: {
            title: true,
            artist: true,
            image: true,
            id: true
          }
        }
      }
    });

    // Map tracks with favorite metadata
    const tracksWithFavorites = tracks.map(track => ({
      ...track,
      favoritedAt: favoriteTracks.find(ft => ft.trackId === track.id)?.createdAt
    }));

    return NextResponse.json({
      success: true,
      data: tracksWithFavorites,
      count: tracksWithFavorites.length
    });
  } catch (error) {
    console.error('Error fetching favorite tracks:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // If tables don't exist yet, return empty array
    if (errorMessage.includes('does not exist') || errorMessage.includes('Unknown model')) {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'Favorites tables not initialized yet'
      });
    }
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch favorite tracks',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/favorites/tracks
 * Add a track to favorites
 * Body: { trackId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    
    if (!sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Session ID required'
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { trackId } = body;

    if (!trackId || typeof trackId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'trackId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Verify track exists
    const track = await prisma.track.findUnique({
      where: { id: trackId }
    });

    if (!track) {
      return NextResponse.json(
        {
          success: false,
          error: 'Track not found'
        },
        { status: 404 }
      );
    }

    // Check if already favorited
    const existing = await prisma.favoriteTrack.findUnique({
      where: {
        sessionId_trackId: {
          sessionId,
          trackId
        }
      }
    });

    if (existing) {
      return NextResponse.json({
        success: true,
        data: existing,
        message: 'Track already in favorites'
      });
    }

    // Add to favorites
    const favorite = await prisma.favoriteTrack.create({
      data: {
        sessionId,
        trackId
      }
    });

    return NextResponse.json({
      success: true,
      data: favorite
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding track to favorites:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // If tables don't exist yet, return a helpful message
    if (errorMessage.includes('does not exist') || errorMessage.includes('Unknown model')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Favorites tables not initialized. Please run database migration.',
          details: errorMessage
        },
        { status: 503 } // Service Unavailable
      );
    }
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add track to favorites',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

