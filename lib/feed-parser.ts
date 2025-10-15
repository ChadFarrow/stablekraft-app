import { RSSParser, RSSAlbum, RSSPodRoll, RSSPublisher } from './rss-parser';
import { FeedManager, Feed } from './feed-manager';
import { logger } from './logger';
import fs from 'fs';
import path from 'path';

export interface ParsedFeedData {
  id: string;
  originalUrl: string;
  type: 'album' | 'publisher';
  title: string;
  priority: 'core' | 'extended' | 'low';
  status: 'active' | 'inactive';
  addedAt: string;
  lastUpdated: string;
  // Parsed content
  parsedData?: {
    album?: RSSAlbum;
    publisherInfo?: {
      title?: string;
      description?: string;
      artist?: string;
      coverArt?: string;
    };
    publisherItems?: Array<{
      feedGuid: string;
      feedUrl: string;
      medium: string;
      title?: string;
    }>;
  };
  // Metadata
  parseStatus: 'pending' | 'success' | 'error';
  parseError?: string;
  lastParsed?: string;
  trackCount?: number;
  duration?: string;
  hasPodRoll?: boolean;
  hasFunding?: boolean;
  categories?: string[];
  keywords?: string[];
}

export interface FeedParseReport {
  totalFeeds: number;
  successfulParses: number;
  failedParses: number;
  albumsFound: number;
  publishersFound: number;
  totalTracks: number;
  totalDuration: string;
  podRollFeeds: number;
  fundingFeeds: number;
  parseTime: number;
  timestamp: string;
  errors: Array<{
    feedId: string;
    feedUrl: string;
    error: string;
  }>;
}

export class FeedParser {
  private static readonly parsedDataPath = path.join(process.cwd(), 'data', 'parsed-feeds.json');
  private static readonly reportPath = path.join(process.cwd(), 'data', 'parse-reports');
  
