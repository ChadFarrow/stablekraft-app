import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * POST /api/favorites/dedupe-tracks
 * Remove duplicate favorite tracks, keeping the oldest one
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

    // Get all favorite tracks for this user/session
    const favoriteTracks = await prisma.favoriteTrack.findMany({
      where,
      orderBy: { createdAt: 'asc' } // Keep oldest
    });

    if (favoriteTracks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No favorite tracks found',
        removed: 0
      });
    }

    // Get track details to match by title + artist
    const trackIds = favoriteTracks.map(ft => ft.trackId);
    const tracks = await prisma.track.findMany({
      where: {
        OR: [
          { id: { in: trackIds } },
          { guid: { in: trackIds } },
          { audioUrl: { in: trackIds } }
        ]
      },
      include: {
        Feed: {
          select: { artist: true }
        }
      }
    });

    // Create a map of trackId -> track details
    const trackDetailsMap = new Map<string, { title: string; artist: string }>();
    for (const track of tracks) {
      const key = track.id;
      const artist = track.Feed?.artist || 'Unknown';
      trackDetailsMap.set(key, { title: track.title, artist });
      if (track.guid) trackDetailsMap.set(track.guid, { title: track.title, artist });
      if (track.audioUrl) trackDetailsMap.set(track.audioUrl, { title: track.title, artist });
    }

    // Group by title + artist (normalized) to find duplicates
    const titleArtistMap = new Map<string, typeof favoriteTracks>();
    for (const fav of favoriteTracks) {
      const details = trackDetailsMap.get(fav.trackId);
      // Create a key from title + artist, or fall back to trackId
      const key = details
        ? `${details.title.toLowerCase().trim()}|${details.artist.toLowerCase().trim()}`
        : fav.trackId;

      const existing = titleArtistMap.get(key);
      if (existing) {
        existing.push(fav);
      } else {
        titleArtistMap.set(key, [fav]);
      }
    }

    // Find and remove duplicates (keep the first/oldest one)
    let removedCount = 0;
    const removedTitles: string[] = [];

    for (const [key, favs] of titleArtistMap) {
      if (favs.length > 1) {
        // Keep the first one (oldest), delete the rest
        const toDelete = favs.slice(1);
        for (const dup of toDelete) {
          await prisma.favoriteTrack.delete({
            where: { id: dup.id }
          });
          removedCount++;
          removedTitles.push(key.split('|')[0] || dup.trackId);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Removed ${removedCount} duplicate favorite track(s)`,
      removed: removedCount,
      titles: [...new Set(removedTitles)] // Unique titles that had duplicates
    });
  } catch (error) {
    console.error('Error deduplicating favorites:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to deduplicate favorites',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
