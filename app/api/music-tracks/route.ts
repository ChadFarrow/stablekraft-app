import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { V4VResolver } from '@/lib/v4v-resolver';
import { enhancedMusicService } from '@/lib/enhanced-music-service';
import { logger } from '@/lib/logger';
import { promises as fs } from 'fs';
import path from 'path';

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
    const dataPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const existingData = await fs.readFile(dataPath, 'utf8');
    const musicData = JSON.parse(existingData);
    
    // Check for existing tracks to avoid duplicates
    const existingTrackIds = new Set(musicData.musicTracks.map((t: any) => 
      `${t.episodeTitle}-${t.startTime}-${t.endTime}-${t.title}`
    ));
    
    // Filter out tracks that already exist
    const newTracks = tracks.filter(track => {
      const trackKey = `${track.episodeTitle}-${track.startTime}-${track.endTime}-${track.title}`;
      return !existingTrackIds.has(trackKey);
    });
    
    if (newTracks.length === 0) {
      logger.info('📝 No new tracks to save (all already exist in database)');
      return;
    }
    
    // Generate unique IDs for new tracks
    const tracksWithIds = newTracks.map(track => ({
      ...track,
      id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      feedUrl,
      extractionMethod: 'api-extraction',
      discoveredAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    }));
    
    // Add new tracks to existing data
    musicData.musicTracks.push(...tracksWithIds);
    
    // Update metadata
    musicData.metadata.totalTracks = musicData.musicTracks.length;
    musicData.metadata.lastUpdated = new Date().toISOString();
    musicData.metadata.totalExtractions = (musicData.metadata.totalExtractions || 0) + 1;
    
    // Save back to file
    await fs.writeFile(dataPath, JSON.stringify(musicData, null, 2));
    
    logger.info(`💾 Saved ${tracksWithIds.length} new tracks to database (${tracks.length - tracksWithIds.length} already existed)`);
  } catch (error) {
    console.error('Failed to save tracks to database:', error);
  }
}

async function loadTracksFromDatabase(feedUrl: string): Promise<any[] | null> {
  try {
    const dataPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const existingData = await fs.readFile(dataPath, 'utf8');
    const musicData = JSON.parse(existingData);
    
    // Filter tracks by feed URL
    const tracks = musicData.musicTracks.filter((track: any) => track.feedUrl === feedUrl);
    
    if (tracks.length > 0) {
      logger.info(`📖 Found ${tracks.length} tracks in database for ${feedUrl}`);
      return tracks;
    }
    
    return null;
  } catch (error) {
    console.error('Failed to load tracks from database:', error);
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
    
    // Handle local database request with enhanced service
    if (feedUrl === 'local://database') {
      logger.info('🎵 Loading tracks from local database using enhanced service');
      try {
        // Use enhanced music service for unified track access
        const enhancedOnly = searchParams.get('enhanced') === 'true';
        
        if (enhancedOnly) {
          // Get only enhanced tracks
          const allUnifiedTracks = await enhancedMusicService.getUnifiedMusicTracks();
          const enhancedTracks = allUnifiedTracks.filter(track => track.enhancement?.enhanced);
          
          // Apply pagination
          const paginatedTracks = enhancedTracks.slice(offset, offset + limit);
          
          return NextResponse.json({
            success: true,
            data: {
              tracks: paginatedTracks,
              relatedFeeds: [],
              metadata: {
                totalTracks: enhancedTracks.length,
                returnedTracks: paginatedTracks.length,
                offset,
                limit,
                source: 'enhanced-database'
              }
            },
            message: `Successfully loaded ${paginatedTracks.length} enhanced tracks from database (${offset + 1}-${offset + paginatedTracks.length} of ${enhancedTracks.length})`
          });
        }
        
        // Get unified tracks (enhanced + legacy)
        let allTracks = await enhancedMusicService.getUnifiedMusicTracks();
        
        // Handle V4V resolution for unified tracks if requested
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
            logger.info('💾 Saving updated V4V resolutions to database...');
            try {
              const dataPath = path.join(process.cwd(), 'data', 'music-tracks.json');
              const existingData = await fs.readFile(dataPath, 'utf8');
              const musicData = JSON.parse(existingData);
              
              // Update tracks in the database
              musicData.musicTracks.forEach((dbTrack: any) => {
                const updatedTrack = databaseTracks.find((t: any) => 
                  t.episodeTitle === dbTrack.episodeTitle && 
                  t.startTime === dbTrack.startTime && 
                  t.endTime === dbTrack.endTime && 
                  t.title === dbTrack.title
                );
                if (updatedTrack) {
                  dbTrack.valueForValue = updatedTrack.valueForValue;
                }
              });
              
              // Update metadata
              musicData.metadata.lastUpdated = new Date().toISOString();
              
              await fs.writeFile(dataPath, JSON.stringify(musicData, null, 2));
              logger.info('✅ Database updated with V4V resolutions');
            } catch (error) {
              console.error('Failed to save V4V resolutions to database:', error);
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