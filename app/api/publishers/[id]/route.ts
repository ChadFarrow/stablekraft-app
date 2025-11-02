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
    
    // First, try to find the publisher feed itself
    const publisherFeeds = await prisma.feed.findMany({
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
        originalUrl: true
      }
    });
    
    // Try to match publisher feed by slug
    const searchId = publisherId.toLowerCase();
    let publisherFeed: {
      id: string;
      title: string;
      artist: string | null;
      description: string | null;
      image: string | null;
      originalUrl: string;
    } | null | undefined = null;
    
    // Try matching by title or artist slug
    publisherFeed = publisherFeeds.find((feed) => {
      // Try matching by title slug
      if (feed.title) {
        const titleToSlug = feed.title.toLowerCase().replace(/\s+/g, '-');
        if (titleToSlug === searchId) return true;
      }
      // Try matching by artist slug
      if (feed.artist) {
        const artistToSlug = feed.artist.toLowerCase().replace(/\s+/g, '-');
        if (artistToSlug === searchId) return true;
      }
      return false;
    });
    
    // If publisher feed found, find albums by matching artist
    // Only match album/music feeds, not publisher feeds
    const matchingFeeds = feeds.filter(feed => {
      // Skip publisher feeds - we only want albums/music feeds
      if (feed.type === 'publisher') {
        return false;
      }
      
      // If we found a publisher feed, match by artist
      if (publisherFeed) {
        const publisherArtist = (publisherFeed.artist || publisherFeed.title)?.toLowerCase();
        const feedArtist = feed.artist?.toLowerCase();
        if (publisherArtist && feedArtist && publisherArtist === feedArtist) {
          return true;
        }
      }
      
      // Fallback: match by artist slug or name directly
      const feedSlug = generateAlbumSlug(feed.artist || feed.title);
      const feedId = feed.id.split('-')[0];
      
      // First priority: exact artist name or slug match
      if (feedSlug === publisherId || 
          feed.artist?.toLowerCase().replace(/\s+/g, '-') === publisherId ||
          feed.artist?.toLowerCase() === publisherId) {
        return true;
      }
      
      // Second priority: feed ID matches, but only if artist doesn't conflict
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
    
    console.log(`✅ Found ${matchingFeeds.length} album feeds for publisher: ${publisherId}`);
    
    if (matchingFeeds.length === 0 && !publisherFeed) {
      console.log(`❌ No albums found and no publisher feed found for: ${publisherId}`);
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
    
    // Create publisher info from the publisher feed (if found) or primary album feed
    const primaryFeed = publisherFeed || matchingFeeds[0];
    
    // If we only found album feeds but no publisher feed, create publisher info from the albums
    if (!publisherFeed && matchingFeeds.length > 0) {
      const firstAlbum = matchingFeeds[0];
      publisherFeed = {
        id: publisherId,
        title: firstAlbum.artist || firstAlbum.title || publisherId,
        artist: firstAlbum.artist || publisherId,
        description: `${matchingFeeds.length} releases`,
        image: firstAlbum.image || null,
        originalUrl: ''
      };
      console.log(`📝 Created publisher info from album feeds: ${publisherFeed.title}`);
    }
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
      title: primaryFeed?.artist || primaryFeed?.title || publisherId,
      originalUrl: primaryFeed?.originalUrl || '',
      parseStatus: 'success',
      lastParsed: new Date().toISOString(),
      publisherInfo: {
        name: primaryFeed?.artist || primaryFeed?.title || publisherId,
        title: primaryFeed?.title || primaryFeed?.artist || publisherId,
        artist: primaryFeed?.artist,
        feedGuid: primaryFeed?.id || '',
        feedUrl: primaryFeed?.originalUrl || '',
        image: primaryFeed?.image,
        description: primaryFeed?.description
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