/**
 * Bulk Sync Script for Wavlake Feeds via Podcast Index API
 *
 * This script uses the Podcast Index API to discover and update Wavlake feeds
 * without hitting Wavlake's rate limits. It:
 * 1. Finds all error feeds with 429 status from Wavlake
 * 2. Searches Podcast Index for each feed
 * 3. Updates feed metadata and fetches fresh RSS data
 * 4. Implements proper rate limiting and retry logic
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

// Podcast Index API configuration
const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY!;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET!;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

// Rate limiting configuration
const RATE_LIMIT_DELAY = 3000; // 3 seconds between Wavlake requests
const PODCAST_INDEX_DELAY = 100; // 100ms between Podcast Index requests (much higher limits)
const BATCH_SIZE = 50; // Process in batches

interface PodcastIndexFeed {
  id: number;
  title: string;
  url: string;
  originalUrl: string;
  description: string;
  author: string;
  ownerName: string;
  image: string;
  artwork: string;
  lastUpdateTime: number;
  lastCrawlTime: number;
  lastParseTime: number;
  episodeCount: number;
  podcastGuid: string;
  medium: string;
  explicit: boolean;
}

/**
 * Generate Podcast Index API authentication headers
 */
function getPodcastIndexHeaders(): Record<string, string> {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');

  return {
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash,
    'User-Agent': 'StableKraft/1.0'
  };
}

/**
 * Search Podcast Index by feed URL
 */
