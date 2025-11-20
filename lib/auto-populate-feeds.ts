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
    'User-Agent': 'StableKraft-Auto-Feed-Populator/1.0'
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
      where: { id: { in: feedGuids } },
      select: { id: true }
    });

    const existingFeedGuids = new Set(existingFeeds.map(f => f.id).filter(Boolean));
    const missingFeedGuids = feedGuids.filter(guid => !existingFeedGuids.has(guid));

    if (missingFeedGuids.length === 0) {
      console.log(`✅ All ${feedGuids.length} feed GUIDs already exist in database`);
      return 0;
    }

    console.log(`🚀 Auto-populating ${missingFeedGuids.length} missing feeds from Podcast Index for ${playlistName}...`);

    // Track time to prevent timeouts (stop at 4 minutes to leave buffer)
    const startTime = Date.now();
    const MAX_DURATION_MS = 4 * 60 * 1000; // 4 minutes max

    let autoPopulatedCount = 0;
    let errorCount = 0;
    let processedCount = 0;
    
    // Process feeds in batches with parallel processing for speed
    const BATCH_SIZE = 10; // Process 10 feeds per batch
    for (let i = 0; i < missingFeedGuids.length; i += BATCH_SIZE) {
      // Check if we're approaching timeout
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > MAX_DURATION_MS) {
        console.log(`⏱️ Approaching timeout after ${Math.round(elapsedTime / 1000)}s, stopping. Processed ${processedCount}/${missingFeedGuids.length} feeds.`);
        break;
      }

      const batch = missingFeedGuids.slice(i, Math.min(i + BATCH_SIZE, missingFeedGuids.length));

      // Process batch in parallel for speed
      const batchResults = await Promise.allSettled(batch.map(async (feedGuid) => {
        // Check if feed was created by another process
        const existingFeed = await prisma.feed.findUnique({
          where: { id: feedGuid },
          select: { id: true }
        });

        if (existingFeed) {
          return { status: 'exists', feedGuid };
        }

        const headers = await generateHeaders(PODCAST_INDEX_API_KEY!, PODCAST_INDEX_API_SECRET!);
        const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
          headers,
          signal: AbortSignal.timeout(5000) // 5 second timeout per request
        });

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'true') {
            const feedData = data.feed || (data.feeds && data.feeds[0]);
            if (feedData) {
              await prisma.feed.create({
                data: {
                  id: feedGuid,
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
              return { status: 'created', feedGuid, title: feedData.title };
            }
          }
        }
        return { status: 'not_found', feedGuid };
      }));

      // Process results
      for (const result of batchResults) {
        processedCount++;
        if (result.status === 'fulfilled') {
          const value = result.value;
          if (value.status === 'created') {
            autoPopulatedCount++;
            console.log(`✅ Auto-created feed: ${value.title} (${value.feedGuid.slice(0, 8)}...)`);
          } else if (value.status === 'exists') {
            console.log(`⚡ Feed ${value.feedGuid.slice(0, 8)}... already exists, skipping`);
          }
        } else if (result.status === 'rejected') {
          const error: any = result.reason;
          // Handle duplicates gracefully
          if (error.code === 'P2002' || error.message?.includes('unique constraint') || error.message?.includes('duplicate key')) {
            console.log(`⚡ Feed already exists (duplicate), skipping`);
          } else if (error.name === 'AbortError') {
            console.log(`⏱️ Timeout fetching feed`);
            errorCount++;
          } else {
            console.log(`⚠️ Could not auto-populate feed: ${error.message?.slice(0, 50)}`);
            errorCount++;
          }
        }
      }

      // Stop if we're getting too many errors
      if (errorCount > 20) {
        console.log(`❌ Too many errors (${errorCount}), stopping auto-population`);
        break;
      }

      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < missingFeedGuids.length && errorCount <= 20) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Reduced to 100ms for faster processing
      }
    }
    
    const elapsedTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`🎯 Auto-populated ${autoPopulatedCount} feeds for ${playlistName} in ${elapsedTime}s (processed ${processedCount}/${missingFeedGuids.length} total) - this should improve track resolution!`);
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