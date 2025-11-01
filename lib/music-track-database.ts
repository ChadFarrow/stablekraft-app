/**
 * Music Track Database Service
 * 
 * @deprecated This service uses JSON file storage and is being phased out.
 * Please use Prisma with PostgreSQL directly via `@/lib/prisma` instead.
 * 
 * This service manages the music track database using JSON file storage,
 * providing CRUD operations, search functionality, and integration with
 * the existing feed parsing system.
 * 
 * Migration path: Use `prisma.track` and `prisma.feed` directly instead.
 */

import fs from 'fs';
import path from 'path';
import { 
  MusicTrackDatabase, 
  MusicTrackRecord, 
  EpisodeRecord, 
  MusicFeedRecord,
  ValueTimeSplitRecord,
  ValueRecipientRecord,
  BoostagramRecord,
  FundingRecord,
  MusicTrackExtractionRecord,
  MusicTrackAnalytics,
  MusicTrackSearchFilters,
  MusicTrackSearchResult,
  createEmptyDatabase,
  validateMusicTrackRecord,
  SCHEMA_VERSION
} from './music-track-schema';
import { createErrorLogger } from './error-utils';

export class MusicTrackDatabaseService {
  private static readonly logger = createErrorLogger('MusicTrackDatabase');
  private static readonly DATABASE_FILE = path.join(process.cwd(), 'data', 'music-tracks.json');
  private static instance: MusicTrackDatabaseService;
  private database: MusicTrackDatabase | null = null;
  private lastLoadTime: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): MusicTrackDatabaseService {
    if (!MusicTrackDatabaseService.instance) {
      MusicTrackDatabaseService.instance = new MusicTrackDatabaseService();
    }
    return MusicTrackDatabaseService.instance;
  }

  /**
   * Load the database from file
   */
  private async loadDatabase(): Promise<MusicTrackDatabase> {
    const now = Date.now();
    
    // Return cached database if still valid
    if (this.database && (now - this.lastLoadTime) < this.CACHE_DURATION) {
      return this.database;
    }

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(MusicTrackDatabaseService.DATABASE_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Load database file or create new one
      if (fs.existsSync(MusicTrackDatabaseService.DATABASE_FILE)) {
        const fileContent = fs.readFileSync(MusicTrackDatabaseService.DATABASE_FILE, 'utf8');
        this.database = JSON.parse(fileContent);
        
        // Convert date strings back to Date objects
        this.database = this.deserializeDates(this.database);
        
        console.log('Database loaded from file:', { 
          totalTracks: this.database?.musicTracks.length || 0,
          totalEpisodes: this.database?.episodes.length || 0,
          totalFeeds: this.database?.feeds.length || 0
        });
      } else {
        this.database = createEmptyDatabase();
        await this.saveDatabase();
        console.log('Created new music track database');
      }

      this.lastLoadTime = now;
      return this.database!;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to load database:', errorMessage);
      this.database = createEmptyDatabase();
      return this.database;
    }
  }

  /**
   * Save the database to file
   */
  private async saveDatabase(): Promise<void> {
    if (!this.database) {
      throw new Error('Database not loaded');
    }

    try {
      // Update metadata
      this.database.metadata.lastUpdated = new Date();
      this.database.metadata.totalTracks = this.database.musicTracks.length;
      this.database.metadata.totalEpisodes = this.database.episodes.length;
      this.database.metadata.totalFeeds = this.database.feeds.length;
      this.database.metadata.totalExtractions = this.database.extractions.length;

      // Serialize dates to strings for JSON storage
      const serializedData = this.serializeDates(this.database);
      
      // Write to file with pretty formatting
      fs.writeFileSync(
        MusicTrackDatabaseService.DATABASE_FILE, 
        JSON.stringify(serializedData, null, 2)
      );

      console.log('Database saved successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to save database:', errorMessage);
      throw error;
    }
  }

  /**
   * Convert Date objects to strings for JSON serialization
   */
  private serializeDates(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.serializeDates(item));
    }

    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.serializeDates(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * Convert date strings back to Date objects
   */
  private deserializeDates(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deserializeDates(item));
    }

    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string' && this.isDateString(value)) {
          result[key] = new Date(value);
        } else {
          result[key] = this.deserializeDates(value);
        }
      }
      return result;
    }

    return obj;
  }

  /**
   * Check if a string looks like a date
   */
  private isDateString(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  // ============================================================================
  // MUSIC TRACK OPERATIONS
  // ============================================================================

  /**
   * Add a new music track
   */
  async addMusicTrack(track: Omit<MusicTrackRecord, 'id' | 'discoveredAt' | 'lastUpdated'>): Promise<MusicTrackRecord> {
    const db = await this.loadDatabase();
    
    const newTrack: MusicTrackRecord = {
      ...track,
      id: this.generateId('track'),
      discoveredAt: new Date(),
      lastUpdated: new Date()
    };

    // Validate the track
    const validation = validateMusicTrackRecord(newTrack);
    if (!validation.isValid) {
      throw new Error(`Invalid music track: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      MusicTrackDatabaseService.logger.warn('Music track validation warnings', { warnings: validation.warnings });
    }

    db.musicTracks.push(newTrack);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Music track added', { trackId: newTrack.id, title: newTrack.title });
    return newTrack;
  }

  /**
   * Get a music track by ID
   */
  async getMusicTrack(id: string): Promise<MusicTrackRecord | null> {
    const db = await this.loadDatabase();
    return db.musicTracks.find(track => track.id === id) || null;
  }

  /**
   * Update a music track
   */
  async updateMusicTrack(id: string, updates: Partial<MusicTrackRecord>): Promise<MusicTrackRecord | null> {
    const db = await this.loadDatabase();
    const trackIndex = db.musicTracks.findIndex(track => track.id === id);
    
    if (trackIndex === -1) {
      return null;
    }

    const updatedTrack: MusicTrackRecord = {
      ...db.musicTracks[trackIndex],
      ...updates,
      lastUpdated: new Date()
    };

    // Validate the updated track
    const validation = validateMusicTrackRecord(updatedTrack);
    if (!validation.isValid) {
      throw new Error(`Invalid music track: ${validation.errors.join(', ')}`);
    }

    db.musicTracks[trackIndex] = updatedTrack;
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Music track updated', { trackId: id, title: updatedTrack.title });
    return updatedTrack;
  }

  /**
   * Delete a music track
   */
  async deleteMusicTrack(id: string): Promise<boolean> {
    const db = await this.loadDatabase();
    const trackIndex = db.musicTracks.findIndex(track => track.id === id);
    
    if (trackIndex === -1) {
      return false;
    }

    const deletedTrack = db.musicTracks.splice(trackIndex, 1)[0];
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Music track deleted', { trackId: id, title: deletedTrack.title });
    return true;
  }

  /**
   * Search music tracks
   */
  async searchMusicTracks(filters: MusicTrackSearchFilters, page: number = 1, pageSize: number = 20): Promise<MusicTrackSearchResult> {
    const db = await this.loadDatabase();
    let tracks = [...db.musicTracks];

    // Apply filters
    if (filters.artist) {
      tracks = tracks.filter(track => 
        track.artist.toLowerCase().includes(filters.artist!.toLowerCase())
      );
    }

    if (filters.title) {
      tracks = tracks.filter(track => 
        track.title.toLowerCase().includes(filters.title!.toLowerCase())
      );
    }

    if (filters.feedId) {
      tracks = tracks.filter(track => track.feedId === filters.feedId);
    }

    if (filters.episodeId) {
      tracks = tracks.filter(track => track.episodeId === filters.episodeId);
    }

    if (filters.source) {
      tracks = tracks.filter(track => track.source === filters.source);
    }

    if (filters.hasV4VData !== undefined) {
      tracks = tracks.filter(track => 
        filters.hasV4VData ? !!track.valueForValue : !track.valueForValue
      );
    }

    if (filters.dateRange) {
      tracks = tracks.filter(track => 
        track.episodeDate >= filters.dateRange!.start && 
        track.episodeDate <= filters.dateRange!.end
      );
    }

    if (filters.durationRange) {
      tracks = tracks.filter(track => 
        track.duration >= filters.durationRange!.min && 
        track.duration <= filters.durationRange!.max
      );
    }

    if (filters.tags && filters.tags.length > 0) {
      tracks = tracks.filter(track => 
        track.tags && filters.tags!.some(tag => track.tags!.includes(tag))
      );
    }

    // Sort by discovery date (newest first)
    tracks.sort((a, b) => b.discoveredAt.getTime() - a.discoveredAt.getTime());

    // Apply pagination
    const total = tracks.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedTracks = tracks.slice(startIndex, endIndex);

    return {
      tracks: paginatedTracks,
      total,
      page,
      pageSize,
      filters
    };
  }

  /**
   * Get all music tracks for a specific episode
   */
  async getMusicTracksByEpisode(episodeId: string): Promise<MusicTrackRecord[]> {
    const db = await this.loadDatabase();
    return db.musicTracks.filter(track => track.episodeId === episodeId);
  }

  /**
   * Get all music tracks for a specific feed
   */
  async getMusicTracksByFeed(feedId: string): Promise<MusicTrackRecord[]> {
    const db = await this.loadDatabase();
    return db.musicTracks.filter(track => track.feedId === feedId);
  }

  // ============================================================================
  // EPISODE OPERATIONS
  // ============================================================================

  /**
   * Add a new episode
   */
  async addEpisode(episode: Omit<EpisodeRecord, 'id' | 'discoveredAt' | 'lastUpdated'>): Promise<EpisodeRecord> {
    const db = await this.loadDatabase();
    
    const newEpisode: EpisodeRecord = {
      ...episode,
      id: this.generateId('episode'),
      discoveredAt: new Date(),
      lastUpdated: new Date()
    };

    db.episodes.push(newEpisode);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Episode added', { episodeId: newEpisode.id, title: newEpisode.title });
    return newEpisode;
  }

  /**
   * Get an episode by ID
   */
  async getEpisode(id: string): Promise<EpisodeRecord | null> {
    const db = await this.loadDatabase();
    return db.episodes.find(episode => episode.id === id) || null;
  }

  /**
   * Get episode by GUID
   */
  async getEpisodeByGuid(guid: string): Promise<EpisodeRecord | null> {
    const db = await this.loadDatabase();
    return db.episodes.find(episode => episode.guid === guid) || null;
  }

  // ============================================================================
  // FEED OPERATIONS
  // ============================================================================

  /**
   * Add a new music feed
   */
  async addMusicFeed(feed: Omit<MusicFeedRecord, 'id' | 'discoveredAt' | 'lastUpdated'>): Promise<MusicFeedRecord> {
    const db = await this.loadDatabase();
    
    const newFeed: MusicFeedRecord = {
      ...feed,
      id: this.generateId('feed'),
      discoveredAt: new Date(),
      lastUpdated: new Date()
    };

    db.feeds.push(newFeed);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Music feed added', { feedId: newFeed.id, title: newFeed.title });
    return newFeed;
  }

  /**
   * Get a music feed by ID
   */
  async getMusicFeed(id: string): Promise<MusicFeedRecord | null> {
    const db = await this.loadDatabase();
    return db.feeds.find(feed => feed.id === id) || null;
  }

  // ============================================================================
  // V4V OPERATIONS
  // ============================================================================

  /**
   * Add a value time split
   */
  async addValueTimeSplit(split: Omit<ValueTimeSplitRecord, 'id' | 'discoveredAt' | 'lastUpdated'>): Promise<ValueTimeSplitRecord> {
    const db = await this.loadDatabase();
    
    const newSplit: ValueTimeSplitRecord = {
      ...split,
      id: this.generateId('vts'),
      discoveredAt: new Date(),
      lastUpdated: new Date()
    };

    db.valueTimeSplits.push(newSplit);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Value time split added', { splitId: newSplit.id, episodeId: newSplit.episodeId });
    return newSplit;
  }

  /**
   * Add a value recipient
   */
  async addValueRecipient(recipient: Omit<ValueRecipientRecord, 'id' | 'discoveredAt' | 'lastUpdated'>): Promise<ValueRecipientRecord> {
    const db = await this.loadDatabase();
    
    const newRecipient: ValueRecipientRecord = {
      ...recipient,
      id: this.generateId('vr'),
      discoveredAt: new Date(),
      lastUpdated: new Date()
    };

    db.valueRecipients.push(newRecipient);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Value recipient added', { recipientId: newRecipient.id, name: newRecipient.name });
    return newRecipient;
  }

  /**
   * Add a boostagram
   */
  async addBoostagram(boostagram: Omit<BoostagramRecord, 'id' | 'discoveredAt' | 'lastUpdated'>): Promise<BoostagramRecord> {
    const db = await this.loadDatabase();
    
    const newBoostagram: BoostagramRecord = {
      ...boostagram,
      id: this.generateId('boost'),
      discoveredAt: new Date(),
      lastUpdated: new Date()
    };

    db.boostagrams.push(newBoostagram);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Boostagram added', { boostagramId: newBoostagram.id, amount: newBoostagram.amount });
    return newBoostagram;
  }

  // ============================================================================
  // EXTRACTION OPERATIONS
  // ============================================================================

  /**
   * Save extraction results
   */
  async saveExtractionResult(extraction: Omit<MusicTrackExtractionRecord, 'id' | 'extractedAt'>): Promise<MusicTrackExtractionRecord> {
    const db = await this.loadDatabase();
    
    const newExtraction: MusicTrackExtractionRecord = {
      ...extraction,
      id: this.generateId('extract'),
      extractedAt: new Date()
    };

    db.extractions.push(newExtraction);
    await this.saveDatabase();

          MusicTrackDatabaseService.logger.info('Extraction result saved', { 
      extractionId: newExtraction.id, 
      feedUrl: newExtraction.feedUrl,
      totalTracks: newExtraction.musicTracks.length
    });
    return newExtraction;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Get database statistics
   */
  async getStatistics(): Promise<{
    totalTracks: number;
    totalEpisodes: number;
    totalFeeds: number;
    totalExtractions: number;
    tracksWithV4V: number;
    tracksBySource: Record<string, number>;
    recentTracks: number;
  }> {
    const db = await this.loadDatabase();
    
    const tracksWithV4V = db.musicTracks.filter(track => !!track.valueForValue).length;
    const tracksBySource: Record<string, number> = {};
    
    db.musicTracks.forEach(track => {
      tracksBySource[track.source] = (tracksBySource[track.source] || 0) + 1;
    });

    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentTracks = db.musicTracks.filter(track => track.discoveredAt > oneWeekAgo).length;

    return {
      totalTracks: db.musicTracks.length,
      totalEpisodes: db.episodes.length,
      totalFeeds: db.feeds.length,
      totalExtractions: db.extractions.length,
      tracksWithV4V,
      tracksBySource,
      recentTracks
    };
  }

  /**
   * Clear the database cache
   */
  clearCache(): void {
    this.database = null;
    this.lastLoadTime = 0;
          MusicTrackDatabaseService.logger.info('Database cache cleared');
  }

  /**
   * Export database to JSON
   */
  async exportDatabase(): Promise<MusicTrackDatabase> {
    return await this.loadDatabase();
  }

  /**
   * Import database from JSON
   */
  async importDatabase(data: MusicTrackDatabase): Promise<void> {
    this.database = this.deserializeDates(data);
    await this.saveDatabase();
          MusicTrackDatabaseService.logger.info('Database imported successfully');
  }
}

// Export singleton instance
export const musicTrackDB = MusicTrackDatabaseService.getInstance();
export default musicTrackDB; 