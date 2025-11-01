import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const limit = parseInt(searchParams.get('limit') || '20');
    
    // Build Prisma where clause
    const where: any = {};
    
    // Note: source is not in Track schema, so we can't filter by it directly
    // We could filter by Feed.type if needed
    
    // Query tracks from Prisma
    const tracks = await prisma.track.findMany({
      where,
      take: limit,
      orderBy: { publishedAt: 'desc' },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            type: true,
            originalUrl: true
          }
        }
      }
    });
    
    // Transform to match expected format
    let transformedTracks = tracks.map(track => ({
      id: track.id,
      title: track.title,
      artist: track.artist || track.Feed.artist || null,
      album: track.album || null,
      audioUrl: track.audioUrl,
      duration: track.duration || null,
      startTime: track.startTime || null,
      endTime: track.endTime || null,
      image: track.image || track.itunesImage || null,
      description: track.description || track.itunesSummary || null,
      feedUrl: track.Feed.originalUrl || null,
      feedId: track.feedId,
      valueForValue: track.v4vValue || null,
      publishedAt: track.publishedAt || null,
      guid: track.guid || null,
      source: track.Feed.type || 'album' // Derive source from Feed.type
    }));
    
    // Filter by source if specified (using Feed.type)
    if (source) {
      transformedTracks = transformedTracks.filter((track: any) => track.source === source);
    }
    
    return NextResponse.json({
      success: true,
      tracks: transformedTracks,
      total: transformedTracks.length,
      source: source,
      limit: limit
    });
    
  } catch (error) {
    console.error('Error reading raw tracks:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
} 