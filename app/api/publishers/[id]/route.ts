import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const publisherId = decodeURIComponent(id);
    
    console.log(`🔍 Looking for publisher: ${publisherId}`);
    
    // Get all feeds from database
    const feeds = await prisma.feed.findMany({
      where: { status: 'active' },
      include: {
        Track: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { publishedAt: 'desc' },
            { createdAt: 'desc' }
          ]
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    console.log(`📊 Loaded ${feeds.length} feeds from database for publisher lookup`);
    
    // Find feeds that match the publisher ID by artist name or slug
    // Prioritize exact artist matches over ID matches to avoid confusion
    const matchingFeeds = feeds.filter(feed => {
      const feedSlug = generateAlbumSlug(feed.artist || feed.title);
      const feedId = feed.id.split('-')[0];
      
      // First priority: exact artist name or slug match
      if (feedSlug === publisherId || 
          feed.artist?.toLowerCase().replace(/\s+/g, '-') === publisherId ||
          feed.artist?.toLowerCase() === publisherId) {
        return true;
      }
      
      // Second priority: feed ID matches, but only if artist doesn't conflict
      // This prevents iroh-album-* feeds with Joe Martin content from matching "iroh"
      if (feedId === publisherId || feed.id.includes(publisherId)) {
        // If the publisher ID is "iroh", only match if the artist is actually "IROH"
        if (publisherId === 'iroh') {
          return feed.artist?.toLowerCase() === 'iroh';
        }
        return true;
      }
      
      return false;
    });
    
    if (matchingFeeds.length === 0) {
      console.log(`❌ Publisher not found: ${publisherId}`);
      return NextResponse.json({ 
        error: 'Publisher not found',
        publisherId,
        timestamp: new Date().toISOString()
      }, { 
        status: 404,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }
    
    console.log(`✅ Found ${matchingFeeds.length} feeds for publisher: ${publisherId}`);
    
    // Create publisher info from the feeds
    const primaryFeed = matchingFeeds[0];
    const totalTracks = matchingFeeds.reduce((sum, feed) => sum + feed.Track.length, 0);
    
    // Create album items from the feeds
    const publisherItems = matchingFeeds.map(feed => {
      const albumSlug = generateAlbumSlug(feed.title) + '-' + feed.id.split('-')[0];
      
      return {
        title: feed.title,
        artist: feed.artist || 'Unknown Artist',
        feedGuid: feed.id,
        feedUrl: feed.originalUrl,
        image: feed.image,
        description: feed.description,
        trackCount: feed.Track.length,
        albumSlug: albumSlug,
        releaseDate: feed.lastFetched || feed.createdAt,
        explicit: feed.explicit
      };
    });
    
    const response = {
      id: publisherId,
      title: primaryFeed.artist || primaryFeed.title,
      originalUrl: primaryFeed.originalUrl,
      parseStatus: 'success',
      lastParsed: new Date().toISOString(),
      publisherInfo: {
        title: primaryFeed.artist || primaryFeed.title,
        artist: primaryFeed.artist,
        feedGuid: primaryFeed.id,
        image: primaryFeed.image,
        description: primaryFeed.description
      },
      publisherItems: publisherItems,
      itemCount: publisherItems.length,
      totalTracks: totalTracks,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300', // Cache for 5 minutes
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
    });
  } catch (error) {
    console.error('Unexpected error in publisher API:', error);
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