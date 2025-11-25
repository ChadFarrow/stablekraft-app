// V4V Track Resolution Service
// Resolves V4V remoteItem references to actual track metadata

export interface V4VResolutionResult {
  success: boolean;
  title?: string;
  artist?: string;
  image?: string;
  audioUrl?: string;
  duration?: number;
  feedTitle?: string;
  error?: string;
}

export class V4VResolver {
  private static knownFeeds: { [key: string]: string } = {
    '2b62ef49-fcff-523c-b81a-0a7dde2b0609': 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
    '69c634ad-afea-5826-ad9a-8e1f06d6470b': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml',
    '08604071-83cc-5810-bec2-bea0f0cd0033': 'https://www.doerfelverse.com/feeds/ben-doerfel.xml',
    '1e7ed1fa-0456-5860-9b34-825d1335d8f8': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml',
    '5bb8f186-2460-54dc-911d-54f642e8adf6': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/CityBeach.xml',
    '4a483a4b-867c-50d5-a61a-e99fe03ea57e': 'https://www.doerfelverse.com/feeds/wrath-of-banjo.xml',
    'a599fabe-6b73-58f3-88b8-a7b78a2976b5': 'https://www.thisisjdog.com/media/ring-that-bell.xml',
    // Episode 56 Wavlake feeds
    '3ae285ab-434c-59d8-aa2f-59c6129afb92': 'https://wavlake.com/feed/music/99ed143c-c461-4f1a-9d0d-bee6f70d8b7e', // Bell of Hope - John Depew Trio
    '6fc2ad98-d4a8-5d70-9c68-62e9efc1209c': 'https://wavlake.com/feed/music/5a07b3f1-8249-45a1-b40a-630797dc4941', // Birdfeeder (EP) - Big Awesome
    'dea01a9d-a024-5b13-84aa-b157304cd3bc': 'https://wavlake.com/feed/music/328f61b9-20b1-4338-9e2a-b437abc39f7b', // Smokestacks - Herbivore
    '95e5f7a9-d88e-5e51-b2ae-f4b1865d19c4': 'https://wavlake.com/feed/music/8aaf0d1e-7ac3-4f7d-993b-6f59f936d780', // Live From the Other Side - Theo Katzman
    // Episode 54 feeds
    '3058af0c-1807-5732-9a08-9114675ef7d6': 'https://wavlake.com/feed/music/883ea557-39c0-4bec-9618-c75978bc63b5', // Lost Summer - Ollie
    '011c3a82-d716-54f7-9738-3d5fcacf65be': 'https://wavlake.com/feed/music/79f5f4f0-a774-40ed-abdf-90ada1980a71', // Abyss / Quiet day - Lara J
    '0ab5bc9d-c9fb-52f4-8b8c-64be5edf322f': 'https://wavlake.com/feed/music/d7a1d7bc-ae06-4b3b-a3fa-4e203d68dbaf', // it can be erased - Nate Johnivan
    '187f22db-79cb-5ac4-aa60-54e424e3915e': 'https://files.heycitizen.xyz/Songs/Albums/Lofi-Experience/lofi.xml', // HeyCitizen's Lo-Fi Hip-Hop Beats - HeyCitizen
    // Note: V4V resolver now automatically looks up unknown feedGuids via Podcast Index API
    // Only commonly used feeds are pre-cached here for performance
    // Episode 44 feeds
    'a2d2e313-9cbd-5169-b89c-ab07b33ecc33': 'https://files.heycitizen.xyz/Songs/Albums/The-Heycitizen-Experience/the heycitizen experience.xml', // The Heycitizen Experience - HeyCitizen
    // Episode 51 feeds
    'de032037-63e0-5c6b-820d-13d4319a2b19': 'https://wavlake.com/feed/music/169e65e4-c3fa-471f-a473-b75f3890848b' // Breathe EP - The Greensands
    // Note: HGH feed GUIDs need to be discovered via Podcast Index API or manual lookup
    // The feed GUIDs are different from the music IDs used in Wavlake URLs
  };

  private static feedCache = new Map<string, string>();
  private static cacheExpiry = new Map<string, number>();
  private static readonly CACHE_DURATION = 1000 * 60 * 60; // 1 hour

