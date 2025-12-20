import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';
import { addUnresolvedFeeds } from '@/lib/feed-discovery';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * GET /api/favorites/tracks
 * Get all favorite tracks for the current session or user
 */
export async function GET(request: NextRequest) {
  try {
    const sessionId = getSessionIdFromRequest(request);
    const userId = normalizePubkey(request.headers.get('x-nostr-user-id'));
    
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

    if (favoriteTracks.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0
      });
    }

    // Get track details for each favorite
    // trackId might be: id, guid, or a full URL
    // Try to match by id first, then by guid
    const trackIds = favoriteTracks.map(ft => ft.trackId);
    
    // First, try to find tracks by id
    let tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      include: {
        Feed: {
          select: {
            title: true,
            artist: true,
            image: true,
            id: true,
            v4vValue: true,
            v4vRecipient: true,
            originalUrl: true
          }
        }
      }
    });

    // Find which trackIds weren't matched by id
    const matchedIds = new Set(tracks.map(t => t.id));
    const unmatchedTrackIds = trackIds.filter(id => !matchedIds.has(id));

    // If there are unmatched trackIds, try to match by guid
    if (unmatchedTrackIds.length > 0) {
      const tracksByGuid = await prisma.track.findMany({
        where: { guid: { in: unmatchedTrackIds } },
        include: {
          Feed: {
            select: {
              title: true,
              artist: true,
              image: true,
              id: true,
              v4vValue: true,
              v4vRecipient: true,
              originalUrl: true
            }
          }
        }
      });
      
      // Combine tracks found by id and guid
      tracks = [...tracks, ...tracksByGuid];
      
      // Find which trackIds still weren't matched
      const matchedGuids = new Set(tracksByGuid.map(t => t.guid));
      const stillUnmatched = unmatchedTrackIds.filter(id => !matchedGuids.has(id));
      
      // If there are still unmatched trackIds, try to match by audioUrl (in case trackId is a full URL)
      if (stillUnmatched.length > 0) {
        const tracksByAudioUrl = await prisma.track.findMany({
          where: { audioUrl: { in: stillUnmatched } },
          include: {
            Feed: {
              select: {
                title: true,
                artist: true,
                image: true,
                id: true,
                v4vValue: true,
                v4vRecipient: true,
                originalUrl: true
              }
            }
          }
        });
        
        // Combine all tracks
        tracks = [...tracks, ...tracksByAudioUrl];
      }
    }

    // Map tracks with favorite metadata
    // Match by id, guid, or audioUrl since trackId could be any of these
    const tracksWithFavorites = tracks.map(track => {
      const favorite = favoriteTracks.find(ft =>
        ft.trackId === track.id ||
        ft.trackId === track.guid ||
        ft.trackId === track.audioUrl
      );
      return {
        ...track,
        favoritedAt: favorite?.createdAt,
        nostrEventId: favorite?.nostrEventId
      };
    });

    // Deduplicate by title + artist
    // Priority: 1) Keep one with nostrEventId, 2) Keep oldest if tie
    const seenTracks = new Map<string, typeof tracksWithFavorites[0]>();
    for (const track of tracksWithFavorites) {
      const key = `${(track.title || '').toLowerCase().trim()}|${(track.Feed?.artist || '').toLowerCase().trim()}`;
      const existing = seenTracks.get(key);
      if (!existing) {
        seenTracks.set(key, track);
      } else {
        // Prefer the one with nostrEventId (synced to Nostr)
        const existingHasNostr = !!existing.nostrEventId;
        const trackHasNostr = !!track.nostrEventId;
        if (trackHasNostr && !existingHasNostr) {
          seenTracks.set(key, track);
        } else if (!trackHasNostr && existingHasNostr) {
          // Keep existing (has nostr)
        } else {
          // Both have or both don't have nostrEventId - keep oldest
          if (track.favoritedAt && existing.favoritedAt && track.favoritedAt < existing.favoritedAt) {
            seenTracks.set(key, track);
          }
        }
      }
    }
    const deduplicatedTracks = Array.from(seenTracks.values());

    return NextResponse.json({
      success: true,
      data: deduplicatedTracks,
      count: deduplicatedTracks.length
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
  let trackId: string | undefined;
  let nostrEventId: string | undefined;
  let sessionId: string | null = null;
  let userId: string | null = null;
  
  try {
    sessionId = getSessionIdFromRequest(request);
    userId = request.headers.get('x-nostr-user-id');
    
    if (!sessionId && !userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Session ID or user ID required'
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    trackId = body.trackId;
    nostrEventId = body.nostrEventId;
    const feedGuidForImport = body.feedGuidForImport;

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

    // If track not found and we have a feedGuid, trigger album import AFTER saving favorite
    // This is done asynchronously so the user gets immediate feedback
    const shouldImportAlbum = !track && feedGuidForImport;

    // Build list of all possible trackId values to check for duplicates
    // This prevents the same track from being favorited multiple times with different identifiers
    const possibleTrackIds: string[] = [trackId];
    if (track) {
      if (track.id && track.id !== trackId) possibleTrackIds.push(track.id);
      if (track.guid && track.guid !== trackId) possibleTrackIds.push(track.guid);
      if (track.audioUrl && track.audioUrl !== trackId) possibleTrackIds.push(track.audioUrl);
    }

    // Check if already favorited - use findFirst to handle both userId and sessionId cases
    // Check ALL possible identifiers, not just the one provided
    const whereClause: any = { trackId: { in: possibleTrackIds } };
    if (userId) {
      whereClause.userId = userId;
    } else if (sessionId) {
      whereClause.sessionId = sessionId;
    }

    const existing = await prisma.favoriteTrack.findFirst({
      where: whereClause
    });

    if (existing) {
      // If it exists and we have a nostrEventId, update it
      if (nostrEventId && !existing.nostrEventId) {
        try {
          const updated = await prisma.favoriteTrack.update({
            where: { id: existing.id },
            data: { nostrEventId, nip51Format: true }
          });
          return NextResponse.json({
            success: true,
            data: updated,
            message: 'Track already in favorites, updated with Nostr event ID'
          });
        } catch (updateError) {
          console.error('Error updating existing favorite with nostrEventId:', updateError);
          // If update fails, just return the existing favorite
          return NextResponse.json({
            success: true,
            data: existing,
            message: 'Track already in favorites'
          });
        }
      }
      return NextResponse.json({
        success: true,
        data: existing,
        message: 'Track already in favorites'
      });
    }

    // Add to favorites
    const createData: any = {
      ...(userId ? { userId } : {}),
      ...(sessionId ? { sessionId } : {}),
      trackId
    };
    
    // Only add nostrEventId if it's a valid non-empty string
    if (nostrEventId && typeof nostrEventId === 'string' && nostrEventId.trim().length > 0) {
      createData.nostrEventId = nostrEventId.trim();
      createData.nip51Format = true;  // Mark as published in NIP-51 format
    }
    
    let favorite;
    try {
      favorite = await prisma.favoriteTrack.create({
        data: createData
      });
    } catch (createError: any) {
      // Handle unique constraint violation (race condition or duplicate)
      if (createError?.code === 'P2002' || createError?.message?.includes('Unique constraint')) {
        // Try to find the existing favorite again
        const existingFavorite = await prisma.favoriteTrack.findFirst({
          where: whereClause
        });
        
        if (existingFavorite) {
          // If it exists and we have a nostrEventId, try to update it
          if (nostrEventId && !existingFavorite.nostrEventId) {
            try {
              const updated = await prisma.favoriteTrack.update({
                where: { id: existingFavorite.id },
                data: { nostrEventId: nostrEventId.trim(), nip51Format: true }
              });
              return NextResponse.json({
                success: true,
                data: updated,
                message: 'Track already in favorites, updated with Nostr event ID'
              });
            } catch (updateError) {
              console.error('Error updating existing favorite with nostrEventId:', updateError);
            }
          }
          // Return existing favorite
          return NextResponse.json({
            success: true,
            data: existingFavorite,
            message: 'Track already in favorites'
          });
        }
      }
      // Re-throw if it's not a unique constraint error
      throw createError;
    }

    // Trigger album import asynchronously (fire and forget)
    // User gets immediate response, album imports in background
    if (shouldImportAlbum) {
      console.log(`🔄 Triggering background album import for: ${feedGuidForImport}`);

      // Don't await - let it run in background
      (async () => {
        try {
          // Check if feed already exists
          const existingFeed = await prisma.feed.findUnique({
            where: { id: feedGuidForImport }
          });

          if (!existingFeed) {
            console.log(`📥 Auto-importing album: ${feedGuidForImport}`);
            await addUnresolvedFeeds([feedGuidForImport]);
            console.log(`✅ Album import completed for: ${feedGuidForImport}`);
          } else {
            console.log(`⚡ Feed already exists: ${feedGuidForImport}`);
          }
        } catch (importError) {
          console.error(`❌ Failed to import album ${feedGuidForImport}:`, importError);
        }
      })();
    }

    return NextResponse.json({
      success: true,
      data: favorite,
      albumImportTriggered: shouldImportAlbum
    }, { status: 201 });
  } catch (error) {
    console.error('Error adding track to favorites:', error);
    
    // Better error message extraction
    let errorMessage = 'Unknown error';
    let errorCode: string | undefined;
    let errorStack: string | undefined;
    
    if (error instanceof Error) {
      errorMessage = error.message || 'Unknown error';
      errorStack = error.stack;
    } else if (typeof error === 'object' && error !== null) {
      // Handle Prisma errors
      const prismaError = error as any;
      errorCode = prismaError.code;
      errorMessage = prismaError.message || JSON.stringify(error);
    } else {
      errorMessage = String(error);
    }
    
    // Log full error details for debugging
    console.error('Full error details:', {
      message: errorMessage,
      code: errorCode,
      stack: errorStack,
      trackId,
      userId,
      sessionId,
      hasNostrEventId: !!nostrEventId,
      errorType: error?.constructor?.name,
      error: error
    });
    
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
    
    // Check for Prisma schema errors
    if (errorCode === 'P2002' || errorMessage.includes('Unique constraint')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Track is already in favorites',
          details: errorMessage,
          code: errorCode
        },
        { status: 409 } // Conflict
      );
    }
    
    if (errorMessage.includes('Unknown arg') || errorMessage.includes('Argument') || errorMessage.includes('Field')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Database schema mismatch. Please run: npx prisma db push',
          details: errorMessage
        },
        { status: 500 }
      );
    }
    
    // In development, include more error details
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add track to favorites',
        details: errorMessage,
        ...(errorCode && { code: errorCode }),
        ...(isDevelopment && {
          debug: {
            trackId: trackId?.substring(0, 100), // Truncate long trackIds
            userId: userId || null,
            sessionId: sessionId || null,
            hasNostrEventId: !!nostrEventId,
            errorType: error?.constructor?.name,
            errorCode: errorCode
          }
        })
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/favorites/tracks
 * Remove a track from favorites (using body instead of path param for URL trackIds)
 * Body: { trackId: string }
 */
