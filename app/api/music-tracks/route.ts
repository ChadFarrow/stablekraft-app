import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { V4VResolver } from '@/lib/v4v-resolver';
import { enhancedMusicService } from '@/lib/enhanced-music-service';
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
      logger.info(`📝 Created new feed: ${feed.id}`);
    }
    
    // Save tracks to Prisma
    let savedCount = 0;
    let skippedCount = 0;
    
    for (const track of tracks) {
      try {
        // Check if track already exists
        const existing = await prisma.track.findFirst({
          where: {
            feedId: feed.id,
            title: track.title,
            ...(track.startTime && { startTime: track.startTime }),
            ...(track.endTime && { endTime: track.endTime })
          }
        });
        
        if (!existing) {
          await prisma.track.create({
            data: {
              id: track.id || `track-${Date.now()}-${Math.random()}`,
              feedId: feed.id,
              title: track.title,
              artist: track.artist || null,
              album: track.album || null,
              audioUrl: track.audioUrl || track.url || '',
              startTime: track.startTime || null,
              endTime: track.endTime || null,
              duration: track.duration ? Math.round(track.duration) : null,
              image: track.image || null,
              description: track.description || null,
              guid: track.guid || track.episodeId || null,
              publishedAt: track.publishedAt || track.episodeDate ? new Date(track.episodeDate) : null,
              v4vValue: track.valueForValue || null
            }
          });
          savedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        logger.warn('Failed to save individual track', { track: track.title, error });
      }
    }
    
    logger.info(`💾 Saved ${savedCount} new tracks to Prisma database (${skippedCount} already existed)`);
  } catch (error) {
    logger.error('Failed to save tracks to database', error);
  }
}

