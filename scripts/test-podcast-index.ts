/**
 * Test script to verify Podcast Index API integration
 * Tests a few error feeds before running the full sync
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY!;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET!;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

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

async function testPodcastIndex() {
  console.log('🧪 Testing Podcast Index API Integration\n');
  console.log('=' .repeat(70));

  // Check credentials
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.error('❌ Missing Podcast Index API credentials!');
    process.exit(1);
  }

  console.log('✅ API credentials found');

  // Get a few error feeds to test
  console.log('\n📊 Fetching sample error feeds...');
  const sampleFeeds = await prisma.feed.findMany({
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
    take: 5
  });

  console.log(`   Found ${sampleFeeds.length} sample feeds to test\n`);

  // Test each feed
  for (let i = 0; i < sampleFeeds.length; i++) {
    const feed = sampleFeeds[i];
    console.log(`\n[${i + 1}/${sampleFeeds.length}] Testing: ${feed.title} by ${feed.artist}`);
    console.log(`   URL: ${feed.originalUrl}`);

    try {
      // Try finding by URL
      const headers = getPodcastIndexHeaders();
      const response = await fetch(
        `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feed.originalUrl)}`,
        { headers }
      );

      const data = await response.json();

      if (data.status === 'true' && data.feed) {
        console.log(`   ✅ Found in Podcast Index!`);
        console.log(`      Title: ${data.feed.title}`);
        console.log(`      Author: ${data.feed.author}`);
        console.log(`      Episodes: ${data.feed.episodeCount}`);
        console.log(`      GUID: ${data.feed.podcastGuid}`);
        console.log(`      Medium: ${data.feed.medium}`);
      } else {
        console.log(`   ⚠️  Not found by URL, trying search...`);

        // Try search by term
        await new Promise(resolve => setTimeout(resolve, 100));
        const searchResponse = await fetch(
          `${PODCAST_INDEX_BASE_URL}/search/byterm?q=${encodeURIComponent(feed.title + ' ' + feed.artist)}&max=3`,
          { headers: getPodcastIndexHeaders() }
        );

        const searchData = await searchResponse.json();

        if (searchData.feeds && searchData.feeds.length > 0) {
          console.log(`   📝 Search found ${searchData.feeds.length} results:`);
          searchData.feeds.forEach((f: any, idx: number) => {
            console.log(`      [${idx + 1}] ${f.title} by ${f.author}`);
            console.log(`          URL: ${f.url}`);
            console.log(`          Match: ${f.url === feed.originalUrl ? '✅ EXACT' : '⚠️  Different'}`);
          });
        } else {
          console.log(`   ❌ Not found in search either`);
        }
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Test complete!\n');
  console.log('If feeds were found, you can run the full sync with:');
  console.log('   npx tsx scripts/sync-wavlake-feeds.ts\n');

  await prisma.$disconnect();
}

testPodcastIndex().catch(error => {
  console.error('💥 Fatal error:', error);
  prisma.$disconnect();
  process.exit(1);
});
