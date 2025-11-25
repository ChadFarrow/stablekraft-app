import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface PodcastIndexFeed {
  id: number;
  title: string;
  url: string;
  originalUrl: string;
  link: string;
  description: string;
  author: string;
  ownerName: string;
  image: string;
  artwork: string;
  lastUpdateTime: number;
  lastCrawlTime: number;
  lastParseTime: number;
  lastGoodHttpStatusTime: number;
  lastHttpStatus: number;
  contentType: string;
  itunesId?: number;
  language: string;
  explicit: boolean;
  type: number;
  medium: string;
  dead: number;
  chash: string;
  episodeCount: number;
  crawlErrors: number;
  parseErrors: number;
  categories: { [key: string]: string };
  locked: number;
  imageUrlHash: number;
  value: any;
}

interface PodcastIndexEpisode {
  id: number;
  title: string;
  link: string;
  description: string;
  guid: string;
  datePublished: number;
  datePublishedPretty: string;
  dateCrawled: number;
  enclosureUrl: string;
  enclosureType: string;
  enclosureLength: number;
  duration: number;
  explicit: number;
  episode?: number;
  episodeType: string;
  season?: number;
  image: string;
  feedItunesId?: number;
  feedImage: string;
  feedId: number;
  feedTitle: string;
  feedLanguage: string;
  chaptersUrl?: string;
  transcriptUrl?: string;
  value?: any;
  soundbite?: any;
  soundbites?: any[];
}

class PodcastIndexAPI {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://api.podcastindex.org/api/1.0';

  constructor() {
    // Load environment variables from .env.local if not already loaded
    if (!process.env.PODCAST_INDEX_API_KEY) {
      this.loadEnvFile();
    }
    
    this.apiKey = process.env.PODCAST_INDEX_API_KEY || '';
    this.apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';
    
    if (!this.apiKey || !this.apiSecret) {
      console.warn('Podcast Index API credentials not found in environment variables');
      console.warn('API Key exists:', !!this.apiKey);
      console.warn('API Secret exists:', !!this.apiSecret);
    } else {
      console.log('✅ Podcast Index API credentials loaded successfully');
    }
  }

