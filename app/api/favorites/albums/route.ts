import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionIdFromRequest } from '@/lib/session-utils';
import { getPublisherInfo } from '@/lib/url-utils';
import { podcastIndexAPI } from '@/lib/podcast-index-api';
import { normalizePubkey } from '@/lib/nostr/normalize';

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
        },
        _count: {
          select: { Track: true }
        }
      }
    });

    // Create a map of feedId -> feed for quick lookup
    const feedMap = new Map(feeds.map(feed => [feed.id, feed]));

    // Map all favorites, including those without feeds (e.g., publishers not yet indexed)
    const feedsWithFavorites = favoriteAlbums.map(favorite => {
      const feed = feedMap.get(favorite.feedId);
      if (feed) {
        // Feed exists in database
        let artistName = feed.artist;

        // Use the stored favorite type - this determines which tab it appears in
        // The type is set when the favorite is created based on where it was favorited from
        // (publisher page -> 'publisher', album page -> 'album', etc.)
        // For legacy favorites without a type, fall back to the Feed's type
        const feedType = favorite.type || feed.type;

        // Resolve artist name for display
        if (!artistName || artistName === 'Unknown Artist') {
          // Try to get artist name from publisher info for display purposes only
          const publisherInfo = getPublisherInfo(favorite.feedId);
          if (publisherInfo?.name) {
            artistName = publisherInfo.name;
          } else {
            artistName = feed.title;
          }
        }

        return {
          ...feed,
          type: feedType,
          artist: artistName || feed.artist,
          favoritedAt: favorite.createdAt,
          trackCount: (feed as any)._count?.Track || 0
        };
      } else {
        // Feed doesn't exist (e.g., not yet indexed)
        // Use the stored favorite type, or try to infer from publisher mapping
        const publisherInfo = getPublisherInfo(favorite.feedId);
        const resolvedTitle = publisherInfo?.name || favorite.feedId;
        const resolvedArtist = publisherInfo?.name ?? null;

        // Use stored type, fall back to 'publisher' only if publisher info exists
        const feedType = favorite.type || (publisherInfo ? 'publisher' : 'album');

        return {
          id: favorite.feedId,
          title: resolvedTitle,
          artist: resolvedArtist,
          type: feedType,
          image: null as string | null, // Will be populated below
          itemCount: 0, // Will be populated below
          favoritedAt: favorite.createdAt,
          createdAt: favorite.createdAt,
          updatedAt: favorite.createdAt
        };
      }
    });

    // For publisher favorites without images, try to fetch from Podcast Index
    // Limit to first 5 to avoid too many API calls (batch image fetch optimization)
    const publisherFavorites = feedsWithFavorites.filter(f => f.type === 'publisher' && !f.image);
    if (publisherFavorites.length > 0) {
      // Collect all feedGuids for batch lookup
      const publisherGuids = publisherFavorites
        .slice(0, 5) // Limit API calls
        .map(p => ({ id: p.id, info: getPublisherInfo(p.id) }))
        .filter(p => p.info?.feedGuid);

      // Fetch publisher images from Podcast Index (limited parallel calls)
      const imageResults = await Promise.allSettled(
        publisherGuids.map(async ({ id, info }) => {
          try {
            const feed = await podcastIndexAPI.getFeedByGuid(info!.feedGuid!);
            return { id, image: feed?.artwork || feed?.image || null };
          } catch {
            return { id, image: null };
          }
        })
      );

      // Apply images to publishers
      for (const result of imageResults) {
        if (result.status === 'fulfilled' && result.value.image) {
          const publisher = publisherFavorites.find(p => p.id === result.value.id);
          if (publisher) {
            (publisher as any).image = result.value.image;
          }
        }
      }
    }

    // Calculate album count for ALL publisher favorites (batch query - fixes N+1)
    const allPublisherFavorites = feedsWithFavorites.filter(f => f.type === 'publisher');
    const artistNames = allPublisherFavorites
      .filter(p => p.artist && (p as any).itemCount === undefined)
      .map(p => p.artist as string);

    if (artistNames.length > 0) {
      // Single batch query to get album counts for all artists
      const albumCounts = await prisma.feed.groupBy({
        by: ['artist'],
        where: {
          artist: { in: artistNames },
          type: { not: 'publisher' }
        },
        _count: { id: true }
      });

      // Create a map for quick lookup
      const countByArtist = new Map(albumCounts.map(c => [c.artist, c._count.id]));

      // Apply counts to publishers
      for (const publisher of allPublisherFavorites) {
        if ((publisher as any).itemCount === undefined) {
          (publisher as any).itemCount = publisher.artist ? (countByArtist.get(publisher.artist) || 0) : 0;
        }
      }
    } else {
      // No artists to look up, just set 0
      for (const publisher of allPublisherFavorites) {
        if ((publisher as any).itemCount === undefined) {
          (publisher as any).itemCount = 0;
        }
      }
    }

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
 * Body: { feedId: string, nostrEventId?: string }
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
    const { feedId, nostrEventId, type } = body;
    // Validate type if provided, default to 'album'
    const favoriteType = ['album', 'publisher', 'playlist'].includes(type) ? type : 'album';

    if (!feedId || typeof feedId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'feedId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Verify feed exists (but allow publisher feeds and be lenient)
    const feed = await prisma.feed.findUnique({
      where: { id: feedId }
    });

    // If feed not found, check if it's a publisher feed (type === 'publisher')
    // Allow favoriting even if feed doesn't exist - favorites are user preferences
    // and don't necessarily require the feed to be in the database
    if (!feed) {
      // Try to find by checking if it's a publisher feed
      const publisherFeed = await prisma.feed.findFirst({
        where: {
          id: feedId,
          type: 'publisher'
        }
      });

      // If it's not a publisher feed either, still allow favoriting
      // (user might be favoriting something that hasn't been indexed yet)
      // We'll just skip the feed validation and proceed
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
      // If it exists and we have a nostrEventId, update it
      if (nostrEventId && !existing.nostrEventId) {
        const updated = await prisma.favoriteAlbum.update({
          where: { id: existing.id },
          data: { nostrEventId, nip51Format: true }
        });
        return NextResponse.json({
          success: true,
          data: updated,
          message: 'Album already in favorites, updated with Nostr event ID'
        });
      }
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
        feedId,
        type: favoriteType,
        ...(nostrEventId ? { nostrEventId, nip51Format: true } : {})
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

/**
 * DELETE /api/favorites/albums
 * Remove an album from favorites (using body instead of path param for URL feedIds)
 * Body: { feedId: string }
 */
export async function DELETE(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const feedId = body.feedId;

    if (!feedId || typeof feedId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'feedId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Build where clause - support both session and user
    const where: any = { feedId };
    if (userId) {
      where.userId = userId;
    } else if (sessionId) {
      where.sessionId = sessionId;
    }

    // Get the favorite first to retrieve nostrEventId before deleting
    const favorite = await prisma.favoriteAlbum.findFirst({
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
    await prisma.favoriteAlbum.deleteMany({
      where
    });

    return NextResponse.json({
      success: true,
      message: 'Album removed from favorites',
      nostrEventId: favorite.nostrEventId || null
    });
  } catch (error) {
    console.error('Error removing album from favorites:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove album from favorites',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/favorites/albums
 * Update a favorite album (e.g., add nostrEventId)
 * Body: { feedId: string, nostrEventId?: string }
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
    const { feedId, nostrEventId } = body;

    if (!feedId || typeof feedId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'feedId is required and must be a string'
        },
        { status: 400 }
      );
    }

    // Find the existing favorite
    const where: any = { feedId };
    if (userId) {
      where.userId = userId;
    } else if (sessionId) {
      where.sessionId = sessionId;
    }

    const existing = await prisma.favoriteAlbum.findFirst({
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
    const updated = await prisma.favoriteAlbum.update({
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
    console.error('Error updating favorite album:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update favorite album',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