export async function DELETE(request: NextRequest) {
  try {
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

    const body = await request.json().catch(() => ({}));
    const trackId = body.trackId;

    if (!trackId || typeof trackId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'trackId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // First, try to find the track to get all its identifiers (id, guid, audioUrl)
    // This helps us find the favorite even if it was stored with a different identifier
    let track = await prisma.track.findUnique({
      where: { id: trackId }
    });

    // If not found by id, try guid
    if (!track) {
      track = await prisma.track.findUnique({
        where: { guid: trackId }
      });
    }

    // If still not found, try audioUrl
    if (!track) {
      track = await prisma.track.findFirst({
        where: { audioUrl: trackId }
      });
    }

    // Build list of possible trackId values to search for
    const possibleTrackIds: string[] = [];
    if (track) {
      // If we found the track, use all its identifiers
      if (track.id) possibleTrackIds.push(track.id);
      if (track.guid) possibleTrackIds.push(track.guid);
      if (track.audioUrl) possibleTrackIds.push(track.audioUrl);
    } else {
      // If track not found, just use the provided trackId
      possibleTrackIds.push(trackId);
    }

    // Build where clause - support both session and user
    // Search for favorites that match any of the possible trackId values
    const where: any = {
      trackId: { in: possibleTrackIds }
    };
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

    // Remove from favorites using the actual favorite's trackId
    // (not the search where clause, which might match multiple)
    await prisma.favoriteTrack.deleteMany({
      where: {
        id: favorite.id
      }
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

/**
 * PATCH /api/favorites/tracks
 * Update a favorite track (e.g., add nostrEventId)
 * Body: { trackId: string, nostrEventId?: string }
 */
export async function PATCH(request: NextRequest) {
  try {
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
