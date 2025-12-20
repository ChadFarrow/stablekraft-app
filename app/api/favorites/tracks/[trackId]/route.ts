import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * DELETE /api/favorites/tracks/[trackId]
 * Remove a track from favorites
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ trackId: string }> }
) {
  try {
    let { trackId } = await params;
    // Decode URL-encoded trackId (in case it's a URL)
    trackId = decodeURIComponent(trackId);
    
    const sessionId = getSessionIdFromRequest(request);
    const userId = normalizePubkey(request.headers.get('x-nostr-user-id'));
    
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

    // Get the favorite first to retrieve nostrEventId before deleting
    const favorite = await prisma.favoriteTrack.findFirst({
      where
    });

    if (!favorite) {
      return NextResponse.json(
        {
          success: false,
          error: 'Favorite not found'
        },
        { status: 404 }
      );
    }

    // Remove from favorites
    await prisma.favoriteTrack.deleteMany({
      where
    });

    return NextResponse.json({
      success: true,
      message: 'Track removed from favorites',
      nostrEventId: favorite.nostrEventId || null
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

