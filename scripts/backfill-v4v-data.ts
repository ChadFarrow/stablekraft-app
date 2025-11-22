import { PrismaClient, Prisma } from '@prisma/client';
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
    'User-Agent': 'StableKraft-Backfill-V4V/1.0'
  };
}

async function main() {
  try {
    console.log('🔧 Backfilling V4V Payment Data\n');
    console.log('='.repeat(70));

    const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
    const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

    if (!apiKey || !apiSecret) {
      throw new Error('Missing API keys');
    }

    // Get tracks missing V4V data, grouped by feed
    const tracksWithoutV4V = await prisma.track.findMany({
      where: {
        v4vRecipient: null, // Use the string field instead of JSON field for null check
        Feed: {
          originalUrl: {
            contains: 'wavlake.com' // Focus on Wavlake tracks first
          }
        }
      },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            originalUrl: true
          }
        }
      },
      orderBy: {
        feedId: 'asc'
      }
    });

    console.log(`\nFound ${tracksWithoutV4V.length} Wavlake tracks without V4V data\n`);

    let updatedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Group tracks by feed to minimize API calls
    const tracksByFeed = new Map<string, typeof tracksWithoutV4V>();
    tracksWithoutV4V.forEach(track => {
      if (!tracksByFeed.has(track.feedId)) {
        tracksByFeed.set(track.feedId, []);
      }
      tracksByFeed.get(track.feedId)!.push(track);
    });

    console.log(`Processing ${tracksByFeed.size} feeds...\n`);

    let feedIndex = 0;
    for (const [feedId, tracks] of tracksByFeed.entries()) {
      feedIndex++;
      const feed = tracks[0].Feed;
      const progress = `[${feedIndex}/${tracksByFeed.size}]`;

      console.log(`${progress} ${feed.title} (${tracks.length} tracks)`);

      try {
        // Get episodes from Podcast Index API using feed GUID
        const headers = await generateHeaders(apiKey, apiSecret);
        const response = await fetch(
          `https://api.podcastindex.org/api/1.0/episodes/bypodcastguid?guid=${encodeURIComponent(feedId)}`,
          { headers }
        );

        if (!response.ok) {
          console.log(`   ⚠️ API error: ${response.status}`);
          failedCount += tracks.length;
          continue;
        }

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
          console.log(`   ⚠️ No episodes found in API`);
          skippedCount += tracks.length;
          continue;
        }

        // Create a map of episodes by GUID for quick lookup
        const episodeMap = new Map(
          data.items.map((ep: any) => [ep.guid, ep])
        );

        let feedUpdatedCount = 0;

        for (const track of tracks) {
          const episode = episodeMap.get(track.guid);

          if (!episode) {
            continue;
          }

          if (!episode.value || !episode.value.destinations) {
            continue;
          }

          // Format V4V data for database
          const v4vData = {
            type: episode.value.model?.type || 'lightning',
            method: episode.value.model?.method || 'keysend',
            suggested: episode.value.model?.suggested,
            recipients: episode.value.destinations.map((r: any) => ({
              name: r.name,
              type: r.type,
              address: r.address,
              split: r.split,
              customKey: r.customKey,
              customValue: r.customValue,
              fee: r.fee || false
            }))
          };

          // Extract lightning address from first recipient if it's a node address
          const firstRecipient = episode.value.destinations[0];
          const v4vRecipient = firstRecipient?.address || null;

          // Update track with V4V data
          await prisma.track.update({
            where: { id: track.id },
            data: {
              v4vValue: v4vData,
              v4vRecipient: v4vRecipient,
              updatedAt: new Date()
            }
          });

          feedUpdatedCount++;
          updatedCount++;
        }

        console.log(`   ✅ Updated ${feedUpdatedCount} tracks`);

        // Rate limiting
        if (feedIndex % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        console.error(`   ❌ Error:`, error);
        failedCount += tracks.length;
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`\n📊 Results:`);
    console.log(`   ✅ Tracks updated: ${updatedCount}`);
    console.log(`   ⚠️ Tracks skipped: ${skippedCount}`);
    console.log(`   ❌ Tracks failed: ${failedCount}`);
    console.log(`   📦 Total processed: ${tracksWithoutV4V.length}`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
