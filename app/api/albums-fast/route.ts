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
      console.log('⚡ Using cached playlist data');
      return playlistCache;
    }
    
    console.log('🔄 Fetching playlist data...');
    const playlistAlbums = [];
    
    // Fetch HGH playlist
    const hghResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/playlist/hgh`);
    if (hghResponse.ok) {
      const hghData = await hghResponse.json();
      if (hghData.success && hghData.albums && hghData.albums.length > 0) {
        playlistAlbums.push(hghData.albums[0]);
      }
    }
    
    // Fetch ITDV playlist
    const itdvResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/playlist/itdv`);
    if (itdvResponse.ok) {
      const itdvData = await itdvResponse.json();
      if (itdvData.success && itdvData.albums && itdvData.albums.length > 0) {
        playlistAlbums.push(itdvData.albums[0]);
      }
    }
    
    // Fetch IAM playlist
    const iamResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/playlist/iam`);
    if (iamResponse.ok) {
      const iamData = await iamResponse.json();
      if (iamData.success && iamData.albums && iamData.albums.length > 0) {
        playlistAlbums.push(iamData.albums[0]);
      }
    }
    
    // Cache the results
    playlistCache = playlistAlbums;
    playlistCacheTimestamp = now;
    
    console.log(`✅ Cached ${playlistAlbums.length} playlists for fast access`);
    return playlistAlbums;
  } catch (error) {
    console.error('Error fetching playlist albums:', error);
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
    if (filter === 'publishers' || filter === 'artists') {
      console.log(`🚫 albums-fast: Rejecting ${filter} filter - should use /api/publishers instead`);
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
              { trackOrder: 'asc' },
              { publishedAt: 'asc' },
              { createdAt: 'asc' }
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
      
      // Load publisher stats from the pre-built publisher data file
      // This contains actual publisher feeds (podcast:publisher references) not individual albums
      try {
        const fs = require('fs');
        const path = require('path');
        const publisherDataPath = path.join(process.cwd(), 'public', 'publisher-stats.json');
        
        if (fs.existsSync(publisherDataPath)) {
          const publisherData = JSON.parse(fs.readFileSync(publisherDataPath, 'utf8'));
          publisherStats = publisherData.publishers || [];
          console.log(`📊 Loaded ${publisherStats.length} publisher feeds from publisher-stats.json`);
        } else {
          console.log('⚠️ No publisher-stats.json found, using empty publisher stats');
          publisherStats = [];
        }
      } catch (error) {
        console.error('❌ Error loading publisher stats:', error);
        publisherStats = [];
      }
      
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
      
      if (isBowlAfterBowlPodcast) {
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
    
    // Add playlist albums only when specifically requesting playlists
    if (filter === 'playlist') {
      const playlistAlbums = await getPlaylistAlbums();
      if (playlistAlbums.length > 0) {
        filteredAlbums.push(...playlistAlbums);
      }
    }
    
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