  /**
   * Resolve a V4V track reference to actual metadata
   */
  static async resolve(feedGuid: string, itemGuid: string): Promise<V4VResolutionResult> {
    try {
      console.log(`🔍 Resolving V4V track: feedGuid=${feedGuid}, itemGuid=${itemGuid}`);

      // Check if this is a known Doerfel-Verse feed
      let feedUrl = this.knownFeeds[feedGuid];
      
      // If not in known feeds, try to look it up via Podcast Index API
      if (!feedUrl) {
        console.log(`🔍 Unknown feedGuid ${feedGuid}, looking up via Podcast Index API...`);
        const discoveredFeedUrl = await this.lookupFeedGuid(feedGuid);
        
        if (!discoveredFeedUrl) {
          console.log(`❌ FeedGuid ${feedGuid} not found in Podcast Index API`);
          
          // Check if this is a known HGH feed GUID that needs manual discovery
          const hghFeedGuids = [
            '0653114c-dd08-5f36-863d-009d56bccb8d', // Sun Ray
            'fd10aec5-b4c4-5255-991e-3dae7095f96a', // Lore and Legend
            '749c442d-5d43-50b0-9f7a-0f5cbf0a218a', // Pickle Popsicle
            'ab7db89d-9602-5b8d-bba8-42855b20c13c', // The Big I am (Live)
            'd6b85f98-6d7a-5eca-b288-dafae4381a1d', // Pickle It Up!
            '227754a0-691f-5b2d-a685-aac2df167fdc',
            '262a48c2-502d-5c09-add4-76a86056876d',
            '38edc858-5731-5221-86bf-86db9f886e2b',
            '5c87b91a-2141-590b-ab19-93e8a6f2d885',
            '63fb0d8e-793f-5033-bbb4-39a836e3da76'
          ];
          
          if (hghFeedGuids.includes(feedGuid)) {
            return {
              success: false,
              error: `HGH feed GUID ${feedGuid} needs manual discovery. This is likely a Wavlake feed that needs to be added to the knownFeeds list.`
            };
          }
          
          return {
            success: false,
            error: 'Unknown feed GUID - not found in Podcast Index'
          };
        }
        
        // Cache the discovered feed URL for future use (in memory only)
        feedUrl = discoveredFeedUrl;
        this.knownFeeds[feedGuid] = feedUrl;
        console.log(`✅ Discovered and cached feed: ${feedUrl}`);
      }

      console.log(`✅ Found known feed: ${feedUrl}`);

      // Get feed XML (with caching)
      const feedXml = await this.getFeedXml(feedUrl);
      if (!feedXml) {
        return {
          success: false,
          error: 'Failed to fetch feed XML'
        };
      }

      // Parse the feed to find the specific track
      const trackInfo = this.parseTrackFromFeed(feedXml, itemGuid);
      if (!trackInfo.success) {
        return {
          success: false,
          error: `Track with GUID ${itemGuid} not found in feed`
        };
      }

      console.log(`🎵 Successfully resolved: ${trackInfo.title} by ${trackInfo.artist}`);
      return trackInfo;

    } catch (error) {
      console.error('V4V resolution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Resolve multiple V4V tracks in batch
   */
  static async resolveBatch(tracks: Array<{ feedGuid: string; itemGuid: string }>): Promise<Map<string, V4VResolutionResult>> {
    const results = new Map<string, V4VResolutionResult>();
    
    // Group by feed to optimize API calls
    const feedGroups = new Map<string, string[]>();
    tracks.forEach(track => {
      const key = track.feedGuid;
      if (!feedGroups.has(key)) {
        feedGroups.set(key, []);
      }
      feedGroups.get(key)!.push(track.itemGuid);
    });

    // Process each feed
    const feedPromises = Array.from(feedGroups.entries()).map(async ([feedGuid, itemGuids]) => {
      try {
        const feedUrl = this.knownFeeds[feedGuid];
        if (!feedUrl) {
          // Mark all items from this feed as unresolvable
          itemGuids.forEach(itemGuid => {
            results.set(`${feedGuid}:${itemGuid}`, {
              success: false,
              error: 'Unknown feed GUID'
            });
          });
          return;
        }

        // Fetch feed once for all items
        const feedXml = await this.getFeedXml(feedUrl);
        if (!feedXml) {
          itemGuids.forEach(itemGuid => {
            results.set(`${feedGuid}:${itemGuid}`, {
              success: false,
              error: 'Failed to fetch feed'
            });
          });
          return;
        }

        // Resolve all items from this feed
        itemGuids.forEach(itemGuid => {
          const result = this.parseTrackFromFeed(feedXml, itemGuid);
          results.set(`${feedGuid}:${itemGuid}`, result);
        });

      } catch (error) {
        console.error(`Error processing feed ${feedGuid}:`, error);
        itemGuids.forEach(itemGuid => {
          results.set(`${feedGuid}:${itemGuid}`, {
            success: false,
            error: 'Feed processing error'
          });
        });
      }
    });

    // Wait for all feed processing to complete
    await Promise.all(feedPromises);

    return results;
  }

  /**
   * Get feed XML with caching
   */
  private static async getFeedXml(feedUrl: string): Promise<string | null> {
    const now = Date.now();
    
    // Check cache
    if (this.feedCache.has(feedUrl)) {
      const expiry = this.cacheExpiry.get(feedUrl) || 0;
      if (now < expiry) {
        console.log(`📦 Using cached feed: ${feedUrl}`);
        return this.feedCache.get(feedUrl)!;
      }
    }

    try {
      console.log(`📡 Fetching feed: ${feedUrl}`);
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      
      // Cache the result
      this.feedCache.set(feedUrl, xml);
      this.cacheExpiry.set(feedUrl, now + this.CACHE_DURATION);
      
      return xml;
    } catch (error) {
      console.error(`Failed to fetch feed ${feedUrl}:`, error);
      return null;
    }
  }

  /**
   * Parse track info from feed XML
   */
  private static parseTrackFromFeed(feedXml: string, itemGuid: string): V4VResolutionResult {
    try {
      // Find the item with matching GUID
      const guidPattern = new RegExp(`<guid[^>]*>${itemGuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</guid>`, 'i');
      const itemMatch = feedXml.match(new RegExp(`<item>([\\s\\S]*?${itemGuid}[\\s\\S]*?)</item>`, 'i'));
      
      if (!itemMatch) {
        return {
          success: false,
          error: `Item with GUID ${itemGuid} not found`
        };
      }

      const itemXml = itemMatch[1];
      
      // Extract track information
      const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemXml.match(/<title>(.*?)<\/title>/i);
      const enclosureMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/i);
      const durationMatch = itemXml.match(/<itunes:duration>(\d+)<\/itunes:duration>/i);
      const imageMatch = itemXml.match(/<itunes:image[^>]+href="([^"]+)"/i);
      const authorMatch = itemXml.match(/<author>(.*?)<\/author>/i) || itemXml.match(/<itunes:author>(.*?)<\/itunes:author>/i);
      
      // Get feed-level info for fallbacks
      const feedTitleMatch = feedXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || feedXml.match(/<title>(.*?)<\/title>/i);
      const feedAuthorMatch = feedXml.match(/<author><!\[CDATA\[(.*?)\]\]><\/author>/i) || feedXml.match(/<author>(.*?)<\/author>/i) || feedXml.match(/<itunes:author>(.*?)<\/itunes:author>/i);
      const feedImageMatch = feedXml.match(/<itunes:image[^>]+href="([^"]+)"/i);
      
      if (!titleMatch) {
        return {
          success: false,
          error: 'Could not extract track title'
        };
      }

      return {
        success: true,
        title: titleMatch[1],
        artist: authorMatch ? authorMatch[1] : feedAuthorMatch ? feedAuthorMatch[1] : feedTitleMatch ? feedTitleMatch[1] : 'The Doerfels',
        audioUrl: enclosureMatch ? enclosureMatch[1] : undefined,
        duration: durationMatch ? parseInt(durationMatch[1]) : undefined,
        image: imageMatch ? imageMatch[1] : feedImageMatch ? feedImageMatch[1] : undefined,
        feedTitle: feedTitleMatch ? feedTitleMatch[1] : undefined
      };

    } catch (error) {
      console.error('Error parsing track from feed:', error);
      return {
        success: false,
        error: 'XML parsing error'
      };
    }
  }

