import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * DELETE /api/favorites/delete-all
 * Delete all favorites for a user or session
 * Query params:
 *   - type: 'nostr' | 'local' | 'all' (default: 'all')
 */
export async function DELETE(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = request.headers.get('x-nostr-user-id');
    const { searchParams } = new URL(request.url);
    const deleteType = searchParams.get('type') || 'all';

    // Validate delete type
    if (!['nostr', 'local', 'all'].includes(deleteType)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid type parameter. Must be "nostr", "local", or "all"'
        },
        { status: 400 }
      );
    }

    let deletedAlbums = 0;
    let deletedTracks = 0;

    // Delete Nostr favorites (userId-based)
    if ((deleteType === 'nostr' || deleteType === 'all') && userId) {
      const albumResult = await prisma.favoriteAlbum.deleteMany({
        where: { userId }
      });
      const trackResult = await prisma.favoriteTrack.deleteMany({
        where: { userId }
      });
      deletedAlbums += albumResult.count;
      deletedTracks += trackResult.count;
    }

    // Delete local favorites (sessionId-based)
    if ((deleteType === 'local' || deleteType === 'all') && sessionId) {
      const albumResult = await prisma.favoriteAlbum.deleteMany({
        where: { sessionId }
      });
      const trackResult = await prisma.favoriteTrack.deleteMany({
        where: { sessionId }
      });
      deletedAlbums += albumResult.count;
      deletedTracks += trackResult.count;
    }

    // Check if any operation was performed
    if (!userId && !sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: 'No session or user ID provided'
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${deletedAlbums} album favorites and ${deletedTracks} track favorites`,
      deletedAlbums,
      deletedTracks,
      type: deleteType
    });
  } catch (error) {
    console.error('Error deleting all favorites:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete favorites',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/favorites/delete-all
 * Get count of favorites that would be deleted
 * Query params:
 *   - type: 'nostr' | 'local' | 'all' (default: 'all')
 *   - includeEventIds: 'true' to include nostrEventIds for deletion
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = request.headers.get('x-nostr-user-id');
    const { searchParams } = new URL(request.url);
    const countType = searchParams.get('type') || 'all';
    const includeEventIds = searchParams.get('includeEventIds') === 'true';

    let nostrAlbums = 0;
    let nostrTracks = 0;
    let localAlbums = 0;
    let localTracks = 0;
    let nostrEventIds: { albums: string[]; tracks: string[] } = { albums: [], tracks: [] };

    // Count Nostr favorites
    if ((countType === 'nostr' || countType === 'all') && userId) {
      if (includeEventIds) {
        // Fetch with eventIds for Nostr deletion
        const albums = await prisma.favoriteAlbum.findMany({
          where: { userId },
          select: { nostrEventId: true }
        });
        const tracks = await prisma.favoriteTrack.findMany({
          where: { userId },
          select: { nostrEventId: true }
        });
        nostrAlbums = albums.length;
        nostrTracks = tracks.length;
        nostrEventIds.albums = albums.filter(a => a.nostrEventId).map(a => a.nostrEventId!);
        nostrEventIds.tracks = tracks.filter(t => t.nostrEventId).map(t => t.nostrEventId!);
      } else {
        nostrAlbums = await prisma.favoriteAlbum.count({
          where: { userId }
        });
        nostrTracks = await prisma.favoriteTrack.count({
          where: { userId }
        });
      }
    }

    // Count local favorites
    if ((countType === 'local' || countType === 'all') && sessionId) {
      localAlbums = await prisma.favoriteAlbum.count({
        where: { sessionId }
      });
      localTracks = await prisma.favoriteTrack.count({
        where: { sessionId }
      });
    }

    return NextResponse.json({
      success: true,
      counts: {
        nostr: {
          albums: nostrAlbums,
          tracks: nostrTracks,
          total: nostrAlbums + nostrTracks
        },
        local: {
          albums: localAlbums,
          tracks: localTracks,
          total: localAlbums + localTracks
        },
        all: {
          albums: nostrAlbums + localAlbums,
          tracks: nostrTracks + localTracks,
          total: nostrAlbums + nostrTracks + localAlbums + localTracks
        }
      },
      hasNostrUser: !!userId,
      hasSession: !!sessionId,
      ...(includeEventIds ? { nostrEventIds } : {})
    });
  } catch (error) {
    console.error('Error counting favorites:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to count favorites',
        details: errorMessage
      },
      { status: 500 }
    );
  }
}
