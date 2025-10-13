import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const publisherId = searchParams.get('id');
    
    if (!publisherId) {
      return NextResponse.json({ 
        error: 'Publisher ID is required',
        timestamp: new Date().toISOString()
      }, { status: 400 });
    }
    
    console.log(`🔍 Looking for publisher by ID: ${publisherId}`);
    
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
    
    // Find feeds that match the publisher ID by artist name or feed ID
    const matchingFeeds = feeds.filter(feed => {
      const feedSlug = generateAlbumSlug(feed.artist || feed.title);
      const feedId = feed.id.split('-')[0];
      
      return feedSlug === publisherId || 
             feed.artist?.toLowerCase().replace(/\s+/g, '-') === publisherId ||
             feedId === publisherId ||
             feed.id.includes(publisherId) ||
             feed.id === publisherId;
    });
    
    if (matchingFeeds.length === 0) {
      console.log(`❌ Publisher not found: ${publisherId}`);
      return NextResponse.json({ 
        error: 'Publisher not found',
        publisherId,
        timestamp: new Date().toISOString()
      }, { status: 404 });
    }
    
    console.log(`✅ Found ${matchingFeeds.length} feeds for publisher: ${publisherId}`);
    
    // Create publisher info from the feeds
    const primaryFeed = matchingFeeds[0];
    
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
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
    });
  } catch (error) {
    console.error('Unexpected error in publishers-by-id API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      }, 
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
  });
} 