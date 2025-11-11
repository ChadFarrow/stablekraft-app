import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * DELETE /api/favorites/tracks/[trackId]
 * Remove a track from favorites
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  try {
    const { trackId } = await params;
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

    // Build where clause - support both session and user
    const where: any = { trackId };
    if (userId) {
      where.userId = userId;
    } else if (sessionId) {
      where.sessionId = sessionId;
    }

    // Remove from favorites
    const deleted = await prisma.favoriteTrack.deleteMany({
      where
    });

    if (deleted.count === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Favorite not found'
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Track removed from favorites'
    });
  } catch (error) {
    console.error('Error removing track from favorites:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove track from favorites',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

