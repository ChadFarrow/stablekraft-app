import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * GET /api/favorites/albums
 * Get all favorite albums for the current session
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

    const favoriteAlbums = await prisma.favoriteAlbum.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Get feed details for each favorite
    const feedIds = favoriteAlbums.map(fa => fa.feedId);
    const feeds = await prisma.feed.findMany({
      where: { id: { in: feedIds } },
      include: {
        Track: {
          take: 5,
          orderBy: { trackOrder: 'asc' },
          select: {
            id: true,
            title: true,
            artist: true,
            duration: true,
            image: true
          }
        }
      }
    });

    // Map feeds with favorite metadata
    const feedsWithFavorites = feeds.map(feed => ({
      ...feed,
      favoritedAt: favoriteAlbums.find(fa => fa.feedId === feed.id)?.createdAt
    }));

    return NextResponse.json({
      success: true,
      data: feedsWithFavorites,
      count: feedsWithFavorites.length
    });
  } catch (error) {
    console.error('Error fetching favorite albums:', error);
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
        error: 'Failed to fetch favorite albums',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/favorites/albums
 * Add an album (feed) to favorites
 * Body: { feedId: string }
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
    const { feedId } = body;

    if (!feedId || typeof feedId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'feedId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Verify feed exists
    const feed = await prisma.feed.findUnique({
      where: { id: feedId }
    });

    if (!feed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Album (feed) not found'
        },
        { status: 404 }
      );
    }

    // Check if already favorited
    let existing;
    if (userId) {
      existing = await prisma.favoriteAlbum.findUnique({
        where: {
          userId_feedId: {
            userId,
            feedId
          }
        }
      });
    } else if (sessionId) {
      existing = await prisma.favoriteAlbum.findUnique({
        where: {
          sessionId_feedId: {
            sessionId: sessionId!,
            feedId
          }
        }
      });
    }

    if (existing) {
      return NextResponse.json({
        success: true,
        data: existing,
        message: 'Album already in favorites'
      });
    }

    // Add to favorites
    const favorite = await prisma.favoriteAlbum.create({
      data: {
        ...(userId ? { userId } : {}),
        ...(sessionId ? { sessionId } : {}),
        feedId
      }
    });

    return NextResponse.json({
      success: true,
      data: favorite
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding album to favorites:', error);
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
        error: 'Failed to add album to favorites',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

