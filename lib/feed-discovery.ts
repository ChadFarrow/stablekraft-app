import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';

interface PodcastIndexResponse {
  status: string;
  feeds: Array<{
    id: number;
    podcastGuid: string;
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
    itunesId: number;
    language: string;
    type: number;
    dead: number;
    crawlErrors: number;
    parseErrors: number;
    categories: Record<string, string>;
    locked: number;
    explicit: boolean;
    medium: string;
  }>;
  count: number;
  query: string;
  description: string;
}

// Load API keys from environment variables or .env.local
function getApiKeys(): { apiKey: string; apiSecret: string } {
  // First, try to get from environment variables (works in production/Railway)
  if (process.env.PODCAST_INDEX_API_KEY && process.env.PODCAST_INDEX_API_SECRET) {
    return {
      apiKey: process.env.PODCAST_INDEX_API_KEY,
      apiSecret: process.env.PODCAST_INDEX_API_SECRET
    };
  }

  // Fall back to .env.local for local development
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    
    // Check if file exists before trying to read it
    if (!fs.existsSync(envPath)) {
      throw new Error('PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET must be set in environment variables or .env.local file');
    }
    
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    const apiKeyMatch = envContent.match(/PODCAST_INDEX_API_KEY=(.+)/);
    const apiSecretMatch = envContent.match(/PODCAST_INDEX_API_SECRET=(.+)/);
    
    if (!apiKeyMatch || !apiSecretMatch) {
      throw new Error('Missing PODCAST_INDEX_API_KEY or PODCAST_INDEX_API_SECRET in .env.local');
    }
    
    return {
      apiKey: apiKeyMatch[1].trim().replace(/['"]/g, ''),
      apiSecret: apiSecretMatch[1].trim().replace(/['"]/g, '')
    };
  } catch (error) {
    console.error('❌ Error loading API keys:', error);
    throw error;
  }
}

// Generate required headers for Podcast Index API
async function generateHeaders(apiKey: string, apiSecret: string): Promise<Record<string, string>> {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  
  // Generate SHA1 hash for authentication
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft-Feed-Discovery/1.0'
  };
}

export async function resolveFeedGuid(feedGuid: string): Promise<string | null> {
  try {
    console.log(`🔍 Resolving feed GUID: ${feedGuid}`);

    const { apiKey, apiSecret } = getApiKeys();
    const headers = await generateHeaders(apiKey, apiSecret);

    // Use Podcast Index API to resolve GUID to feed URL
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });

    if (!response.ok) {
      console.warn(`⚠️ Podcast Index API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();

    // Handle both singular 'feed' and plural 'feeds' response formats
    const feed = data.feed || (data.feeds && data.feeds[0]);

    if (data.status === 'true' && feed) {
      console.log(`✅ Resolved feed GUID ${feedGuid} to: ${feed.title} - ${feed.url}`);
      return feed.url;
    } else {
      console.warn(`⚠️ No feed found for GUID: ${feedGuid}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error resolving feed GUID ${feedGuid}:`, error);
    return null;
  }
}

// New function that returns full feed metadata
export async function resolveFeedGuidWithMetadata(feedGuid: string): Promise<{ url: string; title: string; artist: string; image: string } | null> {
  try {
    console.log(`🔍 Resolving feed GUID with metadata: ${feedGuid}`);

    const { apiKey, apiSecret } = getApiKeys();
    const headers = await generateHeaders(apiKey, apiSecret);

    // Use Podcast Index API to resolve GUID to feed metadata
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });

    if (!response.ok) {
      console.warn(`⚠️ Podcast Index API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();

    // Handle both singular 'feed' and plural 'feeds' response formats
    const feed = data.feed || (data.feeds && data.feeds[0]);

    if (data.status === 'true' && feed && feed.url) {
      let finalFeed = feed;

      // For behindthesch3m3s.com feeds, always check for newer Podcast Index entries
      // This handles cases where feeds were re-indexed with different URLs (URL encoding)
      if (feed.url.includes('behindthesch3m3s.com')) {
        try {
          const { getFeedByUrlPreferNewest } = await import('./podcast-index-api');
          const newestFeed = await getFeedByUrlPreferNewest(feed.url);

          if (newestFeed && newestFeed.id !== feed.id) {
            console.log(`🔄 Using newer Podcast Index entry for ${feed.title}: ID ${newestFeed.id} vs ${feed.id}`);
            finalFeed = newestFeed;
          }
        } catch (error) {
          console.warn(`⚠️ Could not check for newer feed entry: ${error}`);
        }
      }

      console.log(`✅ Resolved feed GUID ${feedGuid} to: ${finalFeed.title} - ${finalFeed.url}`);
      return {
        url: finalFeed.url,
        title: finalFeed.title || 'Unknown Feed',
        artist: finalFeed.author || finalFeed.ownerName || 'Unknown Artist',
        image: finalFeed.artwork || finalFeed.image || ''
      };
    } else {
      if (feed && !feed.url) {
        console.warn(`⚠️ Feed found but missing URL for GUID: ${feedGuid}`);
      } else {
        console.warn(`⚠️ No feed found for GUID: ${feedGuid}`);
      }
      return null;
    }
  } catch (error) {
    console.error(`❌ Error resolving feed GUID ${feedGuid}:`, error);
    return null;
  }
}

export async function addUnresolvedFeeds(feedGuids: string[]): Promise<number> {
  let addedCount = 0;

  for (const feedGuid of feedGuids) {
    try {
      // Check if feed already exists by ID first (fast lookup)
      const existingFeed = await prisma.feed.findUnique({
        where: { id: feedGuid },
        select: { id: true }
      });

      if (existingFeed) {
        console.log(`⚡ Feed GUID already exists in database: ${feedGuid}`);
        continue;
      }

      // Try to resolve the GUID to get full feed metadata
      const resolvedFeed = await resolveFeedGuidWithMetadata(feedGuid);

      if (resolvedFeed) {
        // Use upsert to atomically create or update (prevents race conditions)
        const upsertResult = await prisma.feed.upsert({
          where: { id: feedGuid },
          create: {
            id: feedGuid, // Use the podcast GUID so parse-feeds can look it up
            title: resolvedFeed.title,
            description: `Auto-discovered from playlist`,
            originalUrl: resolvedFeed.url,
            type: 'album',
            priority: 'normal',
            status: 'active',
            artist: resolvedFeed.artist,
            image: resolvedFeed.image,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          update: {
            // Feed already exists - just update metadata if needed
            updatedAt: new Date()
          },
          select: { id: true, createdAt: true, updatedAt: true }
        });

        // Check if this was a new creation (createdAt equals updatedAt within 1 second)
        const wasCreated = Math.abs(upsertResult.createdAt.getTime() - upsertResult.updatedAt.getTime()) < 1000;

        if (!wasCreated) {
          console.log(`⚡ Feed already existed (race condition avoided): ${feedGuid}`);
          continue;
        }

        const newFeed = { id: upsertResult.id };

        console.log(`✅ Added resolved feed: ${resolvedFeed.title} by ${resolvedFeed.artist}`);

        // Automatically process the RSS feed to extract tracks
        try {
          console.log(`🔄 Processing RSS for feed: ${newFeed.id}`);
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
          const parseResponse = await fetch(`${baseUrl}/api/parse-feeds?action=parse-single&feedId=${newFeed.id}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            }
          });

          if (parseResponse.ok) {
            const parseResult = await parseResponse.json();
            console.log(`✅ RSS processing completed for feed ${newFeed.id}: ${parseResult.message}`);
          } else {
            console.warn(`⚠️ RSS processing failed for feed ${newFeed.id}: ${parseResponse.status}`);
          }
        } catch (parseError) {
          console.error(`❌ Error processing RSS for feed ${newFeed.id}:`, parseError);
        }

        addedCount++;
      } else {
        // Could not resolve - skip this feed (don't create placeholder)
        console.warn(`⚠️ Skipping feed GUID ${feedGuid} - could not resolve via Podcast Index API`);
      }
    } catch (error) {
      console.error(`❌ Error processing feed GUID ${feedGuid}:`, error);
    }
  }
  
  return addedCount;
}

export async function resolveItemGuid(feedGuid: string, itemGuid: string): Promise<any | null> {
  try {
    console.log(`🔍 Resolving item GUID: ${itemGuid} from feed: ${feedGuid}`);
    
    const { apiKey, apiSecret } = getApiKeys();
    const headers = await generateHeaders(apiKey, apiSecret);
    
    // Approach 1: Try to resolve via feed GUID first
    console.log(`📡 Approach 1: Feed-based lookup`);
    const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (feedResponse.ok) {
      const feedData = await feedResponse.json();
      
      // Handle different response structures
      let feed = null;
      if (feedData.status === 'true') {
        feed = feedData.feed || (feedData.feeds && feedData.feeds[0]);
      }
      
      if (feed && feed.id) {
        const feedId = feed.id;
        const feedTitle = feed.title;
        console.log(`✅ Found feed: ${feedTitle} (ID: ${feedId})`);
        
        // Get episodes from this feed (limit to 100 for performance)
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feedId}&max=100`, {
          headers
        });
        
        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();
          if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
            console.log(`📊 Found ${episodesData.items.length} episodes in feed`);
            
            // Find the specific episode by GUID
            const episode = episodesData.items.find((ep: any) => ep.guid === itemGuid);
            if (episode) {
              console.log(`✅ Found episode via feed lookup: ${episode.title}`);
              return {
                guid: episode.guid,
                title: episode.title,
                description: episode.description || '',
                audioUrl: episode.enclosureUrl || '',
                duration: episode.duration || 0,
                image: episode.image || feed.image || '/placeholder-podcast.jpg',
                publishedAt: new Date(episode.datePublished * 1000),
                feedGuid: feedGuid,
                feedTitle: feedTitle,
                feedImage: feed.image
              };
            }
          }
        }
      }
    }
    
    // Approach 2: Direct episode GUID lookup as fallback
    console.log(`📡 Approach 2: Direct episode GUID lookup`);
    const episodeResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${encodeURIComponent(itemGuid)}`, {
      headers
    });
    
    if (episodeResponse.ok) {
      const episodeData = await episodeResponse.json();
      if (episodeData.status === 'true' && episodeData.episode) {
        const episode = episodeData.episode;
        console.log(`✅ Found episode via direct GUID lookup: ${episode.title}`);
        return {
          guid: episode.guid,
          title: episode.title,
          description: episode.description || '',
          audioUrl: episode.enclosureUrl || '',
          duration: episode.duration || 0,
          image: episode.image || '/placeholder-podcast.jpg',
          publishedAt: new Date(episode.datePublished * 1000),
          feedGuid: episode.feedGuid || feedGuid,
          feedTitle: episode.feedTitle || 'Unknown Feed',
          feedImage: episode.feedImage
        };
      }
    }
    
    console.log(`❌ Could not resolve ${itemGuid} via any method`);
    return null;
  } catch (error) {
    console.error(`❌ Error resolving item GUID ${itemGuid}:`, error);
    return null;
  }
}

export async function processPlaylistFeedDiscovery(remoteItems: Array<{ feedGuid: string; itemGuid: string }>): Promise<number> {
  // Get unique feed GUIDs from the playlist
  const uniqueFeedGuids = [...new Set(remoteItems.map(item => item.feedGuid))];
  
  console.log(`🔍 Processing ${uniqueFeedGuids.length} unique feed GUIDs for auto-discovery...`);
  
  // Add unresolved feeds to the database
  const addedCount = await addUnresolvedFeeds(uniqueFeedGuids);
  
  console.log(`✅ Feed discovery complete: ${addedCount} new feeds added to database`);
  
  return addedCount;
}