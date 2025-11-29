import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

export async function GET() {
  try {
    console.log('🔍 Publishers API: Loading publishers from database');

    // Get all publisher feeds with album counts using the publisherId relationship
    const publishers = await prisma.feed.findMany({
      where: {
        type: 'publisher',
        status: 'active'
      },
      select: {
        id: true,
        title: true,
        artist: true,
        description: true,
        image: true,
        originalUrl: true,
        albums: {
          where: {
            status: 'active',
            Track: {
              some: {} // Only count albums that have tracks
            }
          },
          select: {
            id: true,
            _count: {
              select: { Track: true }
            }
          }
        }
      },
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`📊 Found ${publishers.length} publishers in database`);

    // Transform to the expected format
    const publisherList = publishers.map(publisher => {
      const albumCount = publisher.albums.length;
      const trackCount = publisher.albums.reduce((sum, album) => sum + album._count.Track, 0);

      return {
        id: publisher.id,
        title: publisher.title || 'Unknown Publisher',
        feedGuid: publisher.id,
        originalUrl: publisher.originalUrl,
        image: publisher.image || '/placeholder-artist.png',
        description: publisher.description || `Publisher with ${albumCount} releases`,
        albums: [],
        itemCount: albumCount,
        totalTracks: trackCount,
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(publisher.title || publisher.id)}`
      };
    });

    console.log(`✅ Publishers API: Returning ${publisherList.length} publishers from database`);

    const response = {
      publishers: publisherList,
      total: publisherList.length,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'ETag': `"${Date.now()}"`,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
    });
  } catch (error) {
    console.error('Unexpected error in publishers API:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