async function searchPodcastIndexByUrl(feedUrl: string): Promise<PodcastIndexFeed | null> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      { headers }
    );

    if (!response.ok) {
      console.error(`Podcast Index API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.status === 'true' && data.feed) {
      return data.feed;
    }

    return null;
  } catch (error) {
    console.error(`Error searching Podcast Index:`, error);
    return null;
  }
}

/**
 * Search Podcast Index by title and author
 */
async function searchPodcastIndexByTerm(searchTerm: string): Promise<PodcastIndexFeed[]> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/search/byterm?q=${encodeURIComponent(searchTerm)}&max=5`,
      { headers }
    );

    if (!response.ok) {
      console.error(`Podcast Index API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();

    if (data.status === 'true' && data.feeds) {
      return data.feeds;
    }

    return [];
  } catch (error) {
    console.error(`Error searching Podcast Index:`, error);
    return [];
  }
}

/**
 * Update a single feed using Podcast Index data
 */
async function updateFeedFromPodcastIndex(
  feedId: string,
  feedUrl: string,
  title: string,
  artist: string
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`\n🔍 Processing: ${title} by ${artist}`);
    console.log(`   Feed URL: ${feedUrl}`);

    // First, try to find by URL
    let podcastIndexFeed = await searchPodcastIndexByUrl(feedUrl);

    // If not found by URL, try searching by title and artist
    if (!podcastIndexFeed) {
      console.log(`   Not found by URL, searching by term...`);
      await new Promise(resolve => setTimeout(resolve, PODCAST_INDEX_DELAY));

      const searchResults = await searchPodcastIndexByTerm(`${title} ${artist}`);

      // Find the best match from search results
      podcastIndexFeed = searchResults.find(f =>
        f.url === feedUrl ||
        f.originalUrl === feedUrl ||
        (f.title.toLowerCase() === title.toLowerCase() &&
         f.author.toLowerCase() === artist.toLowerCase())
      ) || null;
    }

    if (!podcastIndexFeed) {
      console.log(`   ⚠️  Not found in Podcast Index`);
      return { success: false, message: 'Not found in Podcast Index' };
    }

    console.log(`   ✅ Found in Podcast Index (${podcastIndexFeed.episodeCount} episodes)`);
    console.log(`   📡 Podcast GUID: ${podcastIndexFeed.podcastGuid}`);

    // Wait before fetching RSS to respect rate limits
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

    // Parse the RSS feed
    console.log(`   📥 Fetching RSS feed...`);
    const parsedFeed = await parseRSSFeedWithSegments(podcastIndexFeed.url);

    if (!parsedFeed || !parsedFeed.items || parsedFeed.items.length === 0) {
      console.log(`   ⚠️  RSS feed has no items`);
      return { success: false, message: 'RSS feed has no items' };
    }

    // Update feed in database
    console.log(`   💾 Updating database...`);
    await prisma.feed.update({
      where: { id: feedId },
      data: {
        title: parsedFeed.title,
        description: parsedFeed.description,
        artist: parsedFeed.artist,
        image: parsedFeed.image || podcastIndexFeed.image,
        language: parsedFeed.language,
        category: parsedFeed.category,
        explicit: parsedFeed.explicit || podcastIndexFeed.explicit,
        status: 'active',
        lastFetched: new Date(),
        lastError: null,
        updatedAt: new Date()
      }
    });

    // Delete old tracks and create new ones
    await prisma.track.deleteMany({
      where: { feedId }
    });

    const tracksData = parsedFeed.items.map((item, index) => ({
      id: `${feedId}-${item.guid || `track-${index}-${Date.now()}`}`,
      feedId: feedId,
      guid: item.guid,
      title: item.title,
      subtitle: item.subtitle,
      description: item.description,
      artist: item.artist,
      audioUrl: item.audioUrl,
      duration: item.duration,
      explicit: item.explicit,
      image: item.image,
      publishedAt: item.publishedAt,
      trackOrder: index,
      itunesAuthor: item.itunesAuthor,
      itunesSummary: item.itunesSummary,
      itunesImage: item.itunesImage,
      itunesDuration: item.itunesDuration,
      itunesKeywords: item.itunesKeywords || [],
      itunesCategories: item.itunesCategories || [],
      v4vRecipient: item.v4vRecipient,
      v4vValue: item.v4vValue,
      startTime: item.startTime,
      endTime: item.endTime,
      updatedAt: new Date()
    }));

    await prisma.track.createMany({
      data: tracksData,
      skipDuplicates: true
    });

    console.log(`   ✅ Successfully updated with ${parsedFeed.items.length} tracks`);
    return {
      success: true,
      message: `Updated with ${parsedFeed.items.length} tracks`
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`   ❌ Error: ${errorMessage}`);
    return { success: false, message: errorMessage };
  }
}

/**
 * Main sync function
 */
async function syncWavlakeFeeds() {
  console.log('🚀 Starting Wavlake Feed Sync via Podcast Index API\n');
  console.log('=' .repeat(70));

  // Check for API credentials
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.error('❌ Missing Podcast Index API credentials!');
    console.error('   Set PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET in .env.local');
    process.exit(1);
  }

  // Get all Wavlake feeds with 429 errors
  console.log('\n📊 Fetching error feeds from database...');
  const errorFeeds = await prisma.feed.findMany({
    where: {
      status: 'error',
      lastError: {
        contains: '429'
      },
      originalUrl: {
        contains: 'wavlake.com'
      }
    },
    select: {
      id: true,
      title: true,
      artist: true,
      originalUrl: true,
      lastError: true
    },
    orderBy: {
      updatedAt: 'asc' // Process oldest first
    }
  });

  console.log(`   Found ${errorFeeds.length} Wavlake feeds with rate limit errors`);

  if (errorFeeds.length === 0) {
    console.log('\n✅ No error feeds to sync!');
    await prisma.$disconnect();
    return;
  }

  // Process feeds in batches
  const stats = {
    total: errorFeeds.length,
    success: 0,
    notFound: 0,
    failed: 0,
    errors: [] as Array<{ feed: string; error: string }>
  };

  console.log(`\n🔄 Processing ${stats.total} feeds in batches of ${BATCH_SIZE}...`);
  console.log('=' .repeat(70));

  for (let i = 0; i < errorFeeds.length; i += BATCH_SIZE) {
    const batch = errorFeeds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(errorFeeds.length / BATCH_SIZE);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} feeds)`);
    console.log('-'.repeat(70));

    for (const feed of batch) {
      const result = await updateFeedFromPodcastIndex(
        feed.id,
        feed.originalUrl,
        feed.title,
        feed.artist
      );

      if (result.success) {
        stats.success++;
      } else if (result.message === 'Not found in Podcast Index') {
        stats.notFound++;
      } else {
        stats.failed++;
        stats.errors.push({
          feed: `${feed.title} by ${feed.artist}`,
          error: result.message
        });
      }

      // Progress indicator
      const processed = i + batch.indexOf(feed) + 1;
      const percentage = ((processed / stats.total) * 100).toFixed(1);
      console.log(`   Progress: ${processed}/${stats.total} (${percentage}%)`);
    }

    // Wait between batches
    if (i + BATCH_SIZE < errorFeeds.length) {
      console.log(`\n⏸️  Waiting 5 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📊 Sync Summary');
  console.log('='.repeat(70));
  console.log(`Total Feeds Processed: ${stats.total}`);
  console.log(`✅ Successfully Updated: ${stats.success}`);
  console.log(`⚠️  Not Found in Index: ${stats.notFound}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`Success Rate: ${((stats.success / stats.total) * 100).toFixed(1)}%`);

  if (stats.errors.length > 0) {
    console.log('\n❌ Errors:');
    stats.errors.slice(0, 10).forEach(e => {
      console.log(`   - ${e.feed}: ${e.error}`);
    });
    if (stats.errors.length > 10) {
      console.log(`   ... and ${stats.errors.length - 10} more errors`);
    }
  }

  console.log('\n✨ Sync complete!');
  await prisma.$disconnect();
}

// Run the sync
syncWavlakeFeeds().catch(error => {
  console.error('💥 Fatal error:', error);
  prisma.$disconnect();
  process.exit(1);
});
