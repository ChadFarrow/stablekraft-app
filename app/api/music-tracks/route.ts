import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { V4VResolver } from '@/lib/v4v-resolver';
// Removed: enhanced-music-service (migrated to Prisma)
import { logger } from '@/lib/logger';

// In-memory cache for server-side caching
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

function getCacheKey(feedUrl: string, resolveV4V: boolean): string {
  return `${feedUrl}:${resolveV4V}`;
}

function isCacheValid(key: string): boolean {
  const cached = cache.get(key);
  if (!cached) return false;
  
  const now = Date.now();
  return (now - cached.timestamp) < cached.ttl;
}

function setCache(key: string, data: any, ttl: number = CACHE_TTL): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
}

async function saveTracksToDatabase(tracks: any[], feedUrl: string): Promise<void> {
  try {
    const { prisma } = await import('@/lib/prisma');
    
    // Find or create feed
    let feed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });
    
    if (!feed) {
      feed = await prisma.feed.create({
        data: {
          id: `feed-${Date.now()}`,
          title: 'Extracted Feed',
          originalUrl: feedUrl,
          type: 'album',
          status: 'active',
          updatedAt: new Date()
        }
      });
    }
    
    // Save tracks to database
    for (const track of tracks) {
      try {
        await prisma.track.upsert({
          where: { 
            guid: track.guid || `${feed.id}-${track.title}-${track.artist}` 
          },
          create: {
            id: track.guid || `${feed.id}-${track.title}-${track.artist}`,
            guid: track.guid || `${feed.id}-${track.title}-${track.artist}`,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            audioUrl: track.audioUrl,
            image: track.image,
            publishedAt: track.publishedAt ? new Date(track.publishedAt) : new Date(),
            feedId: feed.id,
            updatedAt: new Date()
          },
          update: {
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration,
            audioUrl: track.audioUrl,
            image: track.image,
            updatedAt: new Date()
          }
        });
      } catch (trackError) {
        console.warn(`Failed to save track: ${track.title}`, trackError);
      }
    }
    
    logger.info(`💾 Successfully saved ${tracks.length} tracks to database for feed: ${feedUrl}`);
  } catch (error) {
    console.error('Failed to save tracks to database:', error);
  }
}