  /**
   * Look up a feedGuid via Podcast Index API
   * Prefers the newest entry when duplicates exist (higher ID = newer)
   */
  private static async lookupFeedGuid(feedGuid: string): Promise<string | null> {
    try {
      // Use environment variables for API credentials
      const apiKey = process.env.PODCAST_INDEX_API_KEY;
      const apiSecret = process.env.PODCAST_INDEX_API_SECRET;

      if (!apiKey || !apiSecret) {
        console.error('PODCAST_INDEX_API_KEY or PODCAST_INDEX_API_SECRET not set in environment variables.');
        return null;
      }

      // Create authorization header
      const crypto = require('crypto');
      const apiHeaderTime = Math.floor(Date.now() / 1000);
      const hash = crypto.createHash('sha1');
      hash.update(apiKey + apiSecret + apiHeaderTime);
      const hashString = hash.digest('hex');

      const headers = {
        'X-Auth-Key': apiKey,
        'X-Auth-Date': apiHeaderTime.toString(),
        'Authorization': hashString,
        'User-Agent': 're.podtards.com'
      };

      const url = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;

      console.log(`📡 Looking up feedGuid ${feedGuid} via Podcast Index API...`);
      const response = await fetch(url, { headers });
      const data = await response.json();

      if (data.status === 'true' && data.feed && data.feed.url) {
        // Check for duplicate feeds and prefer the newest entry
        const { getFeedByUrlPreferNewest } = await import('./podcast-index-api');
        const newestFeed = await getFeedByUrlPreferNewest(data.feed.url);

        if (newestFeed && newestFeed.id !== data.feed.id) {
          console.log(`✅ Found newer feed entry: ${newestFeed.title} (ID ${newestFeed.id}) at ${newestFeed.url}`);
          return newestFeed.url;
        }

        console.log(`✅ Found feed: ${data.feed.title} by ${data.feed.author} at ${data.feed.url}`);
        return data.feed.url;
      } else {
        console.log(`❌ Feed not found for GUID ${feedGuid}`);
        return null;
      }
    } catch (error) {
      console.error(`❌ Error looking up feedGuid ${feedGuid}:`, error);
      return null;
    }
  }

