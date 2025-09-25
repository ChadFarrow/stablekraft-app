import { NextRequest, NextResponse } from 'next/server';
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
    'User-Agent': 'FUCKIT-Feed-Populator/1.0'
  };
}

// Fetch feed data from Podcast Index API by GUID
async function fetchFeedByGuid(feedGuid: string) {
  try {
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      throw new Error('Podcast Index API credentials not configured');
    }

    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'true') {
      const feed = data.feed || (data.feeds && data.feeds[0]);
      if (feed) {
        return {
          guid: feedGuid,
          title: feed.title || 'Unknown Feed',
          description: feed.description || '',
          originalUrl: feed.url || '',
          image: feed.image || '/placeholder-podcast.jpg',
          language: feed.language || 'en',
          category: feed.categories ? Object.keys(feed.categories)[0] : 'Music',
          explicit: feed.explicit === 1,
          artist: feed.author || feed.title || 'Unknown Artist'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error fetching feed ${feedGuid}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { feedGuids } = body;

    console.log('🚀 Populate Feeds API called with', feedGuids?.length, 'feed GUIDs');

    // Validate inputs
    if (!feedGuids || !Array.isArray(feedGuids) || feedGuids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'feedGuids array is required' },
        { status: 400 }
      );
    }

    if (feedGuids.length > 100) {
      return NextResponse.json(
        { success: false, error: 'Maximum 100 feed GUIDs per request' },
        { status: 400 }
      );
    }

    const results = {
      total: feedGuids.length,
      created: 0,
      skipped: 0,
      failed: 0,
      details: [] as Array<{
        feedGuid: string;
        status: string;
        reason?: string;
        title?: string;
        originalUrl?: string;
      }>
    };

    console.log(`🔍 Processing ${feedGuids.length} feed GUIDs...`);

    for (const feedGuid of feedGuids) {
      try {
        // Check if feed already exists in database by ID (using feedGuid as ID)
        const existingFeed = await prisma.feed.findUnique({
          where: { id: feedGuid }
        });

        if (existingFeed) {
          console.log(`⚡ Feed ${feedGuid} already exists, skipping`);
          results.skipped++;
          results.details.push({
            feedGuid,
            status: 'skipped',
            reason: 'Feed already exists'
          });
          continue;
        }

        // Fetch feed data from Podcast Index
        const feedData = await fetchFeedByGuid(feedGuid);
        
        if (!feedData || !feedData.originalUrl) {
          console.log(`❌ Failed to fetch feed data for ${feedGuid}`);
          results.failed++;
          results.details.push({
            feedGuid,
            status: 'failed',
            reason: 'Could not fetch feed data from Podcast Index'
          });
          continue;
        }

        // Check if a feed with this originalUrl already exists
        const existingUrlFeed = await prisma.feed.findUnique({
          where: { originalUrl: feedData.originalUrl }
        });

        if (existingUrlFeed) {
          console.log(`⚡ Feed with URL ${feedData.originalUrl} already exists as ${existingUrlFeed.id}, skipping`);
          results.skipped++;
          results.details.push({
            feedGuid,
            status: 'skipped',
            reason: `Feed URL already exists as ${existingUrlFeed.id}`
          });
          continue;
        }

        // Create feed in database
        const newFeed = await prisma.feed.create({
          data: {
            id: feedGuid, // Use feedGuid as the ID
            originalUrl: feedData.originalUrl,
            type: 'album', // Default to album for music feeds
            title: feedData.title,
            description: feedData.description,
            artist: feedData.artist,
            image: feedData.image,
            language: feedData.language,
            category: feedData.category,
            explicit: feedData.explicit,
            priority: 'normal',
            status: 'active'
          }
        });

        console.log(`✅ Created feed ${feedGuid}: ${feedData.title}`);
        results.created++;
        results.details.push({
          feedGuid,
          status: 'created',
          title: feedData.title,
          originalUrl: feedData.originalUrl
        });

      } catch (error) {
        console.error(`❌ Error processing feed ${feedGuid}:`, error);
        results.failed++;
        results.details.push({
          feedGuid,
          status: 'failed',
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log(`✅ Populate feeds completed: ${results.created} created, ${results.skipped} skipped, ${results.failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Processed ${results.total} feed GUIDs`,
      results
    });

  } catch (error) {
    console.error('❌ Error in populate feeds API:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to populate feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}