  private loadEnvFile() {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
          const trimmedLine = line.trim();
          if (trimmedLine && !trimmedLine.startsWith('#')) {
            const [key, ...valueParts] = trimmedLine.split('=');
            if (key && valueParts.length > 0 && !process.env[key.trim()]) {
              const value = valueParts.join('=').replace(/^["']|["']$/g, '').trim();
              process.env[key.trim()] = value;
            }
          }
        });
        console.log('📁 Loaded environment variables from .env.local');
      } else {
        // File doesn't exist - this is normal in production
        // Environment variables should be set directly
      }
    } catch (error) {
      // Only warn if it's not a "file not found" error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to load .env.local file:', error);
      }
    }
  }

  private getAuthHeaders(): { [key: string]: string } {
    const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
    const hash = crypto
      .createHash('sha1')
      .update(this.apiKey + this.apiSecret + apiHeaderTime)
      .digest('hex');

    return {
      'X-Auth-Date': apiHeaderTime,
      'X-Auth-Key': this.apiKey,
      'Authorization': hash,
      'User-Agent': 'StableKraft/1.0'
    };
  }

  async getFeedByGuid(guid: string): Promise<PodcastIndexFeed | null> {
    try {
      const url = `${this.baseUrl}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        console.error(`Podcast Index API error for feed ${guid}: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();

      if (data.status === 'true' && data.feed) {
        return data.feed as PodcastIndexFeed;
      }

      console.warn(`No feed found for GUID: ${guid}`);
      return null;
    } catch (error) {
      console.error(`Error fetching feed by GUID ${guid}:`, error);
      return null;
    }
  }

  /**
   * Get feed by URL, preferring the newest entry (highest ID) when duplicates exist
   */
  async getFeedByUrl(feedUrl: string): Promise<PodcastIndexFeed | null> {
    try {
      // Try exact URL match first
      const url = `${this.baseUrl}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        console.error(`Podcast Index API error for URL ${feedUrl}: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.status === 'true' && data.feed) {
        const feed = data.feed as PodcastIndexFeed;

        // Search for duplicate feeds with similar URLs (URL encoding differences)
        const duplicates = await this.searchForDuplicateFeeds(feed.title, feedUrl);

        if (duplicates.length > 1) {
          // Sort by ID descending and pick the newest
          duplicates.sort((a, b) => b.id - a.id);
          const newest = duplicates[0];

          if (newest.id !== feed.id) {
            console.log(`🔄 Found newer feed entry: ID ${newest.id} vs ${feed.id}, using newer`);
            // Fetch full feed data by ID to get complete info including value
            return this.getFeedById(newest.id);
          }
        }

        return feed;
      }

      console.warn(`No feed found for URL: ${feedUrl}`);
      return null;
    } catch (error) {
      console.error(`Error fetching feed by URL ${feedUrl}:`, error);
      return null;
    }
  }

  /**
   * Get feed by ID (internal helper to fetch full feed data)
   */
  async getFeedById(id: number): Promise<PodcastIndexFeed | null> {
    try {
      const url = `${this.baseUrl}/podcasts/byfeedid?id=${id}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.status === 'true' && data.feed ? data.feed : null;
    } catch (error) {
      console.error(`Error fetching feed by ID ${id}:`, error);
      return null;
    }
  }

  /**
   * Search for duplicate feeds by title to find all entries for the same content
   */
  private async searchForDuplicateFeeds(title: string, originalUrl: string): Promise<PodcastIndexFeed[]> {
    try {
      // Extract the base filename without URL encoding differences
      const urlPath = new URL(originalUrl).pathname;
      const filename = urlPath.split('/').pop()?.replace(/%20/g, ' ').replace(/\s+/g, ' ') || '';

      // Search by title
      const searchUrl = `${this.baseUrl}/search/byterm?q=${encodeURIComponent(title)}`;
      const response = await fetch(searchUrl, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();

      if (data.status === 'true' && data.feeds) {
        // Filter to feeds with matching title and similar URL path
        const matches = (data.feeds as PodcastIndexFeed[]).filter(feed => {
          if (feed.title !== title) return false;

          // Check if URLs are similar (same path, different encoding)
          try {
            const feedPath = new URL(feed.url).pathname;
            const feedFilename = feedPath.split('/').pop()?.replace(/%20/g, ' ').replace(/\s+/g, ' ') || '';
            return feedFilename === filename;
          } catch {
            return false;
          }
        });

        if (matches.length > 1) {
          console.log(`📋 Found ${matches.length} duplicate entries for "${title}": IDs ${matches.map(f => f.id).join(', ')}`);
        }

        return matches;
      }

      return [];
    } catch (error) {
      console.error('Error searching for duplicate feeds:', error);
      return [];
    }
  }

  async getEpisodeByGuid(feedGuid: string, episodeGuid: string): Promise<PodcastIndexEpisode | null> {
    try {
      // First get the feed to get the feed ID
      const feed = await this.getFeedByGuid(feedGuid);
      if (!feed) {
        return null;
      }

      const url = `${this.baseUrl}/episodes/byguid?guid=${encodeURIComponent(episodeGuid)}&feedid=${feed.id}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        console.error(`Podcast Index API error for episode ${episodeGuid}: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      
      if (data.status === 'true' && data.episode) {
        return data.episode as PodcastIndexEpisode;
      }
      
      console.warn(`No episode found for GUID: ${episodeGuid} in feed: ${feedGuid}`);
      return null;
    } catch (error) {
      console.error(`Error fetching episode by GUID ${episodeGuid}:`, error);
      return null;
    }
  }

  async resolveArtworkForTrack(feedGuid: string, itemGuid?: string): Promise<string | null> {
    try {
      // First try to get episode-specific artwork if itemGuid is provided
      if (itemGuid) {
        const episode = await this.getEpisodeByGuid(feedGuid, itemGuid);
        if (episode?.image && episode.image.trim() !== '') {
          console.log(`✅ Found episode artwork for ${itemGuid}: ${episode.image}`);
          return episode.image;
        }
      }

      // Fall back to feed artwork
      const feed = await this.getFeedByGuid(feedGuid);
      if (feed) {
        const artwork = feed.artwork || feed.image;
        if (artwork && artwork.trim() !== '') {
          console.log(`✅ Found feed artwork for ${feedGuid}: ${artwork}`);
          return artwork;
        }
      }

      console.warn(`❌ No artwork found for feed ${feedGuid}, item ${itemGuid}`);
      return null;
    } catch (error) {
      console.error(`Error resolving artwork for ${feedGuid}/${itemGuid}:`, error);
      return null;
    }
  }
}

// Create a singleton instance
export const podcastIndexAPI = new PodcastIndexAPI();

// Cache for resolved artwork to avoid repeated API calls
const artworkCache = new Map<string, string | null>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const cacheTimestamps = new Map<string, number>();

export async function resolveArtworkFromPodcastIndex(
  feedGuid: string,
  itemGuid?: string
): Promise<string | null> {
  const cacheKey = `${feedGuid}:${itemGuid || 'feed'}`;

  // Check cache first
  if (artworkCache.has(cacheKey)) {
    const timestamp = cacheTimestamps.get(cacheKey) || 0;
    if (Date.now() - timestamp < CACHE_DURATION) {
      return artworkCache.get(cacheKey) || null;
    }
  }

  // Resolve from API
  const artwork = await podcastIndexAPI.resolveArtworkForTrack(feedGuid, itemGuid);

  // Cache the result
  artworkCache.set(cacheKey, artwork);
  cacheTimestamps.set(cacheKey, Date.now());

  return artwork;
}

/**
 * Get feed by URL, preferring the newest Podcast Index entry when duplicates exist
 * This handles cases where the same feed was indexed multiple times with different URLs
 * (e.g., URL encoding differences like "pony up daddy.xml" vs "pony%20up%20daddy.xml")
 */
export async function getFeedByUrlPreferNewest(feedUrl: string): Promise<PodcastIndexFeed | null> {
  return podcastIndexAPI.getFeedByUrl(feedUrl);
}

// Re-export the PodcastIndexFeed type for use in other modules
export type { PodcastIndexFeed };