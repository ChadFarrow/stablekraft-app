import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { USER_AGENT } from '../lib/user-agent';

const prisma = new PrismaClient();

async function generateHeaders(apiKey: string, apiSecret: string) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');

  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': USER_AGENT
  };
}

async function testResolveFeedGuid(feedGuid: string) {
  try {
    const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
    const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

    if (!apiKey || !apiSecret) {
      console.error('❌ Missing API keys!');
      return null;
    }

    const headers = await generateHeaders(apiKey, apiSecret);

    console.log(`\n🔍 Testing feed GUID: ${feedGuid}`);
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });

    if (!response.ok) {
      console.log(`   ❌ API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();
    const feed = data.feed || (data.feeds && data.feeds[0]);

    if (data.status === 'true' && feed) {
      console.log(`   ✅ Resolved!`);
      console.log(`   Title: ${feed.title}`);
      console.log(`   Author: ${feed.author || 'N/A'}`);
      console.log(`   URL: ${feed.url}`);
      return feed;
    } else {
      console.log(`   ⚠️ API says: status=${data.status}, feed exists=${!!feed}`);
      console.log(`   Response:`, JSON.stringify(data, null, 2).slice(0, 200));
      return null;
    }
  } catch (error) {
    console.error(`   ❌ Error:`, error);
    return null;
  }
}

async function main() {
  try {
    console.log('📊 Testing Feed GUID Resolution\n');
    console.log('='.repeat(60));

    // Get a sample of unresolved feeds
    const unresolvedFeeds = await prisma.feed.findMany({
      where: {
        artist: 'Unresolved GUID'
      },
      take: 10,
      orderBy: {
        id: 'asc'
      }
    });

    console.log(`Found ${unresolvedFeeds.length} sample unresolved feeds to test\n`);

    let successCount = 0;
    let failCount = 0;

    for (const feed of unresolvedFeeds) {
      const result = await testResolveFeedGuid(feed.id);
      if (result) {
        successCount++;
      } else {
        failCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📈 Results:`);
    console.log(`   ✅ Successfully resolved: ${successCount} / ${unresolvedFeeds.length}`);
    console.log(`   ❌ Failed to resolve: ${failCount} / ${unresolvedFeeds.length}`);

    if (successCount > 0) {
      console.log(`\n💡 Good news: ${successCount} feeds CAN be resolved!`);
      console.log(`   This suggests the feeds exist but weren't resolved properly initially.`);
    } else {
      console.log(`\n⚠️ None of the feeds could be resolved.`);
      console.log(`   This could mean:`);
      console.log(`   1. The feed GUIDs are invalid/outdated`);
      console.log(`   2. The feeds were removed from Podcast Index`);
      console.log(`   3. There's an issue with the API keys`);
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
