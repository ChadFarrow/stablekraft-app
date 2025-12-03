import { FeedParser, ParsedFeedData } from './feed-parser';
import { RSSAlbum } from './rss-parser';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { isGifBuffer, isLargeGif, convertGifBufferToVideo, checkFfmpegAvailability, GIF_SIZE_THRESHOLD } from './gif-to-video';

export interface CacheItem {
  id: string;
  originalUrl: string;
  cachedUrl: string;
  type: 'artwork' | 'audio';
  size: number;
  mimeType: string;
  lastAccessed: string;
  createdAt: string;
  checksum?: string;
  albumId?: string;
  trackNumber?: number;
  // Video conversion paths for large GIFs
  videoMp4?: string;
  videoWebm?: string;
  isConvertedGif?: boolean;
}

export interface CacheStats {
  totalItems: number;
  totalSize: number;
  artworkCount: number;
  audioCount: number;
  oldestItem: string;
  newestItem: string;
  cacheHitRate: number;
  lastCleanup: string;
}

export interface CacheConfig {
  maxSize: number; // in bytes
  maxAge: number; // in days
  enableCompression: boolean;
  enableResize: boolean;
  maxImageSize: number; // in pixels
  audioQuality: 'high' | 'medium' | 'low';
}

export class FeedCache {
  private static readonly cacheDir = path.join(process.cwd(), 'data', 'cache');
  private static readonly artworkDir = path.join(this.cacheDir, 'artwork');
  private static readonly audioDir = path.join(this.cacheDir, 'audio');
  private static readonly videoDir = path.join(this.cacheDir, 'video');
  private static readonly metadataFile = path.join(this.cacheDir, 'cache-metadata.json');
  private static readonly statsFile = path.join(this.cacheDir, 'cache-stats.json');
  private static ffmpegAvailable: boolean | null = null;
  
  private static config: CacheConfig = {
    maxSize: 10 * 1024 * 1024 * 1024, // 10GB
    maxAge: 30, // 30 days
    enableCompression: true,
    enableResize: true,
    maxImageSize: 1024,
    audioQuality: 'medium'
  };

  /**
   * Initialize cache directories and metadata
   */
  static async initialize(): Promise<void> {
    try {
      // Create cache directories
      await this.ensureDirectory(this.cacheDir);
      await this.ensureDirectory(this.artworkDir);
      await this.ensureDirectory(this.audioDir);
      await this.ensureDirectory(this.videoDir);

      // Check FFmpeg availability for GIF-to-video conversion
      if (this.ffmpegAvailable === null) {
        this.ffmpegAvailable = await checkFfmpegAvailability();
        if (this.ffmpegAvailable) {
          console.log('✅ FFmpeg is available for GIF-to-video conversion');
        } else {
          console.log('⚠️ FFmpeg not available - large GIFs will not be converted to video');
        }
      }

      // Initialize metadata if it doesn't exist
      if (!fs.existsSync(this.metadataFile)) {
        await this.saveMetadata([]);
      }

      // Initialize stats if it doesn't exist
      if (!fs.existsSync(this.statsFile)) {
        await this.saveStats({
          totalItems: 0,
          totalSize: 0,
          artworkCount: 0,
          audioCount: 0,
          oldestItem: new Date().toISOString(),
          newestItem: new Date().toISOString(),
          cacheHitRate: 0,
          lastCleanup: new Date().toISOString()
        });
      }

      console.log('✅ Cache system initialized');
    } catch (error) {
      console.error('❌ Error initializing cache:', error);
      throw error;
    }
  }

