import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const SAS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml';

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
    'User-Agent': 'FUCKIT-SAS-Feed-Populator/1.0'
  };
}

async function fetchPlaylistXML(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status}`);
  }
  return await response.text();
}

function parseRemoteItems(xmlText: string) {
  const remoteItems: Array<{feedGuid: string, itemGuid: string}> = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
  
  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    remoteItems.push({
      feedGuid: match[1],
      itemGuid: match[2]
    });
  }
  
  return remoteItems;
}

async function fetchFeedFromPodcastIndex(feedGuid: string) {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    return null;
  }

  try {
    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'true') {
        return data.feed || (data.feeds && data.feeds[0]);
      }
    }
  } catch (error) {
    console.error(`❌ Error fetching feed ${feedGuid}:`, error);
  }
  
  return null;
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Starting comprehensive SAS feed population...');
    
    // Fetch SAS playlist XML
    const xmlText = await fetchPlaylistXML(SAS_PLAYLIST_URL);
    console.log(`📄 Fetched SAS playlist XML, length: ${xmlText.length}`);
    
    // Parse remote items to get all feed GUIDs
    const remoteItems = parseRemoteItems(xmlText);
    const allFeedGuids = [...new Set(remoteItems.map(item => item.feedGuid))];
    console.log(`📊 Found ${allFeedGuids.length} unique feed GUIDs in SAS playlist`);
    
    // Check which feeds already exist in database
    const existingFeeds = await prisma.feed.findMany({
      where: {
        id: { in: allFeedGuids }
      },
      select: {
        id: true,
        title: true
      }
    });
    
    const existingFeedGuids = new Set(existingFeeds.map(f => f.id).filter(Boolean));
    console.log(`📊 Found ${existingFeeds.length} existing feeds in database`);
    
    // Identify missing feeds
    const missingFeedGuids = allFeedGuids.filter(guid => !existingFeedGuids.has(guid));
    console.log(`🔍 Need to populate ${missingFeedGuids.length} missing feeds`);
    
    let successCount = 0;
    let failCount = 0;
    const errors: Array<{ feedGuid: string; error: string }> = [];
    
    // Process missing feeds in smaller batches
    const BATCH_SIZE = 5; // Smaller batches to avoid rate limiting
    for (let i = 0; i < missingFeedGuids.length; i += BATCH_SIZE) {
      const batch = missingFeedGuids.slice(i, Math.min(i + BATCH_SIZE, missingFeedGuids.length));
      console.log(`📦 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(missingFeedGuids.length/BATCH_SIZE)} (${batch.length} feeds)`);
      
      await Promise.all(batch.map(async (feedGuid) => {
        try {
          const feedData = await fetchFeedFromPodcastIndex(feedGuid);
          
          if (feedData) {
            // Create feed in database
            await prisma.feed.create({
              data: {
                id: feedGuid, // Use feedGuid as ID for consistency
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
            
            successCount++;
            console.log(`✅ Created feed: ${feedData.title} (${feedGuid})`);
          } else {
            failCount++;
            const errorMsg = 'Feed not found in Podcast Index';
            errors.push({ feedGuid, error: errorMsg });
            console.log(`⚠️  Could not find feed: ${feedGuid}`);
          }
        } catch (error: any) {
          failCount++;
          const errorMsg = error.message || 'Unknown error';
          errors.push({ feedGuid, error: errorMsg });
          
          // Handle duplicate key errors gracefully
          if (errorMsg.includes('unique constraint') || errorMsg.includes('duplicate key')) {
            console.log(`⚡ Feed ${feedGuid} already exists, skipping`);
          } else {
            console.error(`❌ Error processing feed ${feedGuid}:`, errorMsg);
          }
        }
      }));
      
      // Add delay between batches to respect rate limits
      if (i + BATCH_SIZE < missingFeedGuids.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      }
    }
    
    // Get final database stats
    const totalFeeds = await prisma.feed.count();
    const sasFeeds = await prisma.feed.count({
      where: { id: { in: allFeedGuids } }
    });
    
    const summary = {
      success: true,
      message: 'SAS feed population completed',
      stats: {
        totalFeedGuidsInPlaylist: allFeedGuids.length,
        feedsAlreadyExisted: existingFeeds.length,
        feedsToPopulate: missingFeedGuids.length,
        feedsSuccessfullyCreated: successCount,
        feedsFailed: failCount,
        finalSasFeeds: sasFeeds,
        totalDatabaseFeeds: totalFeeds,
        populationRate: `${((existingFeeds.length + successCount) / allFeedGuids.length * 100).toFixed(1)}%`
      },
      errors: errors.slice(0, 20) // Return first 20 errors
    };
    
    console.log('✅ SAS feed population completed:', summary.stats);
    
    return NextResponse.json(summary);
    
  } catch (error) {
    console.error('❌ SAS feed population error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to populate SAS feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Return current status
    const totalFeeds = await prisma.feed.count();
    
    return NextResponse.json({
      status: 'ready',
      message: 'POST to this endpoint to populate all missing SAS feeds from Podcast Index',
      database: {
        totalFeeds
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Database error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}