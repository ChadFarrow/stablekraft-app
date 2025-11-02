import fs from 'fs';
import path from 'path';
import { EnhancedMusicTrack } from './enhanced-rss-parser';

/**
 * Enhanced Music Tracks Service
 * 
 * @deprecated This service uses JSON file storage and is being phased out.
 * Please use Prisma with PostgreSQL directly via `@/lib/prisma` instead.
 * 
 * This service provided unified access to both legacy music tracks database
 * and the new enhanced database format. All functionality should now
 * use Prisma Track and Feed models.
 */

export interface MusicDatabase {
  musicTracks: any[];
  metadata?: {
    version?: string;
    lastUpdated?: string;
    totalTracks?: number;
  };
}

export interface EnhancedDatabase {
  metadata: {
    originalCount: number;
    enhancedAt: string;
    parser: string;
    version: string;
    completedAt?: string;
    processingTimeSeconds?: number;
  };
  enhancedTracks: any[];
  failedTracks: any[];
  enhancementStats: {
    successful: number;
    failed: number;
    processed: number;
    remaining: number;
    artistNamesFixed: number;
    valueForValueEnabled: number;
    audioUrlsAdded: number;
    durationResolved: number;
  };
}

export interface DatabaseStats {
  totalTracks: number;
  enhancedTracks: number;
  legacyTracks: number;
  enhancementRate: number;
  valueForValueTracks: number;
  tracksWithAudio: number;
  tracksWithArtist: number;
}

export class EnhancedMusicService {
  private legacyDbPath: string;
  private enhancedDbPath: string;
  private publicDbPath: string;

  constructor() {
    this.legacyDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    this.enhancedDbPath = path.join(process.cwd(), 'data', 'enhanced-music-tracks.json');
    this.publicDbPath = path.join(process.cwd(), 'public', 'music-tracks.json');
  }

