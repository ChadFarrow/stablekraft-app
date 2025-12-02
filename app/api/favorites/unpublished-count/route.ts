import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * GET /api/favorites/unpublished-count
 * Get count of favorites that haven't been published to Nostr yet
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = request.headers.get('x-nostr-user-id');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User must be authenticated with Nostr'
      }, { status: 401 });
    }

    // Count tracks where nostrEventId is null
    const unpublishedTracks = await prisma.favoriteTrack.count({
      where: {
        userId,
        nostrEventId: null
      }
    });

    // Count albums where nostrEventId is null
    const unpublishedAlbums = await prisma.favoriteAlbum.count({
      where: {
        userId,
        nostrEventId: null
      }
    });

    return NextResponse.json({
      success: true,
      unpublished: {
        tracks: unpublishedTracks,
        albums: unpublishedAlbums,
        total: unpublishedTracks + unpublishedAlbums
      }
    });
  } catch (error) {
    console.error('Error getting unpublished favorites count:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get unpublished count' },
      { status: 500 }
    );
  }
}
