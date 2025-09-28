import { NextRequest, NextResponse } from 'next/server';
import { musicTrackDB } from '@/lib/music-track-database';
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

    // Try to get track from database
    const track = await musicTrackDB.getMusicTrack(id);
    
    if (!track) {
      return NextResponse.json({ 
        success: false, 
        error: 'Track not found' 
      }, { status: 404 });
    }

    // Transform the track data to include proper value information
    const transformedTrack = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      episodeTitle: track.episodeTitle,
      episodeDate: track.episodeDate,
      startTime: track.startTime,
      endTime: track.endTime,
      duration: track.duration,
      audioUrl: track.audioUrl,
      image: track.image,
      description: track.description,
      source: track.source,
      feedUrl: track.feedUrl,
      feedId: track.feedId,
      valueForValue: track.valueForValue ? {
        lightningAddress: track.valueForValue.lightningAddress || '',
        suggestedAmount: track.valueForValue.suggestedAmount || 0,
        currency: track.valueForValue.currency || 'sats',
        customKey: track.valueForValue.customKey || '',
        customValue: track.valueForValue.customValue || '',
        recipientType: track.valueForValue.recipientType || 'remote',
        percentage: track.valueForValue.percentage || 100
      } : null,
      discoveredAt: track.discoveredAt,
      lastUpdated: track.lastUpdated,
      extractionMethod: track.extractionMethod
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
