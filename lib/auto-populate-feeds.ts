import { prisma } from '@/lib/prisma';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Generate required headers for Podcast Index API
async function generateHeaders(apiKey: string, apiSecret: string) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'FUCKIT-Auto-Feed-Populator/1.0'
  };
}

/**
 * Automatically populate missing feeds from Podcast Index
 * This runs automatically as part of playlist resolution to ensure high track resolution rates
 */
export async function autoPopulateFeeds(feedGuids: string[], playlistName: string = 'playlist'): Promise<number> {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.log('⚠️ Podcast Index API credentials not available - skipping auto-population');
    return 0;
  }

  try {
    console.log(`🔍 Checking ${feedGuids.length} unique feed GUIDs for auto-population in ${playlistName}...`);
    
    // Check which feeds already exist
    const existingFeeds = await prisma.feed.findMany({
      where: { feedGuid: { in: feedGuids } },
      select: { feedGuid: true, id: true }
    });
    
    const existingFeedGuids = new Set(existingFeeds.map(f => f.feedGuid).filter(Boolean));
    const missingFeedGuids = feedGuids.filter(guid => !existingFeedGuids.has(guid));
    
    if (missingFeedGuids.length === 0) {
      console.log(`✅ All ${feedGuids.length} feed GUIDs already exist in database`);
      return 0;
    }
    
    console.log(`🚀 Auto-populating ${missingFeedGuids.length} missing feeds from Podcast Index for ${playlistName}...`);
    
    let autoPopulatedCount = 0;
    
    // Process missing feeds in small batches to respect rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < missingFeedGuids.length; i += BATCH_SIZE) {
      const batch = missingFeedGuids.slice(i, Math.min(i + BATCH_SIZE, missingFeedGuids.length));
      
      await Promise.all(batch.map(async (feedGuid) => {
        try {
          const headers = await generateHeaders(PODCAST_INDEX_API_KEY!, PODCAST_INDEX_API_SECRET!);
          const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, { headers });
          
          if (response.ok) {
            const data = await response.json();
            if (data.status === 'true') {
              const feedData = data.feed || (data.feeds && data.feeds[0]);
              if (feedData) {
                await prisma.feed.create({
                  data: {
                    id: feedGuid,
                    feedGuid: feedGuid,
                    title: feedData.title || 'Unknown Feed',
                    description: feedData.description || null,
                    artist: feedData.author || null,
                    image: feedData.image || null,
                    originalUrl: feedData.url || '',
                    language: feedData.language || null,
                    category: feedData.categories ? Object.keys(feedData.categories)[0] : null,
                    explicit: feedData.explicit || false,
                    status: 'active',
                    lastFetched: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date()
                  }
                });
                autoPopulatedCount++;
                console.log(`✅ Auto-created feed: ${feedData.title} (${feedGuid.slice(0, 8)}...)`);
              }
            }
          }
        } catch (error: any) {
          // Handle duplicates gracefully
          if (error.message?.includes('unique constraint') || error.message?.includes('duplicate key')) {
            console.log(`⚡ Feed ${feedGuid.slice(0, 8)}... already exists, skipping`);
            autoPopulatedCount++; // Count as successful since it exists
          } else {
            console.log(`⚠️ Could not auto-populate feed: ${feedGuid.slice(0, 8)}...`);
          }
        }
      }));
      
      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < missingFeedGuids.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`🎯 Auto-populated ${autoPopulatedCount} feeds for ${playlistName} - this should improve track resolution!`);
    return autoPopulatedCount;
    
  } catch (error) {
    console.error(`❌ Error in auto-populate feeds for ${playlistName}:`, error);
    return 0;
  }
}

/**
 * Parse remote items from playlist XML to extract feed GUIDs
 */
export function parseRemoteItemsForFeeds(xmlText: string): string[] {
  const remoteItems: Array<{feedGuid: string, itemGuid: string}> = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
  
  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    remoteItems.push({
      feedGuid: match[1],
      itemGuid: match[2]
    });
  }
  
  // Return unique feed GUIDs
  return [...new Set(remoteItems.map(item => item.feedGuid))];
}