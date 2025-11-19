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
            image: true
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
      valueForValue: track.v4vValue ? {
        lightningAddress: (track.v4vValue as any).lightningAddress || '',
        suggestedAmount: (track.v4vValue as any).suggestedAmount || 0,
        customKey: (track.v4vValue as any).customKey || '',
        customValue: (track.v4vValue as any).customValue || '',
        remotePercentage: (track.v4vValue as any).remotePercentage || 100,
        feedGuid: (track.v4vValue as any).feedGuid || null,
        itemGuid: (track.v4vValue as any).itemGuid || null
      } : null,
      discoveredAt: track.createdAt,
      lastUpdated: track.updatedAt
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