  /**
   * Resolve V4V track information using Podcast Index API directly
   * This uses the episodes/byguid endpoint for cleaner resolution
   */
  static async resolveV4VTrackWithPodcastIndex(
    feedGuid: string,
    itemGuid: string
  ): Promise<{
    title?: string;
    artist?: string;
    image?: string;
    audioUrl?: string;
    duration?: number;
    resolved: boolean;
  }> {
    try {
      const apiKey = process.env.PODCAST_INDEX_API_KEY;
      const apiSecret = process.env.PODCAST_INDEX_API_SECRET;

      if (!apiKey || !apiSecret) {
        console.warn('Podcast Index API credentials not configured for V4V resolution');
        return { resolved: false };
      }

      const crypto = require('crypto');
      const timestamp = Math.floor(Date.now() / 1000);
      const authString = apiKey + apiSecret + timestamp;
      const authHash = crypto.createHash('sha1').update(authString).digest('hex');

      const headers = {
        'User-Agent': 're.podtards.com',
        'X-Auth-Key': apiKey,
        'X-Auth-Date': timestamp.toString(),
        'Authorization': authHash
      };

      // Get feed information from Podcast Index API
      const feedUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;
      const feedResponse = await fetch(feedUrl, { headers });

      if (feedResponse.ok) {
        const feedData = await feedResponse.json();
        if (feedData.status === 'true' && feedData.feed) {
          const feed = feedData.feed;

          // Get the specific episode
          const episodeUrl = `https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${itemGuid}&feedid=${feed.id}`;
          const episodeResponse = await fetch(episodeUrl, { headers });

          if (episodeResponse.ok) {
            const episodeData = await episodeResponse.json();
            if (episodeData.status === 'true' && episodeData.episode) {
              const episode = episodeData.episode;

              return {
                resolved: true,
                title: episode.title || feed.title,
                artist: feed.author || feed.title,
                image: episode.image || feed.image || feed.artwork,
                audioUrl: episode.enclosureUrl,
                duration: episode.duration,
              };
            }
          }

          // If episode lookup fails, return feed-level information
          return {
            resolved: true,
            title: feed.title,
            artist: feed.author || feed.title,
            image: feed.image || feed.artwork,
            audioUrl: undefined,
            duration: undefined,
          };
        }
      }

      console.warn('Failed to resolve V4V track with Podcast Index', { feedGuid, itemGuid });
      return { resolved: false };

    } catch (error) {
      console.error('Error resolving V4V track with Podcast Index', {
        feedGuid,
        itemGuid,
        error: error instanceof Error ? error.message : String(error)
      });
      return { resolved: false };
    }
  }

  /**
   * Resolve a remote track (placeholder - uses resolveV4VTrackWithPodcastIndex internally)
   */
  static async resolveRemoteTrack(
    feedGuid: string,
    itemGuid: string,
    _playlistTitle: string,
    _playlistFeedUrl: string
  ): Promise<any> {
    const result = await this.resolveV4VTrackWithPodcastIndex(feedGuid, itemGuid);
    return result.resolved ? result : null;
  }

  /**
   * Clear the feed cache
   */
  static clearCache(): void {
    this.feedCache.clear();
    this.cacheExpiry.clear();
    console.log('🗑️ V4V feed cache cleared');
  }
}