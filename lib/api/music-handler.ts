/**
 * Consolidated Music API Handler
 * Centralizes all music-related operations
 */
import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { V4VResolver } from '@/lib/v4v-resolver';
import { enhancedMusicService } from '@/lib/enhanced-music-service';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

// Cache management
const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

export interface MusicRequestParams {
  // Common parameters
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  forceRefresh?: boolean;

  // Music track parameters
  feedUrl?: string;
  resolveV4V?: boolean;
  saveToDatabase?: boolean;
  clearV4VCache?: boolean;
  useEnhanced?: boolean;
  enhanced?: boolean;

  // Database query parameters
  artist?: string;
  title?: string;
  feedId?: string;
  episodeId?: string;
  source?: string;
  hasV4VData?: boolean;
  extractFromFeed?: string;

  // Search parameters
  query?: string;
}

export class MusicAPIHandler {
  private static getCacheKey(params: MusicRequestParams): string {
    const keyParts = [
      params.feedUrl || 'database',
      params.resolveV4V || false,
      params.enhanced || false,
      params.artist || '',
      params.title || '',
      params.query || ''
    ];
    return keyParts.join(':');
  }

  private static isCacheValid(key: string): boolean {
    const cached = cache.get(key);
    if (!cached) return false;
    return (Date.now() - cached.timestamp) < cached.ttl;
  }

  private static setCache(key: string, data: any, ttl: number = CACHE_TTL): void {
    cache.set(key, { data, timestamp: Date.now(), ttl });
  }

