/**
 * Consolidated Music API Handler
 * Centralizes all music-related operations
 */
import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { V4VResolver } from '@/lib/v4v-resolver';
import { enhancedMusicService } from '@/lib/enhanced-music-service';
import { musicTrackDB } from '@/lib/music-track-database';
import { logger } from '@/lib/logger';
import { promises as fs } from 'fs';
import path from 'path';

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
      if (params.feedUrl === 'local://database' || (!params.feedUrl && params.artist)) {
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

    // Load from enhanced service or database
    if (params.feedUrl === 'local://database') {
      return this.handleUnifiedDatabaseQuery(params);
    } else {
      return this.handleLegacyDatabaseQuery(params);
    }
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
      // Build query filters
      const filters: any = {};
      if (params.artist) filters.artist = params.artist;
      if (params.title) filters.title = params.title;
      if (params.feedId) filters.feedId = params.feedId;
      if (params.episodeId) filters.episodeId = params.episodeId;
      if (params.source) filters.source = params.source;
      if (params.hasV4VData !== undefined) filters.hasV4VData = params.hasV4VData;

      // Query database
      const tracks = await musicTrackDB.searchMusicTracks(filters, params.page || 1, params.pageSize || 20);

      return NextResponse.json({
        success: true,
        data: tracks,
        message: `Found ${tracks.tracks.length} tracks matching query`
      });
    } catch (error) {
      logger.error('Legacy database query failed', error);
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
          const track = await musicTrackDB.addMusicTrack(trackData);
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
      const track = await musicTrackDB.addMusicTrack(trackData);
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
      const dataPath = path.join(process.cwd(), 'data', 'music-tracks.json');
      const existingData = await fs.readFile(dataPath, 'utf8');
      const musicData = JSON.parse(existingData);

      // Check for duplicates
      const existingIds = new Set(musicData.musicTracks.map((t: any) =>
        `${t.episodeTitle}-${t.startTime}-${t.endTime}-${t.title}`
      ));

      const newTracks = tracks.filter(track => {
        const trackKey = `${track.episodeTitle}-${track.startTime}-${track.endTime}-${track.title}`;
        return !existingIds.has(trackKey);
      });

      if (newTracks.length === 0) {
        logger.info('No new tracks to save (all already exist)');
        return;
      }

      // Add tracks with IDs
      const tracksWithIds = newTracks.map(track => ({
        ...track,
        id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        feedUrl,
        extractionMethod: 'api-extraction',
        discoveredAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      }));

      musicData.musicTracks.push(...tracksWithIds);
      musicData.metadata.totalTracks = musicData.musicTracks.length;
      musicData.metadata.lastUpdated = new Date().toISOString();

      await fs.writeFile(dataPath, JSON.stringify(musicData, null, 2));
      logger.info(`Saved ${tracksWithIds.length} new tracks to database`);
    } catch (error) {
      logger.error('Failed to save tracks to database', error);
    }
  }

  private static async extractAndStoreTracks(feedUrl: string): Promise<void> {
    logger.info('Extracting tracks from feed for storage', { feedUrl });

    const result = await MusicTrackParser.extractMusicTracks(feedUrl);

    for (const track of result.tracks) {
      try {
        await musicTrackDB.addMusicTrack({
          title: track.title,
          artist: track.artist,
          episodeId: track.episodeId,
          episodeTitle: track.episodeTitle,
          episodeDate: track.episodeDate,
          startTime: track.startTime,
          endTime: track.endTime,
          duration: track.duration,
          audioUrl: track.audioUrl,
          image: track.image,
          description: track.description,
          valueForValue: track.valueForValue,
          source: track.source,
          feedUrl: track.feedUrl,
          feedId: 'unknown',
          extractionMethod: 'api-extraction'
        });
      } catch (error) {
        logger.warn('Failed to store individual track', { track: track.title, error });
      }
    }
  }
}