  /**
   * Cache all artwork and audio from parsed feeds
   */
  static async cacheAllFeeds(): Promise<{
    totalProcessed: number;
    artworkCached: number;
    audioCached: number;
    errors: Array<{ url: string; error: string }>;
  }> {
    await this.initialize();
    
    const parsedData = FeedParser.getParsedFeeds();
    const parsedFeeds: ParsedFeedData[] = Array.isArray(parsedData) ? parsedData : (parsedData as any).feeds || [];
    const errors: Array<{ url: string; error: string }> = [];
    let artworkCached = 0;
    let audioCached = 0;

    console.log(`🔄 Starting to cache ${parsedFeeds.length} feeds...`);

    for (const feed of parsedFeeds) {
      if (feed.type === 'album' && feed.parsedData?.album) {
        const album = feed.parsedData.album;
        
        try {
          // Cache album artwork
          if (album.coverArt) {
            const cached = await this.cacheArtwork(album.coverArt, feed.id);
            if (cached) artworkCached++;
          }

          // Cache track artwork and audio
          for (const track of album.tracks) {
            if (track.image) {
              const cached = await this.cacheArtwork(track.image, feed.id, track.trackNumber);
              if (cached) artworkCached++;
            }

            if (track.url) {
              const cached = await this.cacheAudio(track.url, feed.id, track.trackNumber);
              if (cached) audioCached++;
            }
          }
        } catch (error) {
          errors.push({
            url: feed.originalUrl,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    // Update cache stats
    await this.updateStats();

    console.log(`✅ Caching completed: ${artworkCached} artwork, ${audioCached} audio files`);
    
    return {
      totalProcessed: parsedFeeds.length,
      artworkCached,
      audioCached,
      errors
    };
  }

  /**
   * Cache a single artwork file
   * Automatically converts large GIFs to video formats if FFmpeg is available
   */
  static async cacheArtwork(
    originalUrl: string,
    albumId: string,
    trackNumber?: number
  ): Promise<boolean> {
    try {
      const cacheId = this.generateCacheId(originalUrl, 'artwork', albumId, trackNumber);
      const cachedPath = path.join(this.artworkDir, `${cacheId}.jpg`);

      // Check if already cached
      if (fs.existsSync(cachedPath)) {
        await this.updateAccessTime(cacheId);
        return true;
      }

      // Download and process image
      const response = await fetch(originalUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(buffer);

      // Check if this is a large GIF that should be converted to video
      const isLargeGifFile = isLargeGif(imageBuffer, GIF_SIZE_THRESHOLD);
      let videoMp4Path: string | undefined;
      let videoWebmPath: string | undefined;
      let isConvertedGif = false;

      if (isLargeGifFile && this.ffmpegAvailable) {
        try {
          console.log(`🎬 Large GIF detected (${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB), converting to video...`);

          // Convert GIF to video formats
          const conversionResult = await convertGifBufferToVideo(
            imageBuffer,
            cacheId,
            this.videoDir
          );

          videoMp4Path = `/api/cache/video/${cacheId}.mp4`;
          videoWebmPath = `/api/cache/video/${cacheId}.webm`;
          isConvertedGif = true;

          console.log(`✅ GIF converted to video: MP4 ${(conversionResult.mp4Size / 1024 / 1024).toFixed(2)}MB, WebM ${(conversionResult.webmSize / 1024 / 1024).toFixed(2)}MB`);
        } catch (conversionError) {
          console.warn(`⚠️ Failed to convert GIF to video, keeping original:`, conversionError);
        }
      }

      // Process image (resize, compress) - for GIFs, keep original format
      let processedBuffer: Buffer;
      let mimeType: string;
      let extension: string;

      if (isGifBuffer(imageBuffer)) {
        // Keep GIF as-is (even if not converted to video, we need the GIF as fallback)
        processedBuffer = imageBuffer;
        mimeType = 'image/gif';
        extension = 'gif';
      } else {
        processedBuffer = await this.processImage(imageBuffer);
        mimeType = 'image/jpeg';
        extension = 'jpg';
      }

      // Save to cache with correct extension
      const finalCachedPath = path.join(this.artworkDir, `${cacheId}.${extension}`);
      fs.writeFileSync(finalCachedPath, processedBuffer);

      // Update metadata
      await this.addCacheItem({
        id: cacheId,
        originalUrl,
        cachedUrl: `/api/cache/artwork/${cacheId}.${extension}`,
        type: 'artwork',
        size: processedBuffer.length,
        mimeType,
        lastAccessed: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        albumId,
        trackNumber,
        videoMp4: videoMp4Path,
        videoWebm: videoWebmPath,
        isConvertedGif,
      });

      console.log(`🖼️ Cached artwork: ${originalUrl}${isConvertedGif ? ' (with video conversion)' : ''}`);
      return true;

    } catch (error) {
      console.error(`❌ Error caching artwork ${originalUrl}:`, error);
      return false;
    }
  }

  /**
   * Cache a single audio file
   */
  static async cacheAudio(
    originalUrl: string, 
    albumId: string, 
    trackNumber?: number
  ): Promise<boolean> {
    try {
      const cacheId = this.generateCacheId(originalUrl, 'audio', albumId, trackNumber);
      const cachedPath = path.join(this.audioDir, `${cacheId}.mp3`);
      
      // Check if already cached
      if (fs.existsSync(cachedPath)) {
        await this.updateAccessTime(cacheId);
        return true;
      }

      // Download audio file
      const response = await fetch(originalUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Download and save file
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(cachedPath, Buffer.from(buffer));

      // Get file size
      const stats = fs.statSync(cachedPath);

      // Update metadata
      await this.addCacheItem({
        id: cacheId,
        originalUrl,
        cachedUrl: `/api/cache/audio/${cacheId}.mp3`,
        type: 'audio',
        size: stats.size,
        mimeType: 'audio/mpeg',
        lastAccessed: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        albumId,
        trackNumber
      });

      console.log(`🎵 Cached audio: ${originalUrl}`);
      return true;

    } catch (error) {
      console.error(`❌ Error caching audio ${originalUrl}:`, error);
      return false;
    }
  }

  /**
   * Get cached file URL
   */
  static getCachedUrl(originalUrl: string, type: 'artwork' | 'audio', albumId: string, trackNumber?: number): string | null {
    const cacheId = this.generateCacheId(originalUrl, type, albumId, trackNumber);
    const extension = type === 'artwork' ? 'jpg' : 'mp3';
    const cachedPath = path.join(type === 'artwork' ? this.artworkDir : this.audioDir, `${cacheId}.${extension}`);

    if (fs.existsSync(cachedPath)) {
      this.updateAccessTime(cacheId).catch(console.error);
      return `/api/cache/${type}/${cacheId}.${extension}`;
    }

    return null;
  }

  /**
   * Check if a GIF has video conversions available
   * Returns video paths if available, null otherwise
   */
  static async getVideoForGif(gifUrl: string): Promise<{ mp4: string; webm: string } | null> {
    try {
      const metadata = await this.getMetadata();

      // Find cache item by original URL
      const item = metadata.find(m => m.originalUrl === gifUrl && m.isConvertedGif);

      if (item && item.videoMp4 && item.videoWebm) {
        // Verify video files actually exist
        const mp4Filename = item.videoMp4.split('/').pop();
        const webmFilename = item.videoWebm.split('/').pop();

        if (mp4Filename && webmFilename) {
          const mp4Path = path.join(this.videoDir, mp4Filename);
          const webmPath = path.join(this.videoDir, webmFilename);

          if (fs.existsSync(mp4Path) && fs.existsSync(webmPath)) {
            return {
              mp4: item.videoMp4,
              webm: item.videoWebm,
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('Error checking video for GIF:', error);
      return null;
    }
  }

  /**
   * Get video file path by filename
   */
  static getVideoFilePath(filename: string): string | null {
    const videoPath = path.join(this.videoDir, filename);
    if (fs.existsSync(videoPath)) {
      return videoPath;
    }
    return null;
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): CacheStats {
    try {
      if (!fs.existsSync(this.statsFile)) {
        return {
          totalItems: 0,
          totalSize: 0,
          artworkCount: 0,
          audioCount: 0,
          oldestItem: new Date().toISOString(),
          newestItem: new Date().toISOString(),
          cacheHitRate: 0,
          lastCleanup: new Date().toISOString()
        };
      }
      
      const content = fs.readFileSync(this.statsFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Error reading cache stats:', error);
      return {
        totalItems: 0,
        totalSize: 0,
        artworkCount: 0,
        audioCount: 0,
        oldestItem: new Date().toISOString(),
        newestItem: new Date().toISOString(),
        cacheHitRate: 0,
        lastCleanup: new Date().toISOString()
      };
    }
  }

  /**
   * Clean up old cache items
   */
  static async cleanupCache(): Promise<{
    removedItems: number;
    freedSpace: number;
  }> {
    const metadata = await this.getMetadata();
    const now = new Date();
    const maxAgeMs = this.config.maxAge * 24 * 60 * 60 * 1000;
    
    let removedItems = 0;
    let freedSpace = 0;

    for (const item of metadata) {
      const lastAccessed = new Date(item.lastAccessed);
      const ageMs = now.getTime() - lastAccessed.getTime();
      
      if (ageMs > maxAgeMs) {
        const extension = item.type === 'artwork' ? 'jpg' : 'mp3';
        const dir = item.type === 'artwork' ? this.artworkDir : this.audioDir;
        const filePath = path.join(dir, `${item.id}.${extension}`);
        
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          fs.unlinkSync(filePath);
          freedSpace += stats.size;
          removedItems++;
        }
      }
    }

    // Remove from metadata
    const updatedMetadata = metadata.filter(item => {
      const lastAccessed = new Date(item.lastAccessed);
      const ageMs = now.getTime() - lastAccessed.getTime();
      return ageMs <= maxAgeMs;
    });

    await this.saveMetadata(updatedMetadata);
    await this.updateStats();

    console.log(`🧹 Cache cleanup: removed ${removedItems} items, freed ${(freedSpace / 1024 / 1024).toFixed(2)}MB`);
    
    return { removedItems, freedSpace };
  }

  /**
   * Clear entire cache
   */
  static async clearCache(): Promise<void> {
    try {
      // Remove all files
      const artworkFiles = fs.readdirSync(this.artworkDir);
      const audioFiles = fs.readdirSync(this.audioDir);
      
      for (const file of artworkFiles) {
        fs.unlinkSync(path.join(this.artworkDir, file));
      }
      
      for (const file of audioFiles) {
        fs.unlinkSync(path.join(this.audioDir, file));
      }

      // Reset metadata and stats
      await this.saveMetadata([]);
      await this.saveStats({
        totalItems: 0,
        totalSize: 0,
        artworkCount: 0,
        audioCount: 0,
        oldestItem: new Date().toISOString(),
        newestItem: new Date().toISOString(),
        cacheHitRate: 0,
        lastCleanup: new Date().toISOString()
      });

      console.log('🗑️ Cache cleared');
    } catch (error) {
      console.error('Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Generate cache ID from URL and metadata
   */
  private static generateCacheId(
    url: string, 
    type: 'artwork' | 'audio', 
    albumId: string, 
    trackNumber?: number
  ): string {
    const urlHash = Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    const trackSuffix = trackNumber ? `-track${trackNumber}` : '';
    return `${type}-${albumId}-${urlHash}${trackSuffix}`;
  }

  /**
   * Process image (resize, compress)
   */
  private static async processImage(buffer: Buffer): Promise<Buffer> {
    // For now, return the original buffer
    // TODO: Implement image processing with sharp or similar library
    return buffer;
  }

  /**
   * Ensure directory exists
   */
  private static async ensureDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Get metadata
   */
  private static async getMetadata(): Promise<CacheItem[]> {
    try {
      if (!fs.existsSync(this.metadataFile)) {
        return [];
      }
      const content = fs.readFileSync(this.metadataFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Error reading cache metadata:', error);
      return [];
    }
  }

  /**
   * Save metadata
   */
  private static async saveMetadata(metadata: CacheItem[]): Promise<void> {
    fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));
  }

  /**
   * Add cache item to metadata
   */
  private static async addCacheItem(item: CacheItem): Promise<void> {
    const metadata = await this.getMetadata();
    const existingIndex = metadata.findIndex(m => m.id === item.id);
    
    if (existingIndex !== -1) {
      metadata[existingIndex] = item;
    } else {
      metadata.push(item);
    }
    
    await this.saveMetadata(metadata);
  }

  /**
   * Update access time for cache item
   */
  private static async updateAccessTime(cacheId: string): Promise<void> {
    const metadata = await this.getMetadata();
    const item = metadata.find(m => m.id === cacheId);
    
    if (item) {
      item.lastAccessed = new Date().toISOString();
      await this.saveMetadata(metadata);
    }
  }

  /**
   * Save cache stats
   */
  private static async saveStats(stats: CacheStats): Promise<void> {
    fs.writeFileSync(this.statsFile, JSON.stringify(stats, null, 2));
  }

  /**
   * Update cache statistics
   */
  private static async updateStats(): Promise<void> {
    const metadata = await this.getMetadata();
    const artworkItems = metadata.filter(item => item.type === 'artwork');
    const audioItems = metadata.filter(item => item.type === 'audio');
    
    const totalSize = metadata.reduce((sum, item) => sum + item.size, 0);
    const oldestItem = metadata.length > 0 ? 
      metadata.reduce((oldest, item) => 
        new Date(item.createdAt) < new Date(oldest.createdAt) ? item : oldest
      ).createdAt : new Date().toISOString();
    const newestItem = metadata.length > 0 ? 
      metadata.reduce((newest, item) => 
        new Date(item.createdAt) > new Date(newest.createdAt) ? item : newest
      ).createdAt : new Date().toISOString();

    const stats: CacheStats = {
      totalItems: metadata.length,
      totalSize,
      artworkCount: artworkItems.length,
      audioCount: audioItems.length,
      oldestItem,
      newestItem,
      cacheHitRate: 0, // TODO: Implement hit rate tracking
      lastCleanup: new Date().toISOString()
    };

    await this.saveStats(stats);
  }
} 