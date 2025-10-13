/**
 * Small Batch Sync Test - Processes first 10 Wavlake feeds
 * Run this first to verify everything works before the full sync
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY!;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET!;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';
const RATE_LIMIT_DELAY = 3000;
const PODCAST_INDEX_DELAY = 100;
const TEST_BATCH_SIZE = 10; // Only process 10 feeds for testing

interface PodcastIndexFeed {
  id: number;
  title: string;
  url: string;
  originalUrl: string;
  description: string;
  author: string;
  image: string;
  episodeCount: number;
  podcastGuid: string;
  medium: string;
  explicit: boolean;
}

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

async function searchPodcastIndexByUrl(feedUrl: string): Promise<PodcastIndexFeed | null> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      { headers }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return (data.status === 'true' && data.feed) ? data.feed : null;
  } catch (error) {
    return null;
  }
}

async function updateFeedFromPodcastIndex(
  feedId: string,
  feedUrl: string,
  title: string,
  artist: string
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`\n🔍 ${title} by ${artist}`);

    const podcastIndexFeed = await searchPodcastIndexByUrl(feedUrl);

    if (!podcastIndexFeed) {
      console.log(`   ⚠️  Not found in Podcast Index`);
      return { success: false, message: 'Not found in Podcast Index' };
    }

    console.log(`   ✅ Found (${podcastIndexFeed.episodeCount} episodes)`);

    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

    console.log(`   📥 Fetching RSS...`);
    const parsedFeed = await parseRSSFeedWithSegments(podcastIndexFeed.url);

    if (!parsedFeed || !parsedFeed.items || parsedFeed.items.length === 0) {
      console.log(`   ⚠️  RSS feed has no items`);
      return { success: false, message: 'RSS feed has no items' };
    }

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

    await prisma.track.deleteMany({ where: { feedId } });

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

    console.log(`   ✅ Updated with ${parsedFeed.items.length} tracks`);
    return { success: true, message: `Updated with ${parsedFeed.items.length} tracks` };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`   ❌ ${errorMessage}`);
    return { success: false, message: errorMessage };
  }
}

async function syncSmallBatch() {
  console.log('🧪 Small Batch Sync Test (10 feeds)\n');
  console.log('=' .repeat(70));

  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.error('❌ Missing Podcast Index API credentials!');
    process.exit(1);
  }

  const errorFeeds = await prisma.feed.findMany({
    where: {
      status: 'error',
      lastError: { contains: '429' },
      originalUrl: { contains: 'wavlake.com' }
    },
    select: {
      id: true,
      title: true,
      artist: true,
      originalUrl: true
    },
    take: TEST_BATCH_SIZE,
    orderBy: { updatedAt: 'asc' }
  });

  console.log(`📊 Processing ${errorFeeds.length} feeds...`);

  const stats = { total: errorFeeds.length, success: 0, notFound: 0, failed: 0 };

  for (let i = 0; i < errorFeeds.length; i++) {
    const feed = errorFeeds[i];
    console.log(`\n[${i + 1}/${errorFeeds.length}]`);

    const result = await updateFeedFromPodcastIndex(
      feed.id,
      feed.originalUrl,
      feed.title,
      feed.artist
    );

    if (result.success) stats.success++;
    else if (result.message === 'Not found in Podcast Index') stats.notFound++;
    else stats.failed++;
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 Test Summary');
  console.log('='.repeat(70));
  console.log(`Total: ${stats.total}`);
  console.log(`✅ Success: ${stats.success}`);
  console.log(`⚠️  Not Found: ${stats.notFound}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`Success Rate: ${((stats.success / stats.total) * 100).toFixed(1)}%`);

  if (stats.success > 0) {
    console.log('\n✨ Test successful! Ready to run full sync:');
    console.log('   npx tsx scripts/sync-wavlake-feeds.ts');
  }

  await prisma.$disconnect();
}

syncSmallBatch().catch(error => {
  console.error('💥 Fatal error:', error);
  prisma.$disconnect();
  process.exit(1);
});
