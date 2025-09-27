/**
 * Color cache utility for storing extracted dominant colors
 * Provides both in-memory and localStorage persistence
 */

interface ColorCacheEntry {
  originalColor: string;
  enhancedColor: string;
  contrastColors: {
    backgroundColor: string;
    textColor: string;
  };
  timestamp: number;
}

class ColorCache {
  private memoryCache = new Map<string, ColorCacheEntry>();
  private readonly STORAGE_KEY = 'extracted-colors-cache';
  private readonly MAX_CACHE_SIZE = 100; // Limit memory cache size
  private readonly CACHE_DURATION = 1000 * 60 * 60 * 24 * 7; // 7 days

  constructor() {
    this.loadFromStorage();
  }

  /**
   * Get cached color data for an image URL
   */
  get(imageUrl: string): ColorCacheEntry | null {
    if (!imageUrl) return null;

    const cacheKey = this.getCacheKey(imageUrl);
    const cached = this.memoryCache.get(cacheKey);

    if (cached && this.isValid(cached)) {
      if (process.env.NODE_ENV === 'development') {
        console.log('🎨 Using cached color for:', imageUrl);
      }
      return cached;
    }

    // Remove expired entry
    if (cached) {
      this.memoryCache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Store color data in cache
   */
  set(imageUrl: string, colorData: Omit<ColorCacheEntry, 'timestamp'>): void {
    if (!imageUrl) return;

    const cacheKey = this.getCacheKey(imageUrl);
    const entry: ColorCacheEntry = {
      ...colorData,
      timestamp: Date.now()
    };

    // Add to memory cache
    this.memoryCache.set(cacheKey, entry);

    // Limit memory cache size
    if (this.memoryCache.size > this.MAX_CACHE_SIZE) {
      this.evictOldest();
    }

    // Persist to localStorage (debounced)
    this.persistToStorage();

    if (process.env.NODE_ENV === 'development') {
      console.log('🎨 Cached color for:', imageUrl, 'Total cached:', this.memoryCache.size);
    }
  }

  /**
   * Clear expired entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (!this.isValid(entry)) {
        this.memoryCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} expired color cache entries`);
      this.persistToStorage();
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; memorySize: number } {
    return {
      size: this.memoryCache.size,
      memorySize: this.memoryCache.size
    };
  }

  private getCacheKey(imageUrl: string): string {
    // Normalize URL for consistent caching
    try {
      const url = new URL(imageUrl, window.location.origin);
      return url.href;
    } catch {
      return imageUrl;
    }
  }

  private isValid(entry: ColorCacheEntry): boolean {
    const age = Date.now() - entry.timestamp;
    return age < this.CACHE_DURATION;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
    }
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        const now = Date.now();

        for (const [key, entry] of Object.entries(data)) {
          const typedEntry = entry as ColorCacheEntry;
          if (this.isValid(typedEntry)) {
            this.memoryCache.set(key, typedEntry);
          }
        }

        if (process.env.NODE_ENV === 'development') {
          console.log(`🎨 Loaded ${this.memoryCache.size} cached colors from storage`);
        }
      }
    } catch (error) {
      console.warn('Failed to load color cache from storage:', error);
    }
  }

  private persistToStorage(): void {
    if (typeof window === 'undefined') return;

    // Debounce storage writes
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
    }

    this.persistTimeout = setTimeout(() => {
      try {
        const data: Record<string, ColorCacheEntry> = {};
        for (const [key, entry] of this.memoryCache.entries()) {
          if (this.isValid(entry)) {
            data[key] = entry;
          }
        }

        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      } catch (error) {
        console.warn('Failed to persist color cache to storage:', error);
      }
    }, 1000);
  }

  private persistTimeout: NodeJS.Timeout | null = null;
}

// Export singleton instance
export const colorCache = new ColorCache();

// Cleanup expired entries on initialization and periodically
if (typeof window !== 'undefined') {
  // Initial cleanup
  setTimeout(() => colorCache.cleanup(), 1000);

  // Periodic cleanup (every hour)
  setInterval(() => colorCache.cleanup(), 1000 * 60 * 60);
}