import fs from 'fs';
import path from 'path';

// Persistent file-based cache for static playlists
export class PlaylistCache {
  private cacheDir: string;
  private isServerless: boolean;

  constructor() {
    // On Vercel/serverless, use /tmp (only writable directory)
    // Locally, use .next/cache/playlists
    this.isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    if (this.isServerless) {
      this.cacheDir = '/tmp/playlist-cache';
    } else {
      this.cacheDir = path.join(process.cwd(), '.next', 'cache', 'playlists');
    }

    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        console.log(`📁 Created playlist cache directory: ${this.cacheDir}`);
      }
    } catch (error) {
      // On serverless, /tmp might not be writable in some edge cases
      console.warn(`⚠️ Could not create cache directory ${this.cacheDir}:`, error);
    }
  }

  private getCacheFilePath(playlistId: string): string {
    return path.join(this.cacheDir, `${playlistId}.json`);
  }

  private getMetaFilePath(playlistId: string): string {
    return path.join(this.cacheDir, `${playlistId}.meta.json`);
  }

  // Check if cached data exists and is still valid
  public isCacheValid(playlistId: string, maxAgeMs: number = 24 * 60 * 60 * 1000): boolean {
    try {
      const metaPath = this.getMetaFilePath(playlistId);
      const cachePath = this.getCacheFilePath(playlistId);

      if (!fs.existsSync(metaPath) || !fs.existsSync(cachePath)) {
        return false;
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const age = Date.now() - meta.timestamp;
      
      return age < maxAgeMs;
    } catch (error) {
      console.error(`❌ Error checking cache validity for ${playlistId}:`, error);
      return false;
    }
  }

  // Get cached playlist data
  public getCachedData(playlistId: string): any | null {
    try {
      const cachePath = this.getCacheFilePath(playlistId);
      
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      console.log(`💾 Loaded ${playlistId} from persistent cache`);
      return data;
    } catch (error) {
      console.error(`❌ Error reading cache for ${playlistId}:`, error);
      return null;
    }
  }

  // Save playlist data to persistent cache
  public setCachedData(playlistId: string, data: any): void {
    try {
      const cachePath = this.getCacheFilePath(playlistId);
      const metaPath = this.getMetaFilePath(playlistId);

      // Save the data
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));

      // Save metadata
      const meta = {
        playlistId,
        timestamp: Date.now(),
        dataSize: JSON.stringify(data).length,
        trackCount: data.playlist?.items?.[0]?.tracks?.length || 0
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      console.log(`💾 Cached ${playlistId} to disk (${meta.trackCount} tracks, ${(meta.dataSize / 1024).toFixed(1)}KB)`);
    } catch (error) {
      console.error(`❌ Error saving cache for ${playlistId}:`, error);
    }
  }

  // Get cache statistics
  public getCacheStats(): { playlistId: string; timestamp: number; trackCount: number; dataSize: number }[] {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const metaFiles = files.filter(f => f.endsWith('.meta.json'));
      
      return metaFiles.map(file => {
        const metaPath = path.join(this.cacheDir, file);
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }).sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('❌ Error getting cache stats:', error);
      return [];
    }
  }

  // Clear cache for a specific playlist
  public clearCache(playlistId: string): void {
    try {
      const cachePath = this.getCacheFilePath(playlistId);
      const metaPath = this.getMetaFilePath(playlistId);

      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath);
      }

      console.log(`🗑️ Cleared cache for ${playlistId}`);
    } catch (error) {
      console.error(`❌ Error clearing cache for ${playlistId}:`, error);
    }
  }

  // Clear all playlist caches
  public clearAllCaches(): void {
    try {
      const files = fs.readdirSync(this.cacheDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(this.cacheDir, file));
      });
      console.log('🗑️ Cleared all playlist caches');
    } catch (error) {
      console.error('❌ Error clearing all caches:', error);
    }
  }
}

// Singleton instance
export const playlistCache = new PlaylistCache();