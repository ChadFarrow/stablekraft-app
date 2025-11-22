import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

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
    'User-Agent': 'StableKraft-Fix-Feeds/1.0'
  };
}

async function resolveFeedGuid(feedGuid: string, apiKey: string, apiSecret: string) {
  try {
    const headers = await generateHeaders(apiKey, apiSecret);
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();
    const feed = data.feed;

    if (data.status === 'true' && feed) {
      return {
        title: feed.title || 'Unknown Feed',
        artist: feed.author || feed.ownerName || 'Unknown Artist',
        url: feed.url,
        description: feed.description || '',
        image: feed.artwork || feed.image || ''
      };
    }

    return null;
  } catch (error) {
    console.error(`Error resolving ${feedGuid}:`, error);
    return null;
  }
}

async function main() {
  try {
    console.log('🔧 Fixing Unresolved Feed GUIDs\n');
    console.log('='.repeat(70));

    const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
    const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

    if (!apiKey || !apiSecret) {
      throw new Error('Missing PODCAST_INDEX_API_KEY or PODCAST_INDEX_API_SECRET');
    }

    // Get all unresolved feeds
    const unresolvedFeeds = await prisma.feed.findMany({
      where: {
        artist: 'Unresolved GUID'
      },
      orderBy: {
        id: 'asc'
      }
    });

    console.log(`\nFound ${unresolvedFeeds.length} unresolved feeds\n`);

    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < unresolvedFeeds.length; i++) {
      const feed = unresolvedFeeds[i];
      const progress = `[${i + 1}/${unresolvedFeeds.length}]`;

      console.log(`${progress} Resolving ${feed.id.slice(0, 8)}...`);

      // Resolve the feed GUID
      const resolvedData = await resolveFeedGuid(feed.id, apiKey, apiSecret);

      if (resolvedData) {
        try {
          // Check if another feed already has this URL
          const existingFeed = await prisma.feed.findFirst({
            where: {
              originalUrl: resolvedData.url,
              id: { not: feed.id }
            }
          });

          if (existingFeed) {
            console.log(`   ⚠️ Skipped - URL already exists in feed ${existingFeed.id}`);
            skippedCount++;
          } else {
            // Update the feed with resolved data
            await prisma.feed.update({
              where: { id: feed.id },
              data: {
                title: resolvedData.title,
                artist: resolvedData.artist,
                originalUrl: resolvedData.url,
                description: resolvedData.description,
                image: resolvedData.image,
                status: 'active',
                updatedAt: new Date()
              }
            });

            console.log(`   ✅ ${resolvedData.title} by ${resolvedData.artist}`);
            successCount++;
          }
        } catch (error) {
          console.error(`   ❌ Database error:`, error);
          failCount++;
        }
      } else {
        console.log(`   ❌ Could not resolve`);
        failCount++;
      }

      // Rate limiting - small delay every 10 requests
      if ((i + 1) % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`\n📊 Results:`);
    console.log(`   ✅ Successfully resolved: ${successCount}`);
    console.log(`   ⚠️ Skipped (duplicate URL): ${skippedCount}`);
    console.log(`   ❌ Failed to resolve: ${failCount}`);
    console.log(`   📦 Total processed: ${unresolvedFeeds.length}`);

    if (successCount > 0) {
      console.log(`\n💡 Next step: Run parse-feeds to fetch tracks from these ${successCount} feeds`);
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
