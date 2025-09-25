/**
 * Consolidated Playlist API Handler
 * Centralizes all playlist-related operations
 */
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export interface PlaylistRequestParams {
  type?: 'itdv' | 'hgh' | 'lightning-thrashes' | 'top100';
  format?: 'json' | 'rss';
  limit?: number;
  offset?: number;
  enhanced?: boolean;
}

export class PlaylistAPIHandler {
  /**
   * Handle GET requests for playlists
   */
  static async handleGet(request: NextRequest): Promise<NextResponse> {
    try {
      const { searchParams, pathname } = new URL(request.url);
      const params = this.parseRequestParams(searchParams, pathname);

      // Route to appropriate playlist handler
      switch (params.type) {
        case 'itdv':
          return this.handleITDVPlaylist(params);
        case 'hgh':
          return this.handleHGHPlaylist(params);
        case 'lightning-thrashes':
          return this.handleLightningThrashesPlaylist(params);
        case 'top100':
          return this.handleTop100Playlist(params);
        default:
          return this.handlePlaylistIndex();
      }
    } catch (error) {
      logger.error('Playlist API GET request failed', error);
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
   * Handle POST requests for playlist creation/modification
   */
  static async handlePost(request: NextRequest): Promise<NextResponse> {
    try {
      const body = await request.json();

      if (body.action === 'create') {
        return this.handleCreatePlaylist(body);
      }

      if (body.action === 'generate-rss') {
        return this.handleGenerateRSS(body);
      }

      return NextResponse.json(
        { error: 'Invalid POST action' },
        { status: 400 }
      );
    } catch (error) {
      logger.error('Playlist API POST request failed', error);
      return NextResponse.json(
        { error: 'Request failed' },
        { status: 500 }
      );
    }
  }

  private static parseRequestParams(searchParams: URLSearchParams, pathname: string): PlaylistRequestParams {
    // Extract playlist type from pathname or query params
    let type: PlaylistRequestParams['type'];

    if (pathname.includes('/itdv')) {
      type = 'itdv';
    } else if (pathname.includes('/hgh')) {
      type = 'hgh';
    } else if (pathname.includes('/lightning-thrashes')) {
      type = 'lightning-thrashes';
    } else if (pathname.includes('/top100')) {
      type = 'top100';
    } else {
      type = searchParams.get('type') as PlaylistRequestParams['type'];
    }

    return {
      type,
      format: (searchParams.get('format') as 'json' | 'rss') || 'json',
      limit: parseInt(searchParams.get('limit') || '100'),
      offset: parseInt(searchParams.get('offset') || '0'),
      enhanced: searchParams.get('enhanced') === 'true'
    };
  }

  private static async handleITDVPlaylist(params: PlaylistRequestParams): Promise<NextResponse> {
    try {
      if (params.format === 'rss') {
        return this.generateITDVRSS();
      }

      // Load ITDV tracks
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/itdv-resolved-songs`);
      const data = await response.json();

      if (!data.success) {
        throw new Error('Failed to load ITDV tracks');
      }

      // Apply pagination if requested
      let tracks = data.tracks;
      if (params.limit || params.offset) {
        const start = params.offset || 0;
        const end = start + (params.limit || tracks.length);
        tracks = tracks.slice(start, end);
      }

      return NextResponse.json({
        success: true,
        playlist: {
          id: 'itdv',
          title: 'Into The Doerfel-Verse',
          description: 'Music tracks from the Into The Doerfel-Verse podcast',
          type: 'podcast-music',
          tracks,
          metadata: {
            totalTracks: data.tracks.length,
            returnedTracks: tracks.length,
            offset: params.offset || 0,
            limit: params.limit,
            lastUpdated: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      logger.error('ITDV playlist request failed', error);
      throw error;
    }
  }

  private static async handleHGHPlaylist(params: PlaylistRequestParams): Promise<NextResponse> {
    try {
      if (params.format === 'rss') {
        return this.generateHGHRSS();
      }

      // Load HGH tracks
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/hgh-songs-list`);
      const data = await response.json();

      if (!data.success) {
        throw new Error('Failed to load HGH tracks');
      }

      return NextResponse.json({
        success: true,
        playlist: {
          id: 'hgh',
          title: 'Hoarders, Gatherers & Hunters',
          description: 'Music tracks from the Hoarders, Gatherers & Hunters podcast',
          type: 'podcast-music',
          tracks: data.tracks,
          metadata: {
            totalTracks: data.tracks.length,
            lastUpdated: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      logger.error('HGH playlist request failed', error);
      throw error;
    }
  }

  private static async handleLightningThrashesPlaylist(params: PlaylistRequestParams): Promise<NextResponse> {
    try {
      if (params.format === 'rss') {
        return this.generateLightningThrashesRSS();
      }

      // For now, return a placeholder
      return NextResponse.json({
        success: true,
        playlist: {
          id: 'lightning-thrashes',
          title: 'Lightning Thrashes',
          description: 'Lightning Thrashes playlist',
          type: 'podcast-music',
          tracks: [],
          metadata: {
            totalTracks: 0,
            lastUpdated: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      logger.error('Lightning Thrashes playlist request failed', error);
      throw error;
    }
  }

  private static async handleTop100Playlist(params: PlaylistRequestParams): Promise<NextResponse> {
    try {
      // Load top 100 tracks
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/top100-music`);
      const data = await response.json();

      return NextResponse.json({
        success: true,
        playlist: {
          id: 'top100',
          title: 'Top 100 Music Tracks',
          description: 'Top 100 most popular music tracks',
          type: 'top-tracks',
          tracks: data.tracks || [],
          metadata: {
            totalTracks: data.tracks?.length || 0,
            lastUpdated: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      logger.error('Top 100 playlist request failed', error);
      throw error;
    }
  }

  private static async handlePlaylistIndex(): Promise<NextResponse> {
    try {
      const playlists = [
        {
          id: 'itdv',
          title: 'Into The Doerfel-Verse',
          description: 'Music tracks from the Into The Doerfel-Verse podcast',
          trackCount: null, // Will be populated dynamically
          endpoints: {
            json: '/api/playlist?type=itdv',
            rss: '/api/playlist?type=itdv&format=rss'
          }
        },
        {
          id: 'hgh',
          title: 'Hoarders, Gatherers & Hunters',
          description: 'Music tracks from the Hoarders, Gatherers & Hunters podcast',
          trackCount: null,
          endpoints: {
            json: '/api/playlist?type=hgh',
            rss: '/api/playlist?type=hgh&format=rss'
          }
        },
        {
          id: 'lightning-thrashes',
          title: 'Lightning Thrashes',
          description: 'Lightning Thrashes playlist',
          trackCount: null,
          endpoints: {
            json: '/api/playlist?type=lightning-thrashes',
            rss: '/api/playlist?type=lightning-thrashes&format=rss'
          }
        },
        {
          id: 'top100',
          title: 'Top 100 Music Tracks',
          description: 'Top 100 most popular music tracks',
          trackCount: null,
          endpoints: {
            json: '/api/playlist?type=top100'
          }
        }
      ];

      return NextResponse.json({
        success: true,
        playlists,
        message: 'Available playlists'
      });
    } catch (error) {
      logger.error('Playlist index request failed', error);
      throw error;
    }
  }

  private static async handleCreatePlaylist(body: any): Promise<NextResponse> {
    // Implementation for creating custom playlists
    logger.info('Create playlist request', body);

    return NextResponse.json({
      success: false,
      error: 'Playlist creation not yet implemented'
    }, { status: 501 });
  }

  private static async handleGenerateRSS(body: any): Promise<NextResponse> {
    try {
      const { type, title, description, tracks } = body;

      // Delegate to the RSS generation endpoint
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/generate-playlist-rss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title, description, tracks })
      });

      const rssData = await response.text();

      return new NextResponse(rssData, {
        headers: {
          'Content-Type': 'application/rss+xml',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    } catch (error) {
      logger.error('RSS generation failed', error);
      throw error;
    }
  }

  // RSS generation helpers
  private static async generateITDVRSS(): Promise<NextResponse> {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/playlist/itdv-rss`);
    const rssContent = await response.text();

    return new NextResponse(rssContent, {
      headers: {
        'Content-Type': 'application/rss+xml',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  private static async generateHGHRSS(): Promise<NextResponse> {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/playlist/hgh-rss`);
    const rssContent = await response.text();

    return new NextResponse(rssContent, {
      headers: {
        'Content-Type': 'application/rss+xml',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  private static async generateLightningThrashesRSS(): Promise<NextResponse> {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/playlist/lightning-thrashes-rss`);
    const rssContent = await response.text();

    return new NextResponse(rssContent, {
      headers: {
        'Content-Type': 'application/rss+xml',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }
}