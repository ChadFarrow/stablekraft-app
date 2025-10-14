/**
 * FAST Wavlake Feed Sync - Uses ONLY Podcast Index API
 *
 * This version is 10-15x faster because it gets ALL data from Podcast Index:
 * - Feed metadata
 * - Episode/track data
 * - V4V payment info
 * - Audio URLs
 *
 * NO Wavlake RSS fetching = NO rate limits!
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY!;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET!;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';
const API_DELAY = 150; // 150ms between requests (much faster!)
const BATCH_SIZE = 100; // Larger batches since we're much faster

interface PodcastIndexFeed {
  id: number;
  title: string;
  url: string;
  description: string;
  author: string;
  image: string;
  episodeCount: number;
  podcastGuid: string;
  medium: string;
  explicit: boolean;
  language: string;
  categories: any;
}

interface PodcastIndexEpisode {
  id: number;
  title: string;
  description: string;
  duration: number;
  enclosureUrl: string;
  datePublished: number;
  image: string;
  explicit: number;
  guid: string;
  value?: {
    model: { type: string; method: string };
    destinations: Array<{
      name: string;
      address: string;
      type: string;
      split: number;
      customKey?: string;
      customValue?: string;
      fee?: boolean;
    }>;
  };
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

async function getFeedFromPodcastIndex(feedUrl: string): Promise<PodcastIndexFeed | null> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      { headers }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.status === 'true' && data.feed ? data.feed : null;
  } catch (error) {
    return null;
  }
}

async function getEpisodesFromPodcastIndex(feedId: number): Promise<PodcastIndexEpisode[]> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/episodes/byfeedid?id=${feedId}`,
      { headers }
    );

    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  } catch (error) {
    return [];
  }
}

async function updateFeedFromPodcastIndexOnly(
  dbFeedId: string,
  feedUrl: string,
  title: string,
  artist: string
): Promise<{ success: boolean; message: string; tracksAdded?: number }> {
  try {
    console.log(`🔍 ${title} by ${artist}`);

    // Get feed metadata from Podcast Index
    const podcastIndexFeed = await getFeedFromPodcastIndex(feedUrl);
    if (!podcastIndexFeed) {
      console.log(`   ⚠️  Not found in Podcast Index`);
      return { success: false, message: 'Not found in Podcast Index' };
    }

    console.log(`   ✅ Found (${podcastIndexFeed.episodeCount} episodes)`);

    // Small delay before episodes request
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    // Get episodes from Podcast Index (NO Wavlake fetch!)
    console.log(`   📥 Fetching episodes from Podcast Index...`);
    const episodes = await getEpisodesFromPodcastIndex(podcastIndexFeed.id);

    if (episodes.length === 0) {
      console.log(`   ⚠️  No episodes found`);
      return { success: false, message: 'No episodes found' };
    }

    console.log(`   💾 Updating database with ${episodes.length} tracks...`);

    // Update feed in database
    await prisma.feed.update({
      where: { id: dbFeedId },
      data: {
        title: podcastIndexFeed.title,
        description: podcastIndexFeed.description,
        artist: podcastIndexFeed.author || artist,
        image: podcastIndexFeed.image,
        language: podcastIndexFeed.language,
        category: podcastIndexFeed.categories ? JSON.stringify(podcastIndexFeed.categories) : null,
        explicit: podcastIndexFeed.explicit,
        status: 'active',
        lastFetched: new Date(),
        lastError: null,
        updatedAt: new Date()
      }
    });

    // Delete old tracks
    await prisma.track.deleteMany({ where: { feedId: dbFeedId } });

    // Create new tracks from Podcast Index episode data
    const tracksData = episodes.map((episode, index) => {
      // Extract V4V recipient from value tag
      let v4vRecipient = null;
      let v4vValue = null;

      if (episode.value && episode.value.destinations) {
        // Find the main recipient (not fee recipients)
        const mainRecipient = episode.value.destinations.find(d => !d.fee);
        if (mainRecipient) {
          v4vRecipient = mainRecipient.address;
          v4vValue = episode.value;
        }
      }

      return {
        id: `${dbFeedId}-${episode.guid || `track-${index}-${Date.now()}`}`,
        feedId: dbFeedId,
        guid: episode.guid,
        title: episode.title,
        description: episode.description,
        artist: podcastIndexFeed.author || artist,
        audioUrl: episode.enclosureUrl,
        duration: episode.duration,
        explicit: episode.explicit === 1,
        image: episode.image || podcastIndexFeed.image,
        publishedAt: new Date(episode.datePublished * 1000),
        trackOrder: index,
        v4vRecipient,
        v4vValue: v4vValue ?? undefined,
        updatedAt: new Date()
      };
    });

    await prisma.track.createMany({
      data: tracksData,
      skipDuplicates: true
    });

    console.log(`   ✅ Updated with ${episodes.length} tracks`);
    return {
      success: true,
      message: `Updated with ${episodes.length} tracks`,
      tracksAdded: episodes.length
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`   ❌ ${errorMessage}`);
    return { success: false, message: errorMessage };
  }
}

async function syncFast() {
  console.log('🚀 FAST Wavlake Feed Sync via Podcast Index API ONLY\n');
  console.log('=' .repeat(70));

  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.error('❌ Missing Podcast Index API credentials!');
    process.exit(1);
  }

  console.log('\n📊 Fetching error feeds from database...');
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
    orderBy: { updatedAt: 'asc' }
  });

  console.log(`   Found ${errorFeeds.length} Wavlake feeds with rate limit errors`);

  if (errorFeeds.length === 0) {
    console.log('\n✅ No error feeds to sync!');
    await prisma.$disconnect();
    return;
  }

  const stats = {
    total: errorFeeds.length,
    success: 0,
    notFound: 0,
    failed: 0,
    totalTracks: 0
  };

  console.log(`\n🔄 Processing ${stats.total} feeds in batches of ${BATCH_SIZE}...`);
  console.log('⚡ Using ONLY Podcast Index API = NO RATE LIMITS!');
  console.log('=' .repeat(70));

  const startTime = Date.now();

  for (let i = 0; i < errorFeeds.length; i += BATCH_SIZE) {
    const batch = errorFeeds.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(errorFeeds.length / BATCH_SIZE);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} feeds)`);
    console.log('-'.repeat(70));

    for (const feed of batch) {
      const result = await updateFeedFromPodcastIndexOnly(
        feed.id,
        feed.originalUrl,
        feed.title,
        feed.artist || 'Unknown Artist'
      );

      if (result.success) {
        stats.success++;
        stats.totalTracks += result.tracksAdded || 0;
      } else if (result.message === 'Not found in Podcast Index') {
        stats.notFound++;
      } else {
        stats.failed++;
      }

      const processed = i + batch.indexOf(feed) + 1;
      const percentage = ((processed / stats.total) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (processed / (Date.now() - startTime) * 1000 * 60).toFixed(1);
      console.log(`   Progress: ${processed}/${stats.total} (${percentage}%) | ${elapsed}s elapsed | ${rate} feeds/min`);

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, API_DELAY));
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n' + '='.repeat(70));
  console.log('📊 Sync Summary');
  console.log('='.repeat(70));
  console.log(`Total Feeds Processed: ${stats.total}`);
  console.log(`✅ Successfully Updated: ${stats.success}`);
  console.log(`📀 Total Tracks Added: ${stats.totalTracks}`);
  console.log(`⚠️  Not Found in Index: ${stats.notFound}`);
  console.log(`❌ Failed: ${stats.failed}`);
  console.log(`Success Rate: ${((stats.success / stats.total) * 100).toFixed(1)}%`);
  console.log(`⏱️  Total Time: ${totalTime} minutes`);
  console.log(`🚀 Speed: ${(stats.success / parseFloat(totalTime)).toFixed(1)} feeds/minute`);

  console.log('\n✨ Fast sync complete!');
  await prisma.$disconnect();
}

syncFast().catch(error => {
  console.error('💥 Fatal error:', error);
  prisma.$disconnect();
  process.exit(1);
});
