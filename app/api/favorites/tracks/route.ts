import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * GET /api/favorites/tracks
 * Get all favorite tracks for the current session or user
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = request.headers.get('x-nostr-user-id');
    
    // Build where clause - support both session and user
    const where: any = {};
    if (userId) {
      where.userId = userId;
    } else if (sessionId) {
      where.sessionId = sessionId;
    } else {
      return NextResponse.json({
        success: true,
        data: [],
        message: 'No session ID or user ID provided'
      });
    }

    const favoriteTracks = await prisma.favoriteTrack.findMany({
      where,
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
 * Body: { trackId: string, nostrEventId?: string }
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

    const body = await request.json();
    const { trackId, nostrEventId } = body;

    if (!trackId || typeof trackId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'trackId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Verify track exists - try id first, then guid
    let track = await prisma.track.findUnique({
      where: { id: trackId }
    });

    // If not found by id, try guid
    if (!track) {
      track = await prisma.track.findUnique({
        where: { guid: trackId }
      });
    }

    // If still not found, allow saving anyway (tracks might not be in DB yet)
    // This allows favoriting tracks that haven't been indexed yet
    // The trackId will be stored and can be matched later when the track is added to DB

    // Check if already favorited
    let existing;
    if (userId) {
      existing = await prisma.favoriteTrack.findUnique({
        where: {
          userId_trackId: {
            userId,
            trackId
          }
        }
      });
    } else if (sessionId) {
      existing = await prisma.favoriteTrack.findUnique({
        where: {
          sessionId_trackId: {
            sessionId: sessionId!,
            trackId
          }
        }
      });
    }

    if (existing) {
      // If it exists and we have a nostrEventId, update it
      if (nostrEventId && !existing.nostrEventId) {
        const updated = await prisma.favoriteTrack.update({
          where: { id: existing.id },
          data: { nostrEventId }
        });
        return NextResponse.json({
          success: true,
          data: updated,
          message: 'Track already in favorites, updated with Nostr event ID'
        });
      }
      return NextResponse.json({
        success: true,
        data: existing,
        message: 'Track already in favorites'
      });
    }

    // Add to favorites
    const favorite = await prisma.favoriteTrack.create({
      data: {
        ...(userId ? { userId } : {}),
        ...(sessionId ? { sessionId } : {}),
        trackId,
        ...(nostrEventId ? { nostrEventId } : {})
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

/**
 * PATCH /api/favorites/tracks
 * Update a favorite track (e.g., add nostrEventId)
 * Body: { trackId: string, nostrEventId?: string }
 */
export async function PATCH(request: NextRequest) {
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

    const body = await request.json();
    const { trackId, nostrEventId } = body;

    if (!trackId || typeof trackId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'trackId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Find the existing favorite
    const where: any = { trackId };
    if (userId) {
      where.userId = userId;
    } else if (sessionId) {
      where.sessionId = sessionId;
    }

    const existing = await prisma.favoriteTrack.findFirst({
      where
    });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: 'Favorite not found'
        },
        { status: 404 }
      );
    }

    // Update with nostrEventId if provided
    const updated = await prisma.favoriteTrack.update({
      where: { id: existing.id },
      data: {
        ...(nostrEventId ? { nostrEventId } : {})
      }
    });

    return NextResponse.json({
      success: true,
      data: updated
    });
  } catch (error) {
    console.error('Error updating favorite track:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update favorite track',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
