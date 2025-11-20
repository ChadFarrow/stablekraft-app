import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Feed, Track } from '@prisma/client';

interface FeedWithTracks extends Feed {
  Track: Track[];
  _count: {
    Track: number;
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

// Separate cache for playlist data to avoid re-fetching playlists every time
let playlistCache: any[] | null = null;
let playlistCacheTimestamp = 0;
const PLAYLIST_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache for playlists

// Function to get playlist albums
async function getPlaylistAlbums() {
  try {
    const now = Date.now();
    
    // Check if we have cached playlist data and it's still fresh
    if (playlistCache && (now - playlistCacheTimestamp) < PLAYLIST_CACHE_DURATION) {
      if (process.env.NODE_ENV === 'development') {
        console.log('⚡ Using cached playlist data');
      }
      return playlistCache;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Fetching playlist data in parallel...');
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
    const playlists = [
      'upbeats', 'b4ts', 'hgh', 'itdv', 'iam',
      'flowgnar', 'mmm', 'mmt', 'sas'
    ];

    // Fetch all playlists in parallel for better performance
    const results = await Promise.allSettled(
      playlists.map(async (playlist) => {
        const response = await fetch(`${baseUrl}/api/playlist/${playlist}`, {
          next: { revalidate: 300 } // Cache for 5 minutes
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${playlist}`);
        }

        const data = await response.json();
        if (data.success && data.albums && data.albums.length > 0) {
          return data.albums[0];
        }
        return null;
      })
    );

    // Extract successful results
    const playlistAlbums = results
      .filter((result) => result.status === 'fulfilled' && result.value !== null)
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    
    // Cache the results
    playlistCache = playlistAlbums;
    playlistCacheTimestamp = now;
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Cached ${playlistAlbums.length} playlists for fast access`);
    }
    return playlistAlbums;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching playlist albums:', error);
    }
    return playlistCache || []; // Return cached data if available, empty array otherwise
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const filter = searchParams.get('filter') || 'all'; // albums, eps, singles, all

    // Redirect publisher filter requests to the publishers API
    if (filter === 'publishers') {
      if (process.env.NODE_ENV === 'development') {
        console.log(`🚫 albums-fast: Rejecting ${filter} filter - should use /api/publishers instead`);
      }
      return NextResponse.json({
        albums: [],
        totalCount: 0,
        hasMore: false,
        offset: 0,
        limit: 0,
        publisherStats: [],
        lastUpdated: new Date().toISOString(),
        message: `Use /api/publishers for ${filter} data`
      });
    }
    
    const now = Date.now();
    const shouldRefreshCache = !cachedData || (now - cacheTimestamp) > CACHE_DURATION;
    
    let feeds: FeedWithTracks[];
    let publisherStats: Array<{ name: string; albumCount: number }>;
    let totalFeedCount = 0; // Will be set below for use in totalCount calculation
    let shouldPaginate = false; // Will be set below
    
    if (shouldRefreshCache) {
      if (process.env.NODE_ENV === 'development') {
        console.log('🔄 Fetching albums from database...');
      }
      
      // Load all feeds to maintain global sort order
      // Even for 'all' filter, we need all feeds to ensure correct sorting
      // (Albums → EPs → Singles, then alphabetically within each format)
      // Exclude sidebar-only items from main site display
      totalFeedCount = await prisma.feed.count({
        where: {
          status: 'active'
          // Note: 'sidebar-only' status feeds are excluded from main site
        }
      });
      
      // Always load all feeds to maintain global sort order
      // Pagination happens after sorting, not at the database level
      shouldPaginate = false; // Disable DB-level pagination to maintain sort order
      const feedsToLoad = totalFeedCount; // Load all feeds
      
      // Get active feeds with their tracks directly from database
      // Exclude sidebar-only items from main site display
      // Add timeout protection and limit to prevent hanging
      const maxFeedsToLoad = Math.min(feedsToLoad, 500); // Limit to 500 feeds max to prevent timeout
      
      try {
        feeds = await Promise.race([
          prisma.feed.findMany({
            where: { status: 'active' },
            skip: 0,
            take: maxFeedsToLoad,
            include: {
              Track: {
                where: {
                  audioUrl: { not: '' }
                },
                orderBy: [
                  { trackOrder: 'asc' },
                  { publishedAt: 'asc' },
                  { createdAt: 'asc' }
                ],
                take: 50 // Limit tracks per feed for performance
              },
              _count: {
                select: { Track: true }
              }
            },
            orderBy: [
              { priority: 'asc' },
              { createdAt: 'desc' }
            ]
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Database query timeout after 30s')), 30000)
          )
        ]) as FeedWithTracks[];
      } catch (queryError) {
        console.error('❌ Database query error:', queryError);
        // Return cached data if available, or empty result
        if (cachedData && cachedData.feeds.length > 0) {
          console.log('⚠️ Using cached data due to query error');
          feeds = cachedData.feeds;
          publisherStats = cachedData.publisherStats;
        } else {
          throw new Error(`Failed to load feeds: ${queryError instanceof Error ? queryError.message : 'Unknown error'}`);
        }
      }
      
      // Load publisher stats from the pre-built publisher data file
      // This contains actual publisher feeds (podcast:publisher references) not individual albums
      try {
        const fs = require('fs');
        const path = require('path');
        const publisherDataPath = path.join(process.cwd(), 'public', 'publisher-stats.json');
        
        if (fs.existsSync(publisherDataPath)) {
          const publisherData = JSON.parse(fs.readFileSync(publisherDataPath, 'utf8'));
          publisherStats = publisherData.publishers || [];
          if (process.env.NODE_ENV === 'development') {
            console.log(`📊 Loaded ${publisherStats.length} publisher feeds from publisher-stats.json`);
          }
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.log('⚠️ No publisher-stats.json found, using empty publisher stats');
          }
          publisherStats = [];
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('❌ Error loading publisher stats:', error);
        }
        publisherStats = [];
      }
      
      // Cache the results only for 'all' filter with no pagination (first page)
      // This provides fast cache hits for common initial load
      const shouldCache = filter === 'all' && offset === 0 && limit >= 50;
      if (shouldCache) {
        cachedData = { feeds, publisherStats };
        cacheTimestamp = now;
        if (process.env.NODE_ENV === 'development') {
          console.log(`✅ Loaded and cached ${feeds.length} albums from database`);
        }
      } else {
        // Don't cache filtered or paginated results
        if (process.env.NODE_ENV === 'development') {
          console.log(`✅ Loaded ${feeds.length} albums from database (${filter !== 'all' ? 'filtered' : 'paginated'}, not cached)`);
        }
      }
    } else {
      // Use cached data, but still need total count for pagination
      // Exclude sidebar-only items from main site display
      totalFeedCount = await prisma.feed.count({
        where: { status: 'active' }
      });
      
      // Use cached data - cache contains all feeds, so we can slice after sorting
      if (process.env.NODE_ENV === 'development') {
        console.log(`⚡ Using cached database results (${cachedData!.feeds.length} feeds)`);
      }
      feeds = cachedData!.feeds; // Cache contains all feeds, sorted correctly
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
      feedUrl: feed.originalUrl, // For Helipad TLV
      feedGuid: feed.id,
      feedId: feed.id, // For Helipad TLV
      remoteFeedGuid: feed.id, // For Helipad TLV
      guid: feed.Track?.[0]?.guid || feed.id, // Episode GUID for Helipad TLV
      episodeGuid: feed.Track?.[0]?.guid || feed.id, // Alternative field name
      link: feed.originalUrl, // For feedUrl fallback
      priority: feed.priority,
      tracks: feed.Track
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
          guid: track.guid,
          // Include V4V fields for Lightning payments
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          startTime: track.startTime,
          endTime: track.endTime
        })),
      // Include V4V payment data from feed (preferred) or first track (fallback)
      v4vRecipient: feed.v4vRecipient || feed.Track?.[0]?.v4vRecipient || null,
      v4vValue: feed.v4vValue || feed.Track?.[0]?.v4vValue || null
    }));
    
    // Filter out Bowl After Bowl main podcast content but keep music covers
    const podcastFilteredAlbums = albums.filter(album => {
      const albumTitle = album.title?.toLowerCase() || '';
      const albumArtist = album.artist?.toLowerCase() || '';
      const feedUrl = album.feedUrl?.toLowerCase() || '';
      
      // Keep Bowl Covers - these are legitimate music content
      if (album.id === 'bowl-covers' || albumTitle.includes('bowl covers')) {
        return true;
      }
      
      // Filter out main Bowl After Bowl podcast episodes
      const isBowlAfterBowlPodcast = (
        (albumTitle.includes('bowl after bowl') && !albumTitle.includes('covers')) ||
        (albumArtist.includes('bowl after bowl') && !albumTitle.includes('covers')) ||
        (feedUrl.includes('bowlafterbowl.com') && !albumTitle.includes('covers') && album.id !== 'bowl-covers')
      );
      
      if (isBowlAfterBowlPodcast && process.env.NODE_ENV === 'development') {
        console.log(`🚫 Filtering out Bowl After Bowl podcast: ${album.title} by ${album.artist}`);
      }
      
      return !isBowlAfterBowlPodcast;
    });
    
    // Apply filtering
    let filteredAlbums = podcastFilteredAlbums;
    if (filter !== 'all') {
      switch (filter) {
        case 'albums':
          filteredAlbums = podcastFilteredAlbums.filter(album => 
            album.tracks && album.tracks.length >= 8
          );
          break;
        case 'eps':
          filteredAlbums = podcastFilteredAlbums.filter(album => 
            album.tracks && album.tracks.length >= 2 && album.tracks.length < 8
          );
          break;
        case 'singles':
          filteredAlbums = podcastFilteredAlbums.filter(album => 
            album.tracks && album.tracks.length === 1
          );
          break;
        case 'playlist':
          // Start with empty array for playlist filter - playlists will be added after this
          filteredAlbums = [];
          break;
      }
    }
    
    // Sort albums by format (Albums → EPs → Singles) then alphabetically by title
    filteredAlbums.sort((a, b) => {
      // Get the original feed to check total track count (not just tracks with audio)
      const aFeed = feeds.find(f => f.id === a.id);
      const bFeed = feeds.find(f => f.id === b.id);
      
      const getTotalTrackCount = (feed: any) => feed?._count?.Track || 0;
      
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
      
      // Then sort alphabetically by title within each format (case-insensitive)
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
    
    // Add playlist albums only when specifically requesting playlists
    if (filter === 'playlist') {
      const playlistAlbums = await getPlaylistAlbums();
      if (playlistAlbums.length > 0) {
        filteredAlbums.push(...playlistAlbums);
      }
    }
    
    // Get accurate total count of filtered results
    // Since we always load all feeds, filteredAlbums.length is the accurate total count
    let totalCount = filteredAlbums.length;
    
    // Apply final pagination to filtered results
    const paginatedAlbums = filteredAlbums.slice(offset, offset + limit);
    
    return NextResponse.json({
      success: true,
      albums: paginatedAlbums,
      totalCount, // Total count of filtered results (for pagination)
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
    // Always log errors, even in production
    console.error('❌ Albums Fast API Error:', error);
    return NextResponse.json({
      error: 'Failed to load albums',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}