  /**
   * Load legacy music database
   */
  async loadLegacyDatabase(): Promise<MusicDatabase | null> {
    try {
      if (!fs.existsSync(this.legacyDbPath)) {
        return null;
      }

      const data = fs.readFileSync(this.legacyDbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load legacy database:', error);
      return null;
    }
  }

  /**
   * Load enhanced music database
   */
  async loadEnhancedDatabase(): Promise<EnhancedDatabase | null> {
    try {
      if (!fs.existsSync(this.enhancedDbPath)) {
        return null;
      }

      const data = fs.readFileSync(this.enhancedDbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load enhanced database:', error);
      return null;
    }
  }

  /**
   * Load public music database (legacy format for client)
   */
  async loadPublicDatabase(): Promise<MusicDatabase | null> {
    try {
      if (!fs.existsSync(this.publicDbPath)) {
        return null;
      }

      const data = fs.readFileSync(this.publicDbPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load public database:', error);
      return null;
    }
  }

  /**
   * Get unified music tracks with enhanced data merged
   */
  async getUnifiedMusicTracks(): Promise<EnhancedMusicTrack[]> {
    const legacyDb = await this.loadLegacyDatabase();
    const enhancedDb = await this.loadEnhancedDatabase();

    if (!legacyDb) {
      return [];
    }

    const unifiedTracks: EnhancedMusicTrack[] = [];
    const enhancedMap = new Map();

    // Create lookup map for enhanced tracks
    if (enhancedDb) {
      enhancedDb.enhancedTracks.forEach(enhanced => {
        const originalIndex = enhanced.originalIndex;
        if (typeof originalIndex === 'number') {
          enhancedMap.set(originalIndex, enhanced);
        }
      });
    }

    // Merge legacy tracks with enhanced data
    legacyDb.musicTracks.forEach((track, index) => {
      const enhanced = enhancedMap.get(index);
      
      if (enhanced) {
        // Create enhanced track
        const enhancedTrack: EnhancedMusicTrack = {
          ...track,
          enhancedMetadata: enhanced.enhancedMetadata,
          enhancement: {
            enhanced: true,
            enhancedAt: enhanced.enhancedAt,
            enhancements: enhanced.enhancements
          }
        };

        // Update main fields with enhanced data where available
        if (enhanced.enhancedMetadata?.artist) {
          enhancedTrack.feedArtist = enhanced.enhancedMetadata.artist;
        }

        unifiedTracks.push(enhancedTrack);
      } else {
        // Legacy track without enhancement
        unifiedTracks.push({
          ...track,
          enhancement: {
            enhanced: false,
            enhancements: {
              artistNameImproved: false,
              durationResolved: false,
              valueForValueAdded: false,
              audioUrlAdded: false
            }
          }
        });
      }
    });

    return unifiedTracks;
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<DatabaseStats> {
    const unifiedTracks = await this.getUnifiedMusicTracks();
    
    const stats: DatabaseStats = {
      totalTracks: unifiedTracks.length,
      enhancedTracks: 0,
      legacyTracks: 0,
      enhancementRate: 0,
      valueForValueTracks: 0,
      tracksWithAudio: 0,
      tracksWithArtist: 0
    };

    unifiedTracks.forEach(track => {
      if (track.enhancement?.enhanced) {
        stats.enhancedTracks++;
        
        if (track.enhancedMetadata?.valueForValue?.enabled) {
          stats.valueForValueTracks++;
        }
        
        if (track.enhancedMetadata?.audioUrl) {
          stats.tracksWithAudio++;
        }
      } else {
        stats.legacyTracks++;
      }

      if (track.feedArtist && track.feedArtist.trim() !== '') {
        stats.tracksWithArtist++;
      }
    });

    stats.enhancementRate = stats.totalTracks > 0 
      ? (stats.enhancedTracks / stats.totalTracks) * 100 
      : 0;

    return stats;
  }

  /**
   * Search tracks with enhanced capabilities
   */
  async searchTracks(params: {
    query?: string;
    artist?: string;
    hasAudio?: boolean;
    hasValueForValue?: boolean;
    enhanced?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    tracks: EnhancedMusicTrack[];
    total: number;
    hasMore: boolean;
  }> {
    const unifiedTracks = await this.getUnifiedMusicTracks();
    const {
      query,
      artist,
      hasAudio,
      hasValueForValue,
      enhanced,
      limit = 50,
      offset = 0
    } = params;

    let filteredTracks = unifiedTracks;

    // Apply filters
    if (query) {
      const searchTerms = query.toLowerCase().split(' ');
      filteredTracks = filteredTracks.filter(track => {
        const searchableText = [
          track.title,
          track.feedArtist,
          track.feedTitle,
          track.enhancedMetadata?.artist,
          track.enhancedMetadata?.albumTitle
        ].join(' ').toLowerCase();

        return searchTerms.every(term => searchableText.includes(term));
      });
    }

    if (artist) {
      const artistLower = artist.toLowerCase();
      filteredTracks = filteredTracks.filter(track => 
        track.feedArtist?.toLowerCase().includes(artistLower) ||
        track.enhancedMetadata?.artist?.toLowerCase().includes(artistLower)
      );
    }

    if (hasAudio === true) {
      filteredTracks = filteredTracks.filter(track => 
        track.enhancedMetadata?.audioUrl
      );
    }

    if (hasValueForValue === true) {
      filteredTracks = filteredTracks.filter(track => 
        track.enhancedMetadata?.valueForValue?.enabled
      );
    }

    if (enhanced === true) {
      filteredTracks = filteredTracks.filter(track => 
        track.enhancement?.enhanced
      );
    } else if (enhanced === false) {
      filteredTracks = filteredTracks.filter(track => 
        !track.enhancement?.enhanced
      );
    }

    // Apply pagination
    const total = filteredTracks.length;
    const paginatedTracks = filteredTracks.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      tracks: paginatedTracks,
      total,
      hasMore
    };
  }

  /**
   * Get track by ID/index
   */
  async getTrackById(id: string | number): Promise<EnhancedMusicTrack | null> {
    const unifiedTracks = await this.getUnifiedMusicTracks();
    
    if (typeof id === 'number') {
      return unifiedTracks[id] || null;
    }

    // Search by various ID fields
    return unifiedTracks.find(track => 
      track.itemGuid?._ === id ||
      track.feedGuid === id ||
      track.title === id
    ) || null;
  }

  /**
   * Export unified database in legacy format for client compatibility
   */
  async exportToPublicDatabase(): Promise<boolean> {
    try {
      const unifiedTracks = await this.getUnifiedMusicTracks();
      
      // Convert to legacy format but include enhanced artist names
      const legacyFormat = {
        musicTracks: unifiedTracks.map(track => ({
          ...track,
          // Use enhanced artist if available
          feedArtist: track.enhancedMetadata?.artist || track.feedArtist,
          // Remove enhancement metadata for client
          enhancedMetadata: undefined,
          enhancement: undefined
        })),
        metadata: {
          version: '2.0-enhanced',
          lastUpdated: new Date().toISOString(),
          totalTracks: unifiedTracks.length,
          enhancedTracks: unifiedTracks.filter(t => t.enhancement?.enhanced).length
        }
      };

      fs.writeFileSync(this.publicDbPath, JSON.stringify(legacyFormat, null, 2));
      return true;
    } catch (error) {
      console.error('Failed to export to public database:', error);
      return false;
    }
  }

  /**
   * Get enhancement status for a specific track
   */
  async getTrackEnhancementStatus(trackIndex: number): Promise<{
    enhanced: boolean;
    enhancements: any;
    metadata?: any;
  } | null> {
    const enhancedDb = await this.loadEnhancedDatabase();
    
    if (!enhancedDb) {
      return { enhanced: false, enhancements: {} };
    }

    const enhanced = enhancedDb.enhancedTracks.find(t => t.originalIndex === trackIndex);
    
    if (enhanced) {
      return {
        enhanced: true,
        enhancements: enhanced.enhancements,
        metadata: enhanced.enhancedMetadata
      };
    }

    return { enhanced: false, enhancements: {} };
  }

  /**
   * Check if enhanced database is available and up to date
   */
  async getEnhancementStatus(): Promise<{
    hasEnhanced: boolean;
    enhancedCount: number;
    totalCount: number;
    enhancementRate: number;
    lastUpdated?: string;
    processingComplete: boolean;
  }> {
    const legacyDb = await this.loadLegacyDatabase();
    const enhancedDb = await this.loadEnhancedDatabase();

    const totalCount = legacyDb?.musicTracks?.length || 0;
    const enhancedCount = enhancedDb?.enhancementStats?.successful || 0;
    const enhancementRate = totalCount > 0 ? (enhancedCount / totalCount) * 100 : 0;

    return {
      hasEnhanced: !!enhancedDb,
      enhancedCount,
      totalCount,
      enhancementRate,
      lastUpdated: enhancedDb?.metadata?.completedAt || enhancedDb?.metadata?.enhancedAt,
      processingComplete: !!enhancedDb?.metadata?.completedAt
    };
  }
}

// Export singleton instance
export const enhancedMusicService = new EnhancedMusicService();

// Export convenience functions
export async function getUnifiedMusicTracks(): Promise<EnhancedMusicTrack[]> {
  return enhancedMusicService.getUnifiedMusicTracks();
}

export async function getMusicDatabaseStats(): Promise<DatabaseStats> {
  return enhancedMusicService.getDatabaseStats();
}

export async function searchMusicTracks(params: any) {
  return enhancedMusicService.searchTracks(params);
}