  /**
   * Handle GET requests for music tracks
   */
  static async handleGet(request: NextRequest): Promise<NextResponse> {
    try {
      const { searchParams } = new URL(request.url);
      const params = this.parseRequestParams(searchParams);

      // Route to appropriate handler based on parameters
      if (!params.feedUrl && (params.artist || params.title || params.feedId || params.episodeId)) {
        return this.handleDatabaseQuery(params);
      }

      if (params.feedUrl) {
        return this.handleFeedExtraction(params);
      }

      if (params.query) {
        return this.handleSearch(params);
      }

      return NextResponse.json(
        { error: 'Invalid request parameters' },
        { status: 400 }
      );
    } catch (error) {
      logger.error('Music API GET request failed', error);
      return NextResponse.json(
        {
          error: 'Request failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }
  }

  /**
   * Handle POST requests for batch operations
   */
  static async handlePost(request: NextRequest): Promise<NextResponse> {
    try {
      const body = await request.json();

      // Handle bulk feed extraction
      if (body.feedUrls && Array.isArray(body.feedUrls)) {
        return this.handleBulkExtraction(body.feedUrls);
      }

      // Handle adding tracks to database
      if (body.tracks && Array.isArray(body.tracks)) {
        return this.handleBulkAddTracks(body.tracks);
      }

      // Handle single track addition
      if (body.track) {
        return this.handleAddTrack(body.track);
      }

      return NextResponse.json(
        { error: 'Invalid POST request body' },
        { status: 400 }
      );
    } catch (error) {
      logger.error('Music API POST request failed', error);
      return NextResponse.json(
        {
          error: 'Request failed',
          details: error instanceof Error ? error.message : 'Unknown error'
        },
        { status: 500 }
      );
    }
  }

  /**
   * Handle DELETE requests for cache clearing
   */
  static async handleDelete(request: NextRequest): Promise<NextResponse> {
    try {
      const { searchParams } = new URL(request.url);
      const action = searchParams.get('action');

      if (action === 'clear-cache') {
        cache.clear();
        V4VResolver.clearCache();
        return NextResponse.json({
          success: true,
          message: 'All caches cleared'
        });
      }

      return NextResponse.json(
        { error: 'Invalid delete action' },
        { status: 400 }
      );
    } catch (error) {
      logger.error('Music API DELETE request failed', error);
      return NextResponse.json(
        { error: 'Delete request failed' },
        { status: 500 }
      );
    }
  }

  private static parseRequestParams(searchParams: URLSearchParams): MusicRequestParams {
    return {
      limit: parseInt(searchParams.get('limit') || '100'),
      offset: parseInt(searchParams.get('offset') || '0'),
      page: parseInt(searchParams.get('page') || '1'),
      pageSize: parseInt(searchParams.get('pageSize') || '20'),
      forceRefresh: searchParams.get('forceRefresh') === 'true',

      feedUrl: searchParams.get('feedUrl') || undefined,
      resolveV4V: searchParams.get('resolveV4V') === 'true',
      saveToDatabase: searchParams.get('saveToDatabase') !== 'false',
      clearV4VCache: searchParams.get('clearV4VCache') === 'true',
      useEnhanced: searchParams.get('useEnhanced') === 'true',
      enhanced: searchParams.get('enhanced') === 'true',

      artist: searchParams.get('artist') || undefined,
      title: searchParams.get('title') || undefined,
      feedId: searchParams.get('feedId') || undefined,
      episodeId: searchParams.get('episodeId') || undefined,
      source: searchParams.get('source') || undefined,
      hasV4VData: searchParams.get('hasV4VData') === 'true' ? true : searchParams.get('hasV4VData') === 'false' ? false : undefined,
      extractFromFeed: searchParams.get('extractFromFeed') || undefined,

      query: searchParams.get('query') || undefined
    };
  }

  private static async handleDatabaseQuery(params: MusicRequestParams): Promise<NextResponse> {
    const cacheKey = this.getCacheKey(params);

    // Check cache
    if (!params.forceRefresh && this.isCacheValid(cacheKey)) {
      const cachedData = cache.get(cacheKey)!.data;
      return NextResponse.json(cachedData);
    }

    // Handle extraction from feed if requested
    if (params.extractFromFeed) {
      await this.extractAndStoreTracks(params.extractFromFeed);
    }

    // Use Prisma database query
    return this.handleLegacyDatabaseQuery(params);
  }

  private static async handleUnifiedDatabaseQuery(params: MusicRequestParams): Promise<NextResponse> {
    try {
      logger.info('Loading tracks from enhanced database service');

      // Get tracks from enhanced service
      let tracks = await enhancedMusicService.getUnifiedMusicTracks();

      // Filter for enhanced only if requested
      if (params.enhanced) {
        tracks = tracks.filter(track => track.enhancement?.enhanced);
      }

      // Handle V4V resolution if requested
      if (params.resolveV4V) {
        tracks = await this.resolveV4VForTracks(tracks, params.clearV4VCache);
      }

      // Apply pagination
      const total = tracks.length;
      const offset = params.offset || 0;
      const limit = params.limit || 100;
      const paginatedTracks = tracks.slice(offset, offset + limit);

      // Get database stats
      const stats = await enhancedMusicService.getDatabaseStats();

      const result = {
        success: true,
        data: {
          tracks: paginatedTracks,
          metadata: {
            totalTracks: total,
            returnedTracks: paginatedTracks.length,
            offset,
            limit,
            source: 'unified-database',
            enhancementStats: stats
          }
        },
        message: `Successfully loaded ${paginatedTracks.length} tracks (${offset + 1}-${offset + paginatedTracks.length} of ${total})`
      };

      // Cache result
      this.setCache(this.getCacheKey(params), result);

      return NextResponse.json(result);
    } catch (error) {
      logger.error('Failed to load from enhanced database', error);
      throw error;
    }
  }

  private static async handleLegacyDatabaseQuery(params: MusicRequestParams): Promise<NextResponse> {
    try {
      // Build Prisma where clause
      const where: any = {};
      
      if (params.artist) {
        where.artist = { contains: params.artist, mode: 'insensitive' };
      }
      if (params.title) {
        where.title = { contains: params.title, mode: 'insensitive' };
      }
      if (params.feedId) {
        where.feedId = params.feedId;
      }
      if (params.episodeId) {
        where.guid = params.episodeId;
      }
      // Note: source is not in Track schema, skip this filter
      if (params.hasV4VData !== undefined && params.hasV4VData) {
        where.v4vValue = { not: null };
      }

      const page = params.page || 1;
      const pageSize = params.pageSize || 20;
      const skip = (page - 1) * pageSize;

      // Query database with Prisma
      const [tracks, total] = await Promise.all([
        prisma.track.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { publishedAt: 'desc' },
          include: {
            Feed: {
              select: {
                id: true,
                title: true,
                artist: true,
                type: true
              }
            }
          }
        }),
        prisma.track.count({ where })
      ]);

      return NextResponse.json({
        success: true,
        data: {
          tracks,
          pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize)
          }
        },
        message: `Found ${tracks.length} tracks matching query`
      });
    } catch (error) {
      logger.error('Database query failed', error);
      throw error;
    }
  }

  private static async handleFeedExtraction(params: MusicRequestParams): Promise<NextResponse> {
    try {
      if (!params.feedUrl) {
        throw new Error('Feed URL is required');
      }

      // Validate URL
      try {
        new URL(params.feedUrl);
      } catch {
        return NextResponse.json(
          { error: 'Invalid feed URL provided' },
          { status: 400 }
        );
      }

      // Check cache
      const cacheKey = this.getCacheKey(params);
      if (!params.forceRefresh && this.isCacheValid(cacheKey)) {
        const cachedData = cache.get(cacheKey)!.data;
        return NextResponse.json(cachedData);
      }

      // Extract tracks
      let result;
      if (params.useEnhanced) {
        result = await this.extractWithEnhancedParser(params.feedUrl);
      } else {
        result = await MusicTrackParser.extractMusicTracks(params.feedUrl);
      }

      // Handle V4V resolution
      if (params.resolveV4V) {
        result.tracks = await this.resolveV4VForTracks(result.tracks, params.clearV4VCache);
      }

      // Save to database if requested
      if (params.saveToDatabase) {
        await this.saveTracksToDatabase(result.tracks, params.feedUrl);
      }

      const responseData = {
        success: true,
        data: result,
        message: `Successfully extracted ${result.tracks.length} music tracks`
      };

      // Cache result
      this.setCache(cacheKey, responseData);

      return NextResponse.json(responseData);
    } catch (error) {
      logger.error('Feed extraction failed', error);
      throw error;
    }
  }

  private static async handleSearch(params: MusicRequestParams): Promise<NextResponse> {
    if (!params.query) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    try {
      // Search in enhanced database
      const tracks = await enhancedMusicService.searchTracks({
        query: params.query,
        artist: params.artist
      });

      return NextResponse.json({
        success: true,
        data: {
          tracks: tracks.tracks,
          metadata: {
            totalResults: tracks.total,
            query: params.query,
            source: 'enhanced-search',
            hasMore: tracks.hasMore
          }
        },
        message: `Found ${tracks.tracks.length} tracks matching "${params.query}"`
      });
    } catch (error) {
      logger.error('Search failed', error);
      throw error;
    }
  }

  private static async handleBulkExtraction(feedUrls: string[]): Promise<NextResponse> {
    logger.info(`Processing bulk extraction for ${feedUrls.length} feeds`);

    const results = [];
    const errors = [];

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

    const totalTracks = results.reduce((sum, r) => sum + r.data.tracks.length, 0);

    return NextResponse.json({
      success: true,
      summary: {
        totalFeeds: feedUrls.length,
        successfulFeeds: results.length,
        failedFeeds: errors.length,
        totalTracks
      },
      results,
      errors
    });
  }

  private static async handleBulkAddTracks(tracks: any[]): Promise<NextResponse> {
    try {
      const addedTracks = [];
      const errors = [];

      for (const trackData of tracks) {
        try {
          // Find or create feed
          let feed = await prisma.feed.findFirst({
            where: { originalUrl: trackData.feedUrl || 'unknown' }
          });
          
          if (!feed && trackData.feedUrl) {
            feed = await prisma.feed.create({
              data: {
                id: `feed-${Date.now()}`,
                title: 'Imported Feed',
                originalUrl: trackData.feedUrl,
                type: 'album',
                status: 'active',
                updatedAt: new Date()
              }
            });
          }
          
          if (!feed) {
            throw new Error('Feed is required but not found');
          }

          const track = await prisma.track.create({
            data: {
              id: trackData.id || `track-${Date.now()}-${Math.random()}`,
              feedId: feed.id,
              title: trackData.title,
              artist: trackData.artist || null,
              album: trackData.album || null,
              audioUrl: trackData.audioUrl || '',
              startTime: trackData.startTime || null,
              endTime: trackData.endTime || null,
              duration: Math.round(trackData.duration) || null,
              image: trackData.image || null,
              description: trackData.description || null,
              guid: trackData.episodeId || null,
              publishedAt: trackData.episodeDate || null,
              v4vValue: trackData.valueForValue || null,
              updatedAt: new Date()
            }
          });
          addedTracks.push(track);
        } catch (error) {
          errors.push({
            track: trackData,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          addedTracks,
          errors,
          summary: {
            totalSubmitted: tracks.length,
            successful: addedTracks.length,
            failed: errors.length
          }
        }
      });
    } catch (error) {
      logger.error('Bulk add tracks failed', error);
      throw error;
    }
  }

  private static async handleAddTrack(trackData: any): Promise<NextResponse> {
    try {
      // Find or create feed
      let feed = await prisma.feed.findFirst({
        where: { originalUrl: trackData.feedUrl || 'unknown' }
      });
      
      if (!feed && trackData.feedUrl) {
        feed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}`,
            title: 'Imported Feed',
            originalUrl: trackData.feedUrl,
            type: 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });
      }
      
      if (!feed) {
        throw new Error('Feed is required but not found');
      }

      const track = await prisma.track.create({
        data: {
          id: trackData.id || `track-${Date.now()}-${Math.random()}`,
          feedId: feed.id,
          title: trackData.title,
          artist: trackData.artist || null,
          album: trackData.album || null,
          audioUrl: trackData.audioUrl || '',
          startTime: trackData.startTime || null,
          endTime: trackData.endTime || null,
          duration: Math.round(trackData.duration) || null,
          image: trackData.image || null,
          description: trackData.description || null,
          guid: trackData.episodeId || null,
          publishedAt: trackData.episodeDate || null,
          v4vValue: trackData.valueForValue || null,
          updatedAt: new Date()
        }
      });
      
      return NextResponse.json({
        success: true,
        data: track,
        message: 'Track added successfully'
      });
    } catch (error) {
      logger.error('Add track failed', error);
      throw error;
    }
  }

  // Helper methods
  private static async extractWithEnhancedParser(feedUrl: string): Promise<any> {
    const { enhancedRSSParser } = await import('@/lib/enhanced-rss-parser');
    const result = await enhancedRSSParser.parseAlbumFeed(feedUrl, {
      useEnhanced: true,
      includePodcastIndex: true,
      resolveRemoteItems: true,
      extractValueForValue: true
    });

    if (!result) {
      throw new Error('Enhanced parsing returned null');
    }

    return {
      tracks: result.tracks || [],
      relatedFeeds: []
    };
  }

  private static async resolveV4VForTracks(tracks: any[], clearCache = false): Promise<any[]> {
    if (clearCache) {
      V4VResolver.clearCache();
    }

    const v4vTracks = tracks.filter(track =>
      track.valueForValue?.feedGuid &&
      track.valueForValue?.itemGuid &&
      (!track.valueForValue?.resolved || clearCache)
    );

    if (v4vTracks.length === 0) {
      return tracks;
    }

    logger.info(`Resolving ${v4vTracks.length} V4V tracks`);

    const tracksToResolve = v4vTracks.map(track => ({
      feedGuid: track.valueForValue.feedGuid,
      itemGuid: track.valueForValue.itemGuid
    }));

    const resolutionResults = await V4VResolver.resolveBatch(tracksToResolve);

    // Apply results
    let resolvedCount = 0;
    tracks.forEach(track => {
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

    logger.info(`Successfully resolved ${resolvedCount} V4V tracks`);
    return tracks;
  }

  private static async saveTracksToDatabase(tracks: any[], feedUrl: string): Promise<void> {
    try {
      // Find or create feed
      let feed = await prisma.feed.findFirst({
        where: { originalUrl: feedUrl }
      });
      
      if (!feed) {
        feed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}`,
            title: 'Imported Feed',
            originalUrl: feedUrl,
            type: 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });
      }

      // Save tracks to Prisma
      for (const track of tracks) {
        try {
          // Check if track already exists (by guid or unique combination)
          const existing = await prisma.track.findFirst({
            where: {
              feedId: feed.id,
              title: track.title,
              ...(track.guid && { guid: track.guid })
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
                audioUrl: track.audioUrl || '',
                startTime: track.startTime || null,
                endTime: track.endTime || null,
                duration: Math.round(track.duration) || null,
                image: track.image || null,
                description: track.description || null,
                guid: track.guid || track.episodeId || null,
                publishedAt: track.publishedAt || track.episodeDate || null,
                v4vValue: track.valueForValue || null,
                updatedAt: new Date()
              }
            });
          }
        } catch (error) {
          logger.warn('Failed to save individual track', { track: track.title, error });
        }
      }
      
      logger.info(`Saved tracks to Prisma database for feed ${feedUrl}`);
    } catch (error) {
      logger.error('Failed to save tracks to database', error);
    }
  }

  private static async extractAndStoreTracks(feedUrl: string): Promise<void> {
    logger.info('Extracting tracks from feed for storage', { feedUrl });

    const result = await MusicTrackParser.extractMusicTracks(feedUrl);

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

    for (const track of result.tracks) {
      try {
        await prisma.track.create({
          data: {
            id: track.id || `track-${Date.now()}-${Math.random()}`,
            feedId: feed.id,
            title: track.title,
            artist: track.artist || null,
            album: null,
            audioUrl: track.audioUrl || '',
            startTime: track.startTime || null,
            endTime: track.endTime || null,
            duration: Math.round(track.duration) || null,
            image: track.image || null,
            description: track.description || null,
            guid: track.episodeId || null,
            publishedAt: track.episodeDate || null,
            v4vValue: track.valueForValue ? {
              lightningAddress: track.valueForValue.lightningAddress,
              suggestedAmount: track.valueForValue.suggestedAmount,
              customKey: track.valueForValue.customKey,
              customValue: track.valueForValue.customValue,
              remotePercentage: track.valueForValue.remotePercentage,
              feedGuid: track.valueForValue.feedGuid,
              itemGuid: track.valueForValue.itemGuid
            } : undefined,
            updatedAt: new Date()
          }
        });
      } catch (error) {
        logger.warn('Failed to store individual track', { track: track.title, error });
      }
    }
  }
}