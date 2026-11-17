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
  newestItemPubdate?: number;
  oldestItemPubdate?: number;
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

  /**
   * Search for feeds by term, optionally filtered by medium (e.g., 'music')
   */
  async searchByTerm(query: string, medium?: string, max?: number): Promise<PodcastIndexFeed[]> {
    try {
      let url = `${this.baseUrl}/search/byterm?q=${encodeURIComponent(query)}`;
      if (medium) {
        url += `&medium=${encodeURIComponent(medium)}`;
      }
      if (max) {
        url += `&max=${max}`;
      }

      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        console.error(`Podcast Index search error: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();

      if (data.status === 'true' && data.feeds) {
        return data.feeds as PodcastIndexFeed[];
      }

      return [];
    } catch (error) {
      console.error(`Error searching Podcast Index for "${query}":`, error);
      return [];
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

/**
 * Generate Podcast Index API authentication headers
 * Shared helper for modules that need to make direct API calls
 */
export async function generatePodcastIndexHeaders(): Promise<Record<string, string>> {
  const apiKey = process.env.PODCAST_INDEX_API_KEY;
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET must be set');
  }

  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const hash = crypto
    .createHash('sha1')
    .update(apiKey + apiSecret + apiHeaderTime)
    .digest('hex');

  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft/1.0'
  };
}

/**
 * Podcast Index's `lastUpdateTime` (unix seconds — the last time PI saw the feed's
 * content change) for each `podcast:guid` it knows, keyed by the lower-cased guid.
 * One POST to `podcasts/batch/byguid` per 1,000 guids (3,500 in one call answered in
 * under 0.3 s on 2026-11-01). A guid PI does not know is simply absent.
 *
 * Throws on any failed call: the nightly reparse then skips its Wavlake lane for the
 * night rather than guessing — a guess here means fetching Wavlake blind, which is
 * the burst it refuses.
 */
export async function getPodcastIndexLastUpdateByGuid(guids: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(guids.map((g) => g.trim().toLowerCase()).filter(Boolean))];
  const out = new Map<string, number>();
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const response = await fetch('https://api.podcastindex.org/api/1.0/podcasts/batch/byguid', {
      method: 'POST',
      headers: await generatePodcastIndexHeaders(),
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Podcast Index batch/byguid: HTTP ${response.status}`);
    const data = await response.json();
    // A list with no match answers 200 with status "false" and no `feeds`.
    for (const feed of Array.isArray(data?.feeds) ? data.feeds : []) {
      const guid = typeof feed?.podcastGuid === 'string' ? feed.podcastGuid.trim().toLowerCase() : '';
      const t = Number(feed?.lastUpdateTime);
      if (guid && Number.isFinite(t) && t > 0) out.set(guid, t);
    }
  }
  return out;
}

/**
 * Normalize Podcast Index API response to handle both 'feed' and 'feeds' formats
 */
export function normalizeFeedResponse(data: any): PodcastIndexFeed | null {
  if (data.status !== 'true' && data.status !== true) return null;
  return data.feed || (data.feeds && data.feeds[0]) || null;
}

/**
 * Detect if a URL is a Podcast Index web page URL and resolve it to the actual RSS feed URL.
 * Handles formats like:
 *   https://podcastindex.org/podcast/7405721
 *   http://podcastindex.org/podcast/7405721
 * Returns the RSS feed URL if resolved, or null if the URL is not a PI page URL.
 */
export async function resolvePodcastIndexUrl(url: string): Promise<{ feedUrl: string; title: string; author: string } | null> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'podcastindex.org' && parsed.hostname !== 'www.podcastindex.org') {
      return null;
    }

    const match = parsed.pathname.match(/^\/podcast\/(\d+)\/?$/);
    if (!match) {
      return null;
    }

    const feedId = parseInt(match[1], 10);
    console.log(`🔍 Detected Podcast Index URL, looking up feed ID: ${feedId}`);

    const feed = await podcastIndexAPI.getFeedById(feedId);
    if (!feed) {
      console.warn(`❌ No feed found in Podcast Index for ID: ${feedId}`);
      return null;
    }

    const feedUrl = feed.url || feed.originalUrl;
    if (!feedUrl) {
      console.warn(`❌ Feed ${feedId} has no URL in Podcast Index`);
      return null;
    }

    console.log(`✅ Resolved PI feed ${feedId} → ${feedUrl} ("${feed.title}" by ${feed.author})`);
    return { feedUrl, title: feed.title, author: feed.author };
  } catch {
    return null;
  }
}

/**
 * Parse a Podcast Index search page URL and return the search parameters.
 * Handles formats like:
 *   https://podcastindex.org/search?q=Christian%20Leuenberg&type=music
 * Returns the search query and type, or null if not a PI search URL.
 */
export function parsePodcastIndexSearchUrl(url: string): { query: string; type?: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'podcastindex.org' && parsed.hostname !== 'www.podcastindex.org') {
      return null;
    }

    if (parsed.pathname !== '/search') {
      return null;
    }

    const query = parsed.searchParams.get('q');
    if (!query) {
      return null;
    }

    const type = parsed.searchParams.get('type') || undefined;
    return { query, type };
  } catch {
    return null;
  }
}

/**
 * Search Podcast Index by term with optional medium filter.
 * Convenience export for the singleton API instance.
 */
export async function searchPodcastIndex(query: string, medium?: string, max?: number): Promise<PodcastIndexFeed[]> {
  return podcastIndexAPI.searchByTerm(query, medium, max);
}

// Re-export the PodcastIndexFeed type for use in other modules
export type { PodcastIndexFeed };