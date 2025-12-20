import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * POST /api/favorites/check
 * Check if tracks/albums are favorited for the current session
 * Body: { trackIds?: string[], feedIds?: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = normalizePubkey(request.headers.get('x-nostr-user-id'));
    
    if (!sessionId && !userId) {
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

    // Build where clause - support both session and user
    const whereTracks: any = { trackId: { in: trackIds } };
    const whereAlbums: any = { feedId: { in: feedIds } };
    
    if (userId) {
      whereTracks.userId = userId;
      whereAlbums.userId = userId;
    } else if (sessionId) {
      whereTracks.sessionId = sessionId;
      whereAlbums.sessionId = sessionId;
    }

    // Check tracks
    if (trackIds.length > 0) {
      try {
        // First, look up tracks to get all their identifiers (id, guid, audioUrl)
        // This allows us to match favorites stored with different identifiers
        const tracks = await prisma.track.findMany({
          where: {
            OR: [
              { id: { in: trackIds } },
              { guid: { in: trackIds } },
              { audioUrl: { in: trackIds } }
            ]
          },
          select: { id: true, guid: true, audioUrl: true }
        });

        // Build a map: input trackId -> all possible identifiers for that track
        const trackIdToAllIds = new Map<string, string[]>();
        for (const inputId of trackIds) {
          const possibleIds = [inputId];
          // Find if this inputId matches any track
          const matchedTrack = tracks.find(t =>
            t.id === inputId || t.guid === inputId || t.audioUrl === inputId
          );
          if (matchedTrack) {
            if (matchedTrack.id && !possibleIds.includes(matchedTrack.id)) possibleIds.push(matchedTrack.id);
            if (matchedTrack.guid && !possibleIds.includes(matchedTrack.guid)) possibleIds.push(matchedTrack.guid);
            if (matchedTrack.audioUrl && !possibleIds.includes(matchedTrack.audioUrl)) possibleIds.push(matchedTrack.audioUrl);
          }
          trackIdToAllIds.set(inputId, possibleIds);
        }

        // Get all possible trackIds to check
        const allPossibleIds = [...new Set(Array.from(trackIdToAllIds.values()).flat())];

        // Check favorites with expanded identifier list
        const expandedWhere: any = { trackId: { in: allPossibleIds } };
        if (userId) {
          expandedWhere.userId = userId;
        } else if (sessionId) {
          expandedWhere.sessionId = sessionId;
        }

        const favoriteTracks = await prisma.favoriteTrack.findMany({
          where: expandedWhere,
          select: { trackId: true }
        });

        const favoritedTrackIds = new Set(favoriteTracks.map(ft => ft.trackId));

        // Check if ANY of the possible identifiers for each input trackId is favorited
        trackIds.forEach((trackId: string) => {
          const possibleIds = trackIdToAllIds.get(trackId) || [trackId];
          results.tracks[trackId] = possibleIds.some(id => favoritedTrackIds.has(id));
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
          where: whereAlbums,
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

