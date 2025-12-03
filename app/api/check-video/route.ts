import { NextRequest, NextResponse } from 'next/server';
import { FeedCache } from '@/lib/feed-cache';

/**
 * Check if a GIF has video conversions available
 * Used by CDNImage component to determine if video should be used instead of GIF
 */
export async function GET(request: NextRequest) {
  try {
    const gifUrl = request.nextUrl.searchParams.get('gif');

    if (!gifUrl) {
      return NextResponse.json(
        { error: 'Missing gif parameter' },
        { status: 400 }
      );
    }

    // Check if this GIF has video conversions in the cache
    const videoFormats = await FeedCache.getVideoForGif(gifUrl);

    if (videoFormats) {
      return NextResponse.json({
        hasVideo: true,
        mp4: videoFormats.mp4,
        webm: videoFormats.webm,
      });
    }

    return NextResponse.json({
      hasVideo: false,
    });
  } catch (error) {
    console.error('Error checking video for GIF:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