async function loadTracksFromDatabase(feedUrl: string): Promise<any[] | null> {
  try {
    const { prisma } = await import('@/lib/prisma');
    
    // Find feed by URL
    const feed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });
    
    if (!feed) {
      return null;
    }
    
    // Load tracks from Prisma
    const tracks = await prisma.track.findMany({
      where: { feedId: feed.id },
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
    
    if (tracks.length > 0) {
      // Transform to match expected format
      const transformedTracks = tracks.map(track => ({
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
        guid: track.guid || null
      }));
      
      logger.info(`📖 Found ${transformedTracks.length} tracks in Prisma database for ${feedUrl}`);
      return transformedTracks;
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to load tracks from database', error);
    return null;
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
    
    // Handle database query (no feedUrl means query database)
    if (!feedUrl || feedUrl === 'local://database') {
      logger.info('🎵 Loading tracks from Prisma database');
      try {
        const { prisma } = await import('@/lib/prisma');
        
        // Build where clause for Prisma query
        const where: any = {};
        const enhancedOnly = searchParams.get('enhanced') === 'true';
        
        // Execute query with pagination
        const [tracks, total] = await Promise.all([
          prisma.track.findMany({
            where,
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
          }),
          prisma.track.count({ where })
        ]);
        
        // Transform to match expected format
        const transformedTracks = tracks.map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist || track.Feed.artist || null,
          album: track.album || null,
          audioUrl: track.audioUrl,
          duration: track.duration || null,
          startTime: track.startTime || null,
          endTime: track.endTime || null,
          image: track.image || track.itunesImage || track.Feed.image || null,
          description: track.description || track.itunesSummary || null,
          feedUrl: track.Feed.originalUrl || null,
          feedId: track.feedId,
          valueForValue: track.v4vValue || null,
          publishedAt: track.publishedAt || null,
          guid: track.guid || null
        }));
        
        return NextResponse.json({
          success: true,
          data: {
            tracks: transformedTracks,
            relatedFeeds: [],
            metadata: {
              totalTracks: total,
              returnedTracks: transformedTracks.length,
              offset,
              limit,
              source: 'prisma-database'
            }
          },
          message: `Successfully loaded ${transformedTracks.length} tracks from database (${offset + 1}-${offset + transformedTracks.length} of ${total})`
        });
      } catch (error) {
        logger.error('Failed to load tracks from Prisma database', error);
        return NextResponse.json(
          { error: 'Failed to load tracks from database' },
          { status: 500 }
        );
      }
    }
    
    // Handle feed extraction for actual feed URLs
    logger.info(`🎵 Extracting music tracks from: ${feedUrl}`);
        if (resolveV4V) {
          logger.info('🔍 Checking unified database tracks for V4V resolution...');

          // Clear V4V cache if requested
          if (clearV4VCache) {
            logger.info('🗑️ Clearing V4V resolver cache...');
            V4VResolver.clearCache();
          }
          
          // Find tracks that need V4V resolution (checking both legacy and enhanced formats)
          const v4vTracks = allTracks.filter((track: any) => {
            // Check legacy V4V format
            const legacyV4V = track.valueForValue?.feedGuid && track.valueForValue?.itemGuid && 
              (!track.valueForValue?.resolved || clearV4VCache);
            
            // Check enhanced V4V format
            const enhancedV4V = track.enhancedMetadata?.valueForValue?.enabled && 
              track.feedGuid && track.itemGuid?._; 
            
            return legacyV4V || enhancedV4V;
          });
          
          if (v4vTracks.length > 0) {
            logger.info(`📡 Resolving ${v4vTracks.length} V4V tracks from unified database${clearV4VCache ? ' (forced re-resolution)' : ''}...`);
            
            // Prepare batch resolution
            const tracksToResolve = v4vTracks.map((track: any) => ({
              feedGuid: track.valueForValue?.feedGuid || track.feedGuid,
              itemGuid: track.valueForValue?.itemGuid || track.itemGuid?._
            })).filter(item => item.feedGuid && item.itemGuid);
            
            if (tracksToResolve.length > 0) {
              // Resolve in batch
              const resolutionResults = await V4VResolver.resolveBatch(tracksToResolve);
              
              // Apply resolved data to tracks
              let resolvedCount = 0;
              allTracks.forEach((track: any) => {
                const feedGuid = track.valueForValue?.feedGuid || track.feedGuid;
                const itemGuid = track.valueForValue?.itemGuid || track.itemGuid?._;
                
                if (feedGuid && itemGuid) {
                  const key = `${feedGuid}:${itemGuid}`;
                  const resolution = resolutionResults.get(key);
                  
                  if (resolution?.success) {
                    // Update legacy V4V format if present
                    if (track.valueForValue) {
                      track.valueForValue.resolvedTitle = resolution.title;
                      track.valueForValue.resolvedArtist = resolution.artist;
                      track.valueForValue.resolvedImage = resolution.image;
                      track.valueForValue.resolvedAudioUrl = resolution.audioUrl;
                      track.valueForValue.resolvedDuration = resolution.duration;
                      track.valueForValue.resolved = true;
                      track.valueForValue.lastResolved = new Date().toISOString();
                    }
                    
                    // Update enhanced metadata if present
                    if (track.enhancedMetadata) {
                      track.enhancedMetadata.audioUrl = track.enhancedMetadata.audioUrl || resolution.audioUrl;
                      if (track.enhancedMetadata.valueForValue) {
                        track.enhancedMetadata.valueForValue.resolvedData = {
                          title: resolution.title,
                          artist: resolution.artist,
                          audioUrl: resolution.audioUrl,
                          duration: resolution.duration,
                          image: resolution.image
                        };
                      }
                    }
                    
                    resolvedCount++;
                  }
                }
              });
              
              logger.info(`✅ Successfully resolved ${resolvedCount} V4V tracks from unified database`);
            }
          }
        }
        
        // Apply pagination
        const paginatedTracks = allTracks.slice(offset, offset + limit);
        
        // Get enhanced database stats for metadata
        const databaseStats = await enhancedMusicService.getDatabaseStats();
        
        return NextResponse.json({
          success: true,
          data: {
            tracks: paginatedTracks,
            relatedFeeds: [],
            metadata: {
              totalTracks: allTracks.length,
              returnedTracks: paginatedTracks.length,
              offset,
              limit,
              source: 'unified-database',
              enhancementStats: {
                enhancedTracks: databaseStats.enhancedTracks,
                legacyTracks: databaseStats.legacyTracks,
                enhancementRate: databaseStats.enhancementRate,
                valueForValueTracks: databaseStats.valueForValueTracks,
                tracksWithAudio: databaseStats.tracksWithAudio
              },
              lastUpdated: new Date().toISOString()
            }
          },
          message: `Successfully loaded ${paginatedTracks.length} unified tracks from database (${offset + 1}-${offset + paginatedTracks.length} of ${allTracks.length})`
        });
      } catch (error) {
        console.error('Failed to load local database:', error);
        return NextResponse.json(
          { error: 'Failed to load local database' },
          { status: 500 }
        );
      }
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
    
    // Check if we have tracks in the local database first (unless force refresh is requested)
    let databaseTracks = null;
    if (!forceRefresh) {
      databaseTracks = await loadTracksFromDatabase(feedUrl);
    }
    
    if (databaseTracks && databaseTracks.length > 0) {
      logger.info(`📖 Serving ${databaseTracks.length} tracks from database`);
      
      // Handle V4V resolution for database tracks if requested
      if (resolveV4V) {
        logger.info('🔍 Checking database tracks for V4V resolution...');

        // Clear V4V cache if requested
        if (clearV4VCache) {
          logger.info('🗑️ Clearing V4V resolver cache...');
          V4VResolver.clearCache();
        }
        
        // Find tracks that need V4V resolution
        const v4vTracks = databaseTracks.filter((track: any) => 
          track.valueForValue?.feedGuid && 
          track.valueForValue?.itemGuid && 
          (!track.valueForValue?.resolved || clearV4VCache)
        );
        
        if (v4vTracks.length > 0) {
          logger.info(`📡 Resolving ${v4vTracks.length} V4V tracks from database${clearV4VCache ? ' (forced re-resolution)' : ''}...`);
          
          // Prepare batch resolution
          const tracksToResolve = v4vTracks.map((track: any) => ({
            feedGuid: track.valueForValue.feedGuid,
            itemGuid: track.valueForValue.itemGuid
          }));
          
          // Resolve in batch
          const resolutionResults = await V4VResolver.resolveBatch(tracksToResolve);
          
          // Apply resolved data to tracks
          let resolvedCount = 0;
          databaseTracks.forEach((track: any) => {
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
          
          // Save updated tracks back to database if any were resolved
          if (resolvedCount > 0 && saveToDatabase) {
            logger.info('💾 Saving updated V4V resolutions to Prisma database...');
            try {
              const { prisma } = await import('@/lib/prisma');
              
              // Update tracks in Prisma database
              for (const updatedTrack of databaseTracks) {
                if (updatedTrack.id && updatedTrack.valueForValue) {
                  await prisma.track.update({
                    where: { id: updatedTrack.id },
                    data: {
                      v4vValue: updatedTrack.valueForValue
                    }
                  });
                }
              }
              
              logger.info('✅ Prisma database updated with V4V resolutions');
            } catch (error) {
              logger.error('Failed to save V4V resolutions to database', error);
            }
          }
        }
      }
      
      // Apply pagination
      const paginatedTracks = databaseTracks.slice(offset, offset + limit);
      
      const result = {
        tracks: paginatedTracks,
        relatedFeeds: [],
        metadata: {
          totalTracks: databaseTracks.length,
          returnedTracks: paginatedTracks.length,
          offset,
          limit,
          source: 'database'
        }
      };
      
      // Cache the database result
      setCache(cacheKey, {
        success: true,
        data: result,
        message: `Successfully loaded ${paginatedTracks.length} tracks from database (${offset + 1}-${offset + paginatedTracks.length} of ${databaseTracks.length})`
      });
      
      return NextResponse.json({
        success: true,
        data: result,
        message: `Successfully loaded ${paginatedTracks.length} tracks from database (${offset + 1}-${offset + paginatedTracks.length} of ${databaseTracks.length})`
      });
    }
    
    // If no database tracks or force refresh requested, parse from RSS feed
    logger.info(`📡 ${forceRefresh ? 'Force refresh requested' : 'No database tracks found'}, parsing RSS feed...`);
    
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
        if (enhancedResult) {
          result = {
            tracks: enhancedResult.tracks || [],
            relatedFeeds: []
          };
          logger.info(`✅ Enhanced parsing extracted ${result.tracks.length} tracks`);
        } else {
          throw new Error('Enhanced parsing returned null');
        }
      } catch (enhancedError) {
        console.warn('Enhanced parsing failed, falling back to legacy parser:', enhancedError);
        result = await MusicTrackParser.extractMusicTracks(feedUrl);
      }
    } else {
      // Use legacy parser
      result = await MusicTrackParser.extractMusicTracks(feedUrl);
    }
    
    // Check if we should resolve V4V tracks
    if (resolveV4V) {
      logger.info('🔍 Resolving V4V tracks...');

      // Clear V4V cache if requested
      if (clearV4VCache) {
        logger.info('🗑️ Clearing V4V resolver cache...');
        V4VResolver.clearCache();
      }
      
      // Find all V4V tracks that need resolution (or force re-resolve if cache was cleared)
      const v4vTracks = result.tracks.filter(track => 
        'valueForValue' in track &&
        track.valueForValue?.feedGuid && 
        track.valueForValue?.itemGuid && 
        (!track.valueForValue?.resolved || clearV4VCache)
      );
      
      if (v4vTracks.length > 0) {
        logger.info(`📡 Resolving ${v4vTracks.length} V4V tracks${clearV4VCache ? ' (forced re-resolution)' : ''}...`);
        
        // Prepare batch resolution
        const tracksToResolve = v4vTracks.map(track => ({
          feedGuid: (track as any).valueForValue!.feedGuid!,
          itemGuid: (track as any).valueForValue!.itemGuid!
        }));
        
        // Resolve in batch
        const resolutionResults = await V4VResolver.resolveBatch(tracksToResolve);
        
        // Apply resolved data to tracks
        let resolvedCount = 0;
        result.tracks.forEach(track => {
          if ('valueForValue' in track && track.valueForValue?.feedGuid && track.valueForValue?.itemGuid) {
            const key = `${track.valueForValue.feedGuid}:${track.valueForValue.itemGuid}`;
            const resolution = resolutionResults.get(key);
            
            if (resolution?.success) {
              track.valueForValue.resolvedTitle = resolution.title;
              track.valueForValue.resolvedArtist = resolution.artist;
              track.valueForValue.resolvedImage = resolution.image;
              track.valueForValue.resolvedAudioUrl = resolution.audioUrl;
              track.valueForValue.resolvedDuration = resolution.duration;
              track.valueForValue.resolved = true;
              track.valueForValue.lastResolved = new Date();
              resolvedCount++;
            }
          }
        });
        
        logger.info(`✅ Successfully resolved ${resolvedCount} V4V tracks`);
      }
    }
    
    // Save tracks to local database for persistence
    if (saveToDatabase) {
      await saveTracksToDatabase(result.tracks, feedUrl);
    }
    
    // Prepare response data with enhanced metadata
    const existingMetadata = ('metadata' in result ? result.metadata : {}) as Record<string, any>;
    const responseData = {
      success: true,
      data: {
        ...result,
        metadata: {
          ...existingMetadata,
          parser: useEnhanced ? 'enhanced-rss-parser' : 'legacy-parser',
          enhanced: useEnhanced
        }
      },
      message: `Successfully extracted ${result.tracks.length} music tracks using ${useEnhanced ? 'enhanced' : 'legacy'} parser and found ${result.relatedFeeds.length} related feeds`
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
    
    if (feedUrls.length === 0) {
      return NextResponse.json(
        { error: 'At least one feed URL is required' },
        { status: 400 }
      );
    }
    
    logger.info(`🎵 Analyzing ${feedUrls.length} feeds for music tracks`);
    
    const results = [];
    const errors = [];
    
    // Process each feed
    for (const feedUrl of feedUrls) {
      try {
        const result = await MusicTrackParser.extractMusicTracks(feedUrl);
        results.push({
          feedUrl,
          success: true,
          data: result
        });
      } catch (error) {
        errors.push({
          feedUrl,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // Aggregate results
    const totalTracks = results.reduce((sum, r) => sum + r.data.tracks.length, 0);
    const totalRelatedFeeds = results.reduce((sum, r) => sum + r.data.relatedFeeds.length, 0);
    
    return NextResponse.json({
      success: true,
      summary: {
        totalFeeds: feedUrls.length,
        successfulFeeds: results.length,
        failedFeeds: errors.length,
        totalTracks,
        totalRelatedFeeds
      },
      results,
      errors
    });
    
  } catch (error) {
    console.error('Bulk music track extraction failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 