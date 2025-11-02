import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    console.log('🔍 Database Parsed Feeds API: Getting all feeds with metadata');
    
    // Get all feeds from database with their tracks (excluding test feeds)
    const feeds = await prisma.feed.findMany({
      where: {
        type: {
          notIn: ['test'] // Exclude test feeds from main parsed-feeds API
        }
      },
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
    
    console.log(`📊 Loaded ${feeds.length} feeds from database for parsed-feeds API`);
    
    // Transform database feeds to match the expected parsed-feeds format
    const transformedFeeds = feeds.map(feed => {
      const hasValidTracks = feed.Track.length > 0;
      const parseStatus = hasValidTracks ? 'success' : (feed.status === 'error' ? 'error' : 'pending');
      
      let parsedData: any = {};
      
      if (feed.type === 'publisher' && hasValidTracks) {
        // For publisher feeds, create publisherItems from tracks grouped by album
        const albumMap = new Map<string, any>();
        
        feed.Track.forEach(track => {
          const albumKey = track.album || track.title || 'Unknown Album';
          if (!albumMap.has(albumKey)) {
            albumMap.set(albumKey, {
              title: track.album || track.title,
              artist: track.artist || feed.artist || 'Unknown Artist',
              feedGuid: feed.id,
              feedUrl: feed.originalUrl,
              image: track.image || feed.image,
              description: track.description || feed.description,
              trackCount: 0,
              albumSlug: albumKey.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
              releaseDate: track.publishedAt || feed.lastFetched || feed.createdAt,
              explicit: track.explicit || false
            });
          }
          albumMap.get(albumKey)!.trackCount++;
        });
        
        parsedData = {
          publisherInfo: {
            title: feed.artist || feed.title,
            artist: feed.artist,
            feedGuid: feed.id,
            image: feed.image,
            description: feed.description
          },
          publisherItems: Array.from(albumMap.values()),
          itemCount: albumMap.size
        };
      } else if (feed.type === 'album' && hasValidTracks) {
        // For album feeds, create album data
        const tracks = feed.Track.map((track, index) => ({
          title: track.title,
          duration: track.duration ? 
            Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0') : 
            track.itunesDuration || '0:00',
          url: track.audioUrl,
          trackNumber: index + 1,
          subtitle: track.subtitle || '',
          summary: track.description || '',
          image: track.image || feed.image || '',
          explicit: track.explicit || false,
          keywords: track.itunesKeywords || []
        }));
        
        // Get publisher info from stored database fields (not parsed in real-time)
        let publisherInfo = null;
        if (feed.v4vValue && typeof feed.v4vValue === 'object' && 'publisher' in feed.v4vValue) {
          const pubData = (feed.v4vValue as any).publisher;
          if (pubData?.feedGuid && pubData?.feedUrl) {
            publisherInfo = {
              feedGuid: pubData.feedGuid,
              feedUrl: pubData.feedUrl,
              medium: pubData.medium || 'publisher'
            };
          }
        }
        
        parsedData = {
          album: {
            id: feed.id,
            title: feed.title,
            artist: feed.artist || 'Unknown Artist',
            description: feed.description || '',
            coverArt: feed.image || '',
            releaseDate: feed.lastFetched || feed.createdAt,
            explicit: tracks.some(t => t.explicit) || feed.explicit,
            tracks: tracks,
            feedId: feed.id,
            feedUrl: feed.originalUrl,
            ...(publisherInfo ? { publisher: publisherInfo } : {})
          }
        };
      }
      
      return {
        id: feed.id,
        originalUrl: feed.originalUrl,
        type: feed.type,
        parseStatus: parseStatus,
        lastParsed: feed.lastFetched || feed.updatedAt,
        parsedData: parsedData,
        metadata: {
          totalTracks: feed.Track.length,
          validTracks: feed.Track.filter(t => t.audioUrl && t.audioUrl !== '').length,
          lastFetched: feed.lastFetched,
          status: feed.status,
          priority: feed.priority,
          validationIssues: []
        }
      };
    });
    
    // Create the response data structure to match expected format
    const parsedFeedsData = {
      feeds: transformedFeeds,
      lastGenerated: new Date().toISOString(),
      validation: {
        timestamp: new Date().toISOString(),
        totalFeeds: transformedFeeds.length,
        successfulFeeds: transformedFeeds.filter((f: any) => f.parseStatus === 'success').length,
        publisherFeeds: transformedFeeds.filter((f: any) => f.type === 'publisher').length,
        albumFeeds: transformedFeeds.filter((f: any) => f.type === 'album').length,
        warningsCount: 0,
        warnings: []
      }
    };

    // Check query parameters for pagination
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '0');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    // Define the response data type to allow for optional pagination
    type ResponseData = typeof parsedFeedsData & {
      pagination?: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    };
    
    let responseData: ResponseData = parsedFeedsData;
    
    // Apply pagination if requested
    if (limit > 0) {
      const totalFeeds = parsedFeedsData.feeds.length;
      const paginatedFeeds = parsedFeedsData.feeds.slice(offset, offset + limit);
      
      responseData = {
        feeds: paginatedFeeds,
        lastGenerated: parsedFeedsData.lastGenerated,
        validation: parsedFeedsData.validation,
        pagination: {
          total: totalFeeds,
          limit,
          offset,
          hasMore: offset + limit < totalFeeds
        }
      };
    }

    console.log(`✅ Database Parsed Feeds API: Returning ${responseData.feeds.length} feeds`);

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
    });
  } catch (error) {
    console.error('Unexpected error in database parsed-feeds API:', error);
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