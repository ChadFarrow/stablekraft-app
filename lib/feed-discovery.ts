import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

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

// Load API keys from .env.local
function getApiKeys(): { apiKey: string; apiSecret: string } {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
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
    'User-Agent': 'FUCKIT-Feed-Discovery/1.0'
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
    
    const data: PodcastIndexResponse = await response.json();
    
    if (data.status === 'true' && data.feeds && data.feeds.length > 0) {
      const feed = data.feeds[0];
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

export async function addUnresolvedFeeds(feedGuids: string[]): Promise<number> {
  let addedCount = 0;
  
  for (const feedGuid of feedGuids) {
    try {
      // Check if we already have this feed GUID in our database
      // We'll store the GUID in the originalUrl field temporarily with a prefix
      const guidUrl = `guid:${feedGuid}`;
      const existingFeed = await prisma.feed.findUnique({
        where: { originalUrl: guidUrl }
      });
      
      if (existingFeed) {
        console.log(`⚡ Feed GUID already exists in database: ${feedGuid}`);
        continue;
      }
      
      // Try to resolve the GUID to an actual feed URL
      const resolvedUrl = await resolveFeedGuid(feedGuid);
      
      if (resolvedUrl) {
        // Check if we already have this resolved URL
        const existingResolvedFeed = await prisma.feed.findUnique({
          where: { originalUrl: resolvedUrl }
        });
        
        if (existingResolvedFeed) {
          console.log(`⚡ Resolved feed URL already exists: ${resolvedUrl}`);
          continue;
        }
        
        // Add the resolved feed
        const newFeed = await prisma.feed.create({
          data: {
            title: `Auto-discovered feed (${feedGuid.slice(0, 8)}...)`,
            description: `Automatically discovered feed from playlist analysis`,
            originalUrl: resolvedUrl,
            type: 'album',
            priority: 'normal',
            status: 'active',
            artist: 'Auto-discovered'
          }
        });
        
        console.log(`✅ Added resolved feed: ${resolvedUrl}`);
        
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
        // Store the GUID for future resolution
        await prisma.feed.create({
          data: {
            title: `Unresolved feed GUID (${feedGuid.slice(0, 8)}...)`,
            description: `Feed GUID from playlist - needs manual resolution: ${feedGuid}`,
            originalUrl: guidUrl,
            type: 'album',
            priority: 'low',
            status: 'pending',
            artist: 'Unresolved GUID'
          }
        });
        
        console.log(`📝 Stored unresolved feed GUID: ${feedGuid}`);
        addedCount++;
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
    
    // First, try to resolve the feed GUID to get feed information
    let feedId: number | null = null;
    let feedUrl: string | null = null;
    
    if (feedGuid) {
      const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
        headers
      });
      
      if (feedResponse.ok) {
        const feedData: PodcastIndexResponse = await feedResponse.json();
        if (feedData.status === 'true' && feedData.feeds && feedData.feeds.length > 0) {
          const feed = feedData.feeds[0];
          feedId = feed.id;
          feedUrl = feed.url;
          console.log(`✅ Found feed info: ${feed.title} (ID: ${feedId})`);
        }
      }
    }
    
    // Now try to get the episode using different approaches
    // Note: episodes/byguid endpoint seems unreliable, so we'll focus on the episodes list approaches
    let attemptedApproaches: string[] = [];
    
    // Approach 1: Get all episodes from feed by GUID and search for our item
    if (feedGuid) {
      attemptedApproaches.push('episodes-by-feed-guid');
      console.log(`🔍 Fetching all episodes for feed ${feedGuid} to find ${itemGuid}`);
      
      const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedguid?guid=${encodeURIComponent(feedGuid)}&max=1000`, {
        headers
      });
      
      if (episodesResponse.ok) {
        const episodesData = await episodesResponse.json();
        if (episodesData.status === 'true' && episodesData.items) {
          console.log(`📊 Found ${episodesData.items.length} episodes in feed`);
          // Search for our specific episode
          const episode = episodesData.items.find((ep: any) => ep.guid === itemGuid);
          if (episode) {
            console.log(`✅ Found episode in feed list: ${episode.title}`);
            return {
              guid: episode.guid,
              title: episode.title,
              description: episode.description,
              audioUrl: episode.enclosureUrl,
              duration: episode.duration,
              image: episode.image || episode.feedImage,
              publishedAt: new Date(episode.datePublished * 1000),
              feedGuid: episode.feedGuid || feedGuid,
              feedTitle: episode.feedTitle || episode.podcastTitle,
              feedImage: episode.feedImage
            };
          } else {
            console.log(`⚠️ Episode ${itemGuid} not found among ${episodesData.items.length} episodes`);
          }
        }
      }
    }
    
    // Approach 2: Try to get episodes by feedId if we have it
    if (feedId) {
      attemptedApproaches.push('episodes-by-feed-id');
      console.log(`🔍 Fetching all episodes for feedId ${feedId} to find ${itemGuid}`);
      
      const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feedId}&max=1000`, {
        headers
      });
      
      if (episodesResponse.ok) {
        const episodesData = await episodesResponse.json();
        if (episodesData.status === 'true' && episodesData.items) {
          console.log(`📊 Found ${episodesData.items.length} episodes in feedId`);
          // Search for our specific episode
          const episode = episodesData.items.find((ep: any) => ep.guid === itemGuid);
          if (episode) {
            console.log(`✅ Found episode in feedId list: ${episode.title}`);
            return {
              guid: episode.guid,
              title: episode.title,
              description: episode.description,
              audioUrl: episode.enclosureUrl,
              duration: episode.duration,
              image: episode.image || episode.feedImage,
              publishedAt: new Date(episode.datePublished * 1000),
              feedGuid: episode.feedGuid || feedGuid,
              feedTitle: episode.feedTitle || episode.podcastTitle,
              feedImage: episode.feedImage
            };
          }
        }
      }
    }
    
    // If we get here, all approaches failed
    console.warn(`⚠️ All approaches failed for item ${itemGuid}. Attempted: ${attemptedApproaches.join(', ')}`);
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