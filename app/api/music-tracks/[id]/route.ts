import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createErrorLogger } from '@/lib/error-utils';

const logger = createErrorLogger('MusicTrackAPI');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
    
    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Track ID is required' 
      }, { status: 400 });
    }

    logger.info('Fetching track by ID', { trackId: id });

    // Get track from Prisma database
    const track = await prisma.track.findUnique({
      where: { id },
      include: {
        Feed: {
          select: {
            id: true,
            guid: true,
            title: true,
            artist: true,
            type: true,
            originalUrl: true,
            image: true,
            v4vValue: true,
            v4vRecipient: true,
            persons: true
          }
        }
      }
    });
    
    if (!track) {
      return NextResponse.json({ 
        success: false, 
        error: 'Track not found' 
      }, { status: 404 });
    }

    // Transform the track data to match expected format
    const transformedTrack = {
      id: track.id,
      title: track.title,
      artist: track.artist || track.Feed.artist || null,
      episodeTitle: track.subtitle || null,
      episodeDate: track.publishedAt || null,
      startTime: track.startTime || null,
      endTime: track.endTime || null,
      duration: track.duration || null,
      audioUrl: track.audioUrl,
      image: track.image || track.itunesImage || track.Feed.image || null,
      description: track.description || track.itunesSummary || null,
      source: track.Feed.type || 'album', // Derive source from Feed.type
      feedUrl: track.Feed.originalUrl || null,
      feedId: track.feedId,
      feedGuid: track.Feed.guid || null,
      guid: track.guid || null,
      v4vValue: track.v4vValue || track.Feed.v4vValue || null, // Include raw v4vValue for Lightning payments (fall back to feed-level)
      v4vRecipient: track.v4vRecipient || track.Feed.v4vRecipient || null,
      // <podcast:person> / <podcast:txt> npubs, track-level here and feed-level
      // on Feed below. BoostButton fetches this route for every track boost and
      // turns both into the note's `p` tags and @mentions, so a caller that has
      // no persons of its own still names the artist.
      persons: track.persons || undefined,
      valueForValue: (() => {
        const v4v = (track.v4vValue || track.Feed.v4vValue) as any;
        if (!v4v) return null;
        return {
          lightningAddress: v4v.lightningAddress || '',
          suggestedAmount: v4v.suggestedAmount || 0,
          customKey: v4v.customKey || '',
          customValue: v4v.customValue || '',
          remotePercentage: v4v.remotePercentage || 100,
          feedGuid: v4v.feedGuid || null,
          itemGuid: v4v.itemGuid || null
        };
      })(),
      discoveredAt: track.createdAt,
      lastUpdated: track.updatedAt,
      Feed: {
        id: track.Feed.id,
        title: track.Feed.title,
        artist: track.Feed.artist,
        image: track.Feed.image,
        guid: track.Feed.guid,
        persons: track.Feed.persons || undefined,
      }
    };

    logger.info('Successfully fetched track', { 
      trackId: id, 
      hasV4V: !!transformedTrack.valueForValue,
      v4vData: transformedTrack.valueForValue
    });

    return NextResponse.json({
      success: true,
      data: transformedTrack
    });

  } catch (error) {
    logger.error('Error fetching track', { 
      trackId: id, 
      error: (error as Error).message 
    });
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}
