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
        podcastIndexId: feed.id.toString(),
        title: feed.title || 'Unknown Feed',
        artist: feed.author || feed.ownerName || 'Unknown Artist',
        url: feed.url
      };
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function main() {
  try {
    console.log('🔧 Reassigning Tracks to Correct Feeds\n');
    console.log('='.repeat(70));

    const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
    const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

    if (!apiKey || !apiSecret) {
      throw new Error('Missing API keys');
    }

    // Get all unresolved feeds
    const unresolvedFeeds = await prisma.feed.findMany({
      where: {
        artist: 'Unresolved GUID'
      },
      include: {
        Track: {
          select: {
            id: true
          }
        }
      }
    });

    console.log(`\nFound ${unresolvedFeeds.length} unresolved feeds\n`);

    let reassignedCount = 0;
    let deletedFeedsCount = 0;
    let failedCount = 0;

    for (let i = 0; i < unresolvedFeeds.length; i++) {
      const unresolvedFeed = unresolvedFeeds[i];
      const progress = `[${i + 1}/${unresolvedFeeds.length}]`;
      const trackCount = unresolvedFeed.Track.length;

      if (trackCount === 0) {
        // No tracks - just delete the feed
        await prisma.feed.delete({ where: { id: unresolvedFeed.id } });
        console.log(`${progress} ${unresolvedFeed.id.slice(0, 8)}... - Deleted (no tracks)`);
        deletedFeedsCount++;
        continue;
      }

      console.log(`${progress} ${unresolvedFeed.id.slice(0, 8)}... (${trackCount} tracks)`);

      // Resolve the GUID to get the correct feed ID
      const resolvedData = await resolveFeedGuid(unresolvedFeed.id, apiKey, apiSecret);

      if (!resolvedData) {
        console.log(`   ❌ Could not resolve - keeping as is`);
        failedCount++;
        continue;
      }

      // Look for the correct feed by Podcast Index ID or URL
      const correctFeed = await prisma.feed.findFirst({
        where: {
          OR: [
            { id: resolvedData.podcastIndexId },
            { originalUrl: resolvedData.url }
          ]
        }
      });

      if (correctFeed) {
        // Reassign all tracks from unresolved feed to correct feed
        const updated = await prisma.track.updateMany({
          where: { feedId: unresolvedFeed.id },
          data: { feedId: correctFeed.id }
        });

        console.log(`   ✅ Reassigned ${updated.count} tracks to feed ${correctFeed.id} (${correctFeed.title})`);

        // Delete the unresolved feed
        await prisma.feed.delete({ where: { id: unresolvedFeed.id } });

        reassignedCount += updated.count;
        deletedFeedsCount++;
      } else {
        // Correct feed doesn't exist - update the unresolved feed with correct data
        await prisma.feed.update({
          where: { id: unresolvedFeed.id },
          data: {
            title: resolvedData.title,
            artist: resolvedData.artist,
            originalUrl: resolvedData.url,
            status: 'active',
            updatedAt: new Date()
          }
        });

        console.log(`   ✅ Updated feed with resolved data: ${resolvedData.title}`);
        reassignedCount += trackCount;
      }

      // Rate limiting
      if ((i + 1) % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`\n📊 Results:`);
    console.log(`   ✅ Tracks reassigned/fixed: ${reassignedCount}`);
    console.log(`   🗑️  Feeds deleted: ${deletedFeedsCount}`);
    console.log(`   ❌ Failed to resolve: ${failedCount}`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