async function getUnifiedDatabaseTracks(limit: number, offset: number): Promise<any[]> {
  try {
    const { prisma } = await import('@/lib/prisma');
    
    const tracks = await prisma.track.findMany({
      skip: offset,
      take: limit,
      orderBy: { publishedAt: 'desc' },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            type: true,
            image: true
          }
        }
      }
    });
    
    return tracks.map(track => ({
      guid: track.guid,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      audioUrl: track.audioUrl,
      image: track.image,
      publishedAt: track.publishedAt?.toISOString(),
      feedInfo: track.Feed
    }));
  } catch (error) {
    console.error('Failed to load unified database tracks:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const feedUrl = searchParams.get('feedUrl');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const resolveV4V = searchParams.get('resolveV4V') === 'true';
    const forceRefresh = searchParams.get('forceRefresh') === 'true';
    const saveToDatabase = searchParams.get('saveToDatabase') !== 'false'; // Default to true
    const clearV4VCache = searchParams.get('clearV4VCache') === 'true';
    
    if (!feedUrl) {
      return NextResponse.json(
        { error: 'feedUrl parameter is required' },
        { status: 400 }
      );
    }
    
    // Handle database query (local feedUrl means query database)
    if (feedUrl === 'local://database') {
      logger.info('🎵 Loading tracks from Prisma database');
      
      const databaseTracks = await getUnifiedDatabaseTracks(limit, offset);
      
      return NextResponse.json({
        success: true,
        data: {
          tracks: databaseTracks,
          relatedFeeds: [],
          metadata: {
            totalTracks: databaseTracks.length,
            returnedTracks: databaseTracks.length,
            offset,
            limit,
            source: 'unified-database',
            lastUpdated: new Date().toISOString()
          }
        },
        message: `Successfully loaded ${databaseTracks.length} tracks from database`
      });
    }
    
    // Validate URL for external feeds
    try {
      new URL(feedUrl);
    } catch {
      return NextResponse.json(
        { error: 'Invalid feed URL provided' },
        { status: 400 }
      );
    }
    
    // Check cache first (unless force refresh is requested)
    const cacheKey = getCacheKey(feedUrl, resolveV4V);
    if (!forceRefresh && isCacheValid(cacheKey)) {
      logger.info(`🎵 Serving cached data for: ${feedUrl}`);
      const cachedData = cache.get(cacheKey)!.data;
      
      // Apply pagination to cached data
      const allTracks = cachedData.data.tracks;
      const paginatedTracks = allTracks.slice(offset, offset + limit);
      
      return NextResponse.json({
        ...cachedData,
        data: {
          ...cachedData.data,
          tracks: paginatedTracks,
          metadata: {
            ...cachedData.data.metadata,
            returnedTracks: paginatedTracks.length,
            offset,
            limit,
            cached: true
          }
        },
        message: `Served ${paginatedTracks.length} tracks from cache (${offset + 1}-${offset + paginatedTracks.length} of ${allTracks.length})`
      });
    }
    
    logger.info(`🎵 Extracting music tracks from: ${feedUrl} (cache miss)`);
    
    // Check if enhanced parsing is requested
    const useEnhanced = searchParams.get('useEnhanced') === 'true';
    
    let result;
    if (useEnhanced) {
      logger.info('🚀 Using enhanced RSS parser with Podcast Index integration...');
      try {
        // Import enhanced RSS parser
        const { enhancedRSSParser } = await import('@/lib/enhanced-rss-parser');
        
        // Parse with enhanced capabilities
        const enhancedResult = await enhancedRSSParser.parseAlbumFeed(feedUrl, {
          useEnhanced: true,
          includePodcastIndex: true,
          resolveRemoteItems: true,
          extractValueForValue: true
        });
        
        // Convert to compatible format if needed
        result = enhancedResult;
      } catch (enhancedError) {
        console.warn('Enhanced parsing failed, falling back to legacy parser:', enhancedError);
        result = await MusicTrackParser.extractMusicTracks(feedUrl);
      }
    } else {
      // Use legacy parser
      result = await MusicTrackParser.extractMusicTracks(feedUrl);
    }
    
    // Check if we should resolve V4V tracks
    if (resolveV4V && result?.tracks) {
      logger.info('🔍 Resolving V4V tracks...');

      // Clear V4V cache if requested
      if (clearV4VCache) {
        logger.info('🗑️ Clearing V4V resolver cache...');
        V4VResolver.clearCache();
      }
      
      // Find all V4V tracks that need resolution (or force re-resolve if cache was cleared)
      const v4vTracks = result.tracks.filter((track: any) => {
        const hasV4V = track.valueForValue?.feedGuid && track.valueForValue?.itemGuid;
        const isResolved = track.valueForValue?.resolved;
        return hasV4V && (!isResolved || clearV4VCache);
      });
      
      if (v4vTracks.length > 0) {
        logger.info(`📡 Resolving ${v4vTracks.length} V4V tracks${clearV4VCache ? ' (forced re-resolution)' : ''}...`);
        
        // Resolve in batch
        const tracksToResolve = v4vTracks.map((track: any) => ({
          feedGuid: track.valueForValue.feedGuid,
          itemGuid: track.valueForValue.itemGuid
        }));
        
        const resolutionResults = await V4VResolver.resolveBatch(tracksToResolve);
        
        // Apply resolved data to tracks
        let resolvedCount = 0;
        result.tracks.forEach((track: any) => {
          if (track.valueForValue?.feedGuid && track.valueForValue?.itemGuid) {
            const key = `${track.valueForValue.feedGuid}:${track.valueForValue.itemGuid}`;
            const resolution = resolutionResults.get(key);
            
            if (resolution?.success) {
              track.valueForValue.resolvedTitle = resolution.title;
              track.valueForValue.resolvedArtist = resolution.artist;
              track.valueForValue.resolvedImage = resolution.image;
              track.valueForValue.resolvedAudioUrl = resolution.audioUrl;
              track.valueForValue.resolvedDuration = resolution.duration;
              track.valueForValue.resolved = true;
              track.valueForValue.lastResolved = new Date().toISOString();
              resolvedCount++;
            }
          }
        });
        
        logger.info(`✅ Successfully resolved ${resolvedCount} V4V tracks`);
      }
    }
    
    // Save tracks to local database for persistence
    if (saveToDatabase && result?.tracks) {
      await saveTracksToDatabase(result.tracks, feedUrl);
    }
    
    // Apply pagination
    const allTracks = result?.tracks || [];
    const paginatedTracks = allTracks.slice(offset, offset + limit);
    
    // Prepare response data with enhanced metadata
    const existingMetadata = (result && 'metadata' in result ? result.metadata : {}) as Record<string, any>;
    const responseData = {
      success: true,
      data: {
        ...(result || {}),
        tracks: paginatedTracks,
        metadata: {
          ...existingMetadata,
          returnedTracks: paginatedTracks.length,
          offset,
          limit,
          totalTracks: allTracks.length,
          parser: useEnhanced ? 'enhanced-rss-parser' : 'legacy-parser',
          enhanced: useEnhanced,
          lastUpdated: new Date().toISOString()
        }
      },
      message: `Successfully extracted ${paginatedTracks.length} music tracks (${offset + 1}-${offset + paginatedTracks.length} of ${allTracks.length}) using ${useEnhanced ? 'enhanced' : 'legacy'} parser`
    };
    
    // Cache the result
    setCache(cacheKey, responseData);
    
    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('Music track extraction failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to extract music tracks',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { feedUrls } = body;
    
    if (!feedUrls || !Array.isArray(feedUrls)) {
      return NextResponse.json(
        { error: 'feedUrls array is required' },
        { status: 400 }
      );
    }
    
    const results = [];
    
    for (const feedUrl of feedUrls) {
      try {
        const result = await MusicTrackParser.extractMusicTracks(feedUrl);
        results.push({
          feedUrl,
          success: true,
          ...result
        });
      } catch (error) {
        results.push({
          feedUrl,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('Batch music track extraction failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to process batch request',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}