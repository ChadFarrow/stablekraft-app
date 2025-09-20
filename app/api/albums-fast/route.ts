import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Feed, Track } from '@prisma/client';

interface FeedWithTracks extends Feed {
  tracks: Track[];
  _count: {
    tracks: number;
  };
}

interface CachedData {
  feeds: FeedWithTracks[];
  publisherStats: Array<{ name: string; albumCount: number }>;
}

// In-memory cache for better performance (cache the database results, not files)
let cachedData: CachedData | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes cache for database results

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const filter = searchParams.get('filter') || 'all'; // albums, eps, singles, all
    
    const now = Date.now();
    const shouldRefreshCache = !cachedData || (now - cacheTimestamp) > CACHE_DURATION;
    
    let feeds: FeedWithTracks[];
    let publisherStats: Array<{ name: string; albumCount: number }>;
    
    if (shouldRefreshCache) {
      console.log('🔄 Fetching albums from database...');
      
      // Get all active feeds with their tracks directly from database
      feeds = await prisma.feed.findMany({
        where: { status: 'active' },
        include: {
          tracks: {
            where: {
              audioUrl: { not: '' }
            },
            orderBy: [
              { publishedAt: 'desc' },
              { createdAt: 'desc' }
            ],
            take: 50 // Limit tracks per feed for performance
          },
          _count: {
            select: { tracks: true }
          }
        },
        orderBy: [
          { priority: 'asc' },
          { createdAt: 'desc' }
        ]
      });
      
      // Calculate publisher stats
      const publisherMap = new Map();
      feeds.forEach(feed => {
        const artist = feed.artist || feed.title;
        if (!publisherMap.has(artist)) {
          publisherMap.set(artist, 0);
        }
        publisherMap.set(artist, publisherMap.get(artist) + 1);
      });
      
      publisherStats = Array.from(publisherMap.entries())
        .map(([name, count]) => ({ name, albumCount: count }))
        .sort((a, b) => b.albumCount - a.albumCount);
      
      // Cache the results
      cachedData = { feeds, publisherStats };
      cacheTimestamp = now;
      
      console.log(`✅ Loaded ${feeds.length} albums from database`);
    } else {
      console.log(`⚡ Using cached database results (${cachedData!.feeds.length} albums)`);
      feeds = cachedData!.feeds;
      publisherStats = cachedData!.publisherStats;
    }
    
    // Transform feeds into album format for frontend
    const albums = feeds.map((feed: FeedWithTracks) => ({
      id: feed.id,
      title: feed.title,
      artist: feed.artist || feed.title,
      description: feed.description || '',
      coverArt: feed.image || '',
      releaseDate: feed.updatedAt || feed.createdAt,
      feedUrl: feed.originalUrl,
      feedGuid: feed.id,
      priority: feed.priority,
      tracks: feed.tracks
        .filter((track: Track, index: number, self: Track[]) => {
          // Deduplicate tracks by URL and title
          return self.findIndex((t: Track) => 
            t.audioUrl === track.audioUrl && t.title === track.title
          ) === index;
        })
        .map((track: Track) => ({
          id: track.id,
          title: track.title,
          duration: track.duration || 180,
          url: track.audioUrl,
          image: track.image,
          publishedAt: track.publishedAt,
          guid: track.guid
        }))
    }));
    
    // Apply filtering
    let filteredAlbums = albums;
    if (filter !== 'all') {
      switch (filter) {
        case 'albums':
          filteredAlbums = albums.filter(album => 
            album.tracks && album.tracks.length >= 8
          );
          break;
        case 'eps':
          filteredAlbums = albums.filter(album => 
            album.tracks && album.tracks.length >= 2 && album.tracks.length < 8
          );
          break;
        case 'singles':
          filteredAlbums = albums.filter(album => 
            album.tracks && album.tracks.length <= 2
          );
          break;
      }
    }
    
    // Sort albums by format (Albums → EPs → Singles) then alphabetically by title
    filteredAlbums.sort((a, b) => {
      // Get the original feed to check total track count (not just tracks with audio)
      const aFeed = feeds.find(f => f.id === a.id);
      const bFeed = feeds.find(f => f.id === b.id);
      
      const getTotalTrackCount = (feed: any) => feed?._count?.tracks || 0;
      
      // Determine format based on total track count
      const getFormatOrder = (trackCount: number) => {
        if (trackCount >= 6) return 1; // Albums first
        if (trackCount >= 2) return 2; // EPs second  
        return 3; // Singles last
      };
      
      const aFormatOrder = getFormatOrder(getTotalTrackCount(aFeed));
      const bFormatOrder = getFormatOrder(getTotalTrackCount(bFeed));
      
      // First sort by format
      if (aFormatOrder !== bFormatOrder) {
        return aFormatOrder - bFormatOrder;
      }
      
      // Then sort alphabetically by title within each format
      return a.title.localeCompare(b.title);
    });
    
    // Apply pagination
    const totalCount = filteredAlbums.length;
    const paginatedAlbums = filteredAlbums.slice(offset, offset + limit);
    
    return NextResponse.json({
      success: true,
      albums: paginatedAlbums,
      totalCount,
      publisherStats,
      metadata: {
        returnedAlbums: paginatedAlbums.length,
        totalAlbums: totalCount,
        offset,
        limit,
        filter,
        cached: !shouldRefreshCache,
        cacheAge: now - cacheTimestamp,
        source: 'database'
      }
    });
    
  } catch (error) {
    console.error('❌ Albums Fast API Error:', error);
    return NextResponse.json({
      error: 'Failed to load albums',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}