  /**
   * Parse all active feeds and store the results
   */
  static async parseAllFeeds(): Promise<FeedParseReport> {
    const startTime = Date.now();
    const feeds = FeedManager.getActiveFeeds();
    const parsedFeeds: ParsedFeedData[] = [];
    const errors: Array<{ feedId: string; feedUrl: string; error: string }> = [];
    
    logger.info(`🔄 Starting to parse ${feeds.length} active feeds...`);
    
    for (const feed of feeds) {
      try {
        logger.info(`📡 Parsing feed: ${feed.title} (${feed.originalUrl})`);
        
        const parsedData: ParsedFeedData = {
          ...feed,
          parseStatus: 'pending',
          lastParsed: new Date().toISOString()
        };
        
        if (feed.type === 'album') {
          // Parse album feed
          const album = await RSSParser.parseAlbumFeed(feed.originalUrl);
          if (album) {
            parsedData.parsedData = { album };
            parsedData.parseStatus = 'success';
            parsedData.trackCount = album.tracks.length;
            parsedData.duration = album.duration;
            parsedData.hasPodRoll = album.podroll && album.podroll.length > 0;
            parsedData.hasFunding = album.funding && album.funding.length > 0;
            parsedData.categories = album.categories;
            parsedData.keywords = album.keywords;
          } else {
            parsedData.parseStatus = 'error';
            parsedData.parseError = 'No album data found';
            errors.push({
              feedId: feed.id,
              feedUrl: feed.originalUrl,
              error: 'No album data found'
            });
          }
                 } else if (feed.type === 'publisher') {
           // Parse publisher feed
           try {
             const publisherData = await RSSParser.parsePublisherFeed(feed.originalUrl);

             parsedData.parsedData = {
               publisherInfo: publisherData.publisherInfo,
               publisherItems: publisherData.remoteItems
             };
             parsedData.parseStatus = 'success';
           } catch (error) {
             parsedData.parseStatus = 'error';
             parsedData.parseError = error instanceof Error ? error.message : 'Unknown error';
             errors.push({
               feedId: feed.id,
               feedUrl: feed.originalUrl,
               error: parsedData.parseError
             });
           }
         }
        
        parsedFeeds.push(parsedData);
        
        // Add small delay to avoid overwhelming servers
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error parsing feed ${feed.id}:`, error);
        const parsedData: ParsedFeedData = {
          ...feed,
          parseStatus: 'error',
          parseError: error instanceof Error ? error.message : 'Unknown error',
          lastParsed: new Date().toISOString()
        };
        parsedFeeds.push(parsedData);
        errors.push({
          feedId: feed.id,
          feedUrl: feed.originalUrl,
          error: parsedData.parseError || 'Unknown error'
        });
      }
    }
    
    // Save parsed data
    await this.saveParsedFeeds(parsedFeeds);
    
    // Generate and save report
    const report = this.generateReport(parsedFeeds, errors, Date.now() - startTime);
    await this.saveParseReport(report);
    
    logger.info(`✅ Feed parsing completed!`);
    logger.info(`📊 Report: ${report.successfulParses}/${report.totalFeeds} feeds parsed successfully`);
    logger.info(`🎵 Found ${report.albumsFound} albums with ${report.totalTracks} tracks`);
    logger.info(`🏢 Found ${report.publishersFound} publishers`);
    logger.info(`⏱️ Total parse time: ${(report.parseTime / 1000).toFixed(2)}s`);
    
    return report;
  }
  
  /**
   * Parse a specific feed by ID
   */
  static async parseFeedById(feedId: string): Promise<ParsedFeedData | null> {
    const feeds = FeedManager.getActiveFeeds();
    const feed = feeds.find(f => f.id === feedId);
    
    if (!feed) {
      throw new Error(`Feed with ID '${feedId}' not found`);
    }
    
    const parsedData: ParsedFeedData = {
      ...feed,
      parseStatus: 'pending',
      lastParsed: new Date().toISOString()
    };
    
    try {
      if (feed.type === 'album') {
        const album = await RSSParser.parseAlbumFeed(feed.originalUrl);
        if (album) {
          parsedData.parsedData = { album };
          parsedData.parseStatus = 'success';
          parsedData.trackCount = album.tracks.length;
          parsedData.duration = album.duration;
          parsedData.hasPodRoll = album.podroll && album.podroll.length > 0;
          parsedData.hasFunding = album.funding && album.funding.length > 0;
          parsedData.categories = album.categories;
          parsedData.keywords = album.keywords;
        } else {
          parsedData.parseStatus = 'error';
          parsedData.parseError = 'No album data found';
        }
             } else if (feed.type === 'publisher') {
         const publisherData = await RSSParser.parsePublisherFeed(feed.originalUrl);

         parsedData.parsedData = {
           publisherInfo: publisherData.publisherInfo,
           publisherItems: publisherData.remoteItems
         };
         parsedData.parseStatus = 'success';
       }
      
      // Update the stored parsed feeds
      await this.updateParsedFeed(parsedData);
      
      return parsedData;
    } catch (error) {
      parsedData.parseStatus = 'error';
      parsedData.parseError = error instanceof Error ? error.message : 'Unknown error';
      await this.updateParsedFeed(parsedData);
      throw error;
    }
  }
  
  /**
   * Get all parsed feed data
   */
  static getParsedFeeds(): ParsedFeedData[] {
    try {
      if (!fs.existsSync(this.parsedDataPath)) {
        return [];
      }
      const content = fs.readFileSync(this.parsedDataPath, 'utf-8');
      const data = JSON.parse(content);
      // Handle both array format and object with feeds property
      return Array.isArray(data) ? data : (data.feeds || []);
    } catch (error) {
      console.error('Error reading parsed feeds:', error);
      return [];
    }
  }
  
  /**
   * Get parsed feed by ID
   */
  static getParsedFeedById(feedId: string): ParsedFeedData | null {
    const parsedFeeds = this.getParsedFeeds();
    return parsedFeeds.find(feed => feed.id === feedId) || null;
  }
  
  /**
   * Get all successfully parsed albums
   */
  static getParsedAlbums(): RSSAlbum[] {
    const parsedFeeds = this.getParsedFeeds();
    return parsedFeeds
      .filter(feed => feed.type === 'album' && feed.parseStatus === 'success' && feed.parsedData?.album)
      .map(feed => feed.parsedData!.album!)
      .filter(Boolean);
  }
  
  /**
   * Get albums by priority
   */
  static getAlbumsByPriority(priority: 'core' | 'extended' | 'low'): RSSAlbum[] {
    const parsedFeeds = this.getParsedFeeds();
    return parsedFeeds
      .filter(feed => 
        feed.type === 'album' && 
        feed.priority === priority && 
        feed.parseStatus === 'success' && 
        feed.parsedData?.album
      )
      .map(feed => feed.parsedData!.album!)
      .filter(Boolean);
  }
  
  /**
   * Get albums with PodRoll data
   */
  static getAlbumsWithPodRoll(): RSSAlbum[] {
    const parsedFeeds = this.getParsedFeeds();
    return parsedFeeds
      .filter(feed => 
        feed.type === 'album' && 
        feed.parseStatus === 'success' && 
        feed.hasPodRoll && 
        feed.parsedData?.album
      )
      .map(feed => feed.parsedData!.album!)
      .filter(Boolean);
  }
  
  /**
   * Get albums with funding data
   */
  static getAlbumsWithFunding(): RSSAlbum[] {
    const parsedFeeds = this.getParsedFeeds();
    return parsedFeeds
      .filter(feed => 
        feed.type === 'album' && 
        feed.parseStatus === 'success' && 
        feed.hasFunding && 
        feed.parsedData?.album
      )
      .map(feed => feed.parsedData!.album!)
      .filter(Boolean);
  }
  
  /**
   * Search albums by title or artist
   */
  static searchAlbums(query: string): RSSAlbum[] {
    const albums = this.getParsedAlbums();
    const lowerQuery = query.toLowerCase();
    
    return albums.filter(album => 
      album.title.toLowerCase().includes(lowerQuery) ||
      album.artist.toLowerCase().includes(lowerQuery) ||
      (album.description && album.description.toLowerCase().includes(lowerQuery))
    );
  }
  
  /**
   * Get parse statistics
   */
  static getParseStats(): {
    totalFeeds: number;
    successfulParses: number;
    failedParses: number;
    albumsFound: number;
    publishersFound: number;
    totalTracks: number;
    podRollFeeds: number;
    fundingFeeds: number;
  } {
    const parsedData = this.getParsedFeeds();
    const parsedFeeds: ParsedFeedData[] = Array.isArray(parsedData) ? parsedData : (parsedData as any).feeds || [];
    
    return {
      totalFeeds: parsedFeeds.length,
      successfulParses: parsedFeeds.filter((f: ParsedFeedData) => f.parseStatus === 'success').length,
      failedParses: parsedFeeds.filter((f: ParsedFeedData) => f.parseStatus === 'error').length,
      albumsFound: parsedFeeds.filter((f: ParsedFeedData) => f.type === 'album' && f.parseStatus === 'success').length,
      publishersFound: parsedFeeds.filter((f: ParsedFeedData) => f.type === 'publisher' && f.parseStatus === 'success').length,
      totalTracks: parsedFeeds.reduce((sum: number, f: ParsedFeedData) => sum + (f.trackCount || 0), 0),
      podRollFeeds: parsedFeeds.filter((f: ParsedFeedData) => f.hasPodRoll).length,
      fundingFeeds: parsedFeeds.filter((f: ParsedFeedData) => f.hasFunding).length
    };
  }
  
  /**
   * Save parsed feeds to file
   */
  private static async saveParsedFeeds(parsedFeeds: ParsedFeedData[]): Promise<void> {
    try {
      const data = {
        feeds: parsedFeeds,
        lastUpdated: new Date().toISOString(),
        version: 1
      };
      
      // Ensure directory exists
      const dir = path.dirname(this.parsedDataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.parsedDataPath, JSON.stringify(data, null, 2));
      logger.info(`💾 Saved parsed feeds to ${this.parsedDataPath}`);
    } catch (error) {
      console.error('Error saving parsed feeds:', error);
      throw error;
    }
  }
  
  /**
   * Update a single parsed feed
   */
  private static async updateParsedFeed(updatedFeed: ParsedFeedData): Promise<void> {
    const parsedFeeds = this.getParsedFeeds();
    const index = parsedFeeds.findIndex(f => f.id === updatedFeed.id);
    
    if (index !== -1) {
      parsedFeeds[index] = updatedFeed;
    } else {
      parsedFeeds.push(updatedFeed);
    }
    
    await this.saveParsedFeeds(parsedFeeds);
  }
  
  /**
   * Generate parse report
   */
  private static generateReport(
    parsedFeeds: ParsedFeedData[], 
    errors: Array<{ feedId: string; feedUrl: string; error: string }>,
    parseTime: number
  ): FeedParseReport {
    const successfulParses = parsedFeeds.filter(f => f.parseStatus === 'success').length;
    const albumsFound = parsedFeeds.filter(f => f.type === 'album' && f.parseStatus === 'success').length;
    const publishersFound = parsedFeeds.filter(f => f.type === 'publisher' && f.parseStatus === 'success').length;
    const totalTracks = parsedFeeds.reduce((sum, f) => sum + (f.trackCount || 0), 0);
    const podRollFeeds = parsedFeeds.filter(f => f.hasPodRoll).length;
    const fundingFeeds = parsedFeeds.filter(f => f.hasFunding).length;
    
    // Calculate total duration
    const totalDurationMs = parsedFeeds.reduce((sum, f) => {
      if (f.duration) {
        const parts = f.duration.split(':').map(Number);
        if (parts.length === 3) {
          return sum + (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        } else if (parts.length === 2) {
          return sum + (parts[0] * 60 + parts[1]) * 1000;
        }
      }
      return sum;
    }, 0);
    
    const totalDuration = this.formatDuration(totalDurationMs);
    
    return {
      totalFeeds: parsedFeeds.length,
      successfulParses,
      failedParses: parsedFeeds.length - successfulParses,
      albumsFound,
      publishersFound,
      totalTracks,
      totalDuration,
      podRollFeeds,
      fundingFeeds,
      parseTime,
      timestamp: new Date().toISOString(),
      errors
    };
  }
  
  /**
   * Save parse report
   */
  private static async saveParseReport(report: FeedParseReport): Promise<void> {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.reportPath)) {
        fs.mkdirSync(this.reportPath, { recursive: true });
      }
      
      const filename = `parse-report-${new Date().toISOString().split('T')[0]}-${Date.now()}.json`;
      const filepath = path.join(this.reportPath, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
      logger.info(`📊 Saved parse report to ${filepath}`);
    } catch (error) {
      console.error('Error saving parse report:', error);
    }
  }
  
  /**
   * Format duration from milliseconds to HH:MM:SS
   */
  private static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
  }
} 