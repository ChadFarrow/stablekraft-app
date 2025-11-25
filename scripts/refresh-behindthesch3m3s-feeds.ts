/**
 * One-time migration script to update all behindthesch3m3s.com feeds
 * to use the newest Podcast Index entry (for correct V4V payment data)
 *
 * Run with: npx dotenv -e .env.local -- npx tsx scripts/refresh-behindthesch3m3s-feeds.ts
 */

import { PrismaClient } from '@prisma/client';
import { getFeedByUrlPreferNewest, PodcastIndexFeed } from '../lib/podcast-index-api';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

interface UpdateResult {
  feedId: string;
  title: string;
  oldUrl: string;
  newUrl: string;
  oldPodcastIndexId?: number;
  newPodcastIndexId?: number;
  tracksUpdated: number;
  v4vUpdated: number;
}

async function main() {
  console.log('\n🔍 Finding all behindthesch3m3s.com feeds in database...\n');

  // Find all feeds from behindthesch3m3s.com
  const feeds = await prisma.feed.findMany({
    where: {
      originalUrl: {
        contains: 'behindthesch3m3s.com'
      }
    },
    select: {
      id: true,
      title: true,
      originalUrl: true,
      _count: {
        select: { Track: true }
      }
    }
  });

  console.log(`Found ${feeds.length} feeds from behindthesch3m3s.com\n`);

  if (feeds.length === 0) {
    console.log('No feeds to process.');
    return;
  }

  const results: UpdateResult[] = [];
  let checkedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const feed of feeds) {
    checkedCount++;
    console.log(`\n[${checkedCount}/${feeds.length}] Checking: ${feed.title}`);
    console.log(`  Current URL: ${feed.originalUrl}`);

    try {
      // Check for newer Podcast Index entry
      const newestFeed = await getFeedByUrlPreferNewest(feed.originalUrl);

      if (!newestFeed) {
        console.log(`  ⚠️ Could not find in Podcast Index, skipping`);
        continue;
      }

      // Check if URL is different (newer entry found)
      const urlChanged = newestFeed.url !== feed.originalUrl;

      if (urlChanged) {
        console.log(`  🔄 Found newer entry!`);
        console.log(`  New URL: ${newestFeed.url}`);
        console.log(`  Podcast Index ID: ${newestFeed.id}`);

        // Check if the new URL already exists in another feed record
        const existingFeedWithNewUrl = await prisma.feed.findFirst({
          where: { originalUrl: newestFeed.url }
        });

        if (existingFeedWithNewUrl && existingFeedWithNewUrl.id !== feed.id) {
          console.log(`  ⚠️ New URL already exists in feed ${existingFeedWithNewUrl.id}, skipping URL update`);
          console.log(`  📡 Just updating V4V data for existing tracks...`);
        } else {
          // Update the feed's originalUrl
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              originalUrl: newestFeed.url,
              v4vRecipient: newestFeed.value?.destinations?.[0]?.address || null,
              v4vValue: newestFeed.value || null
            }
          });
        }

        // Now reparse the feed to update track V4V data
        console.log(`  📡 Reparsing feed to update track V4V data...`);

        let tracksUpdated = 0;
        let v4vUpdated = 0;

        try {
          const parsedFeed = await parseRSSFeedWithSegments(newestFeed.url);

          // Get existing tracks
          const existingTracks = await prisma.track.findMany({
            where: { feedId: feed.id },
            select: { id: true, guid: true, title: true, audioUrl: true }
          });

          // Create lookup map
          const parsedItemsByGuid = new Map(
            parsedFeed.items.map((item, index) => [item.guid, { item, order: index + 1 }])
          );

          // Update each track's V4V data
          for (const track of existingTracks) {
            let matchedItem: typeof parsedFeed.items[0] | null = null;

            // Match by GUID
            if (track.guid) {
              const parsedData = parsedItemsByGuid.get(track.guid);
              if (parsedData) {
                matchedItem = parsedData.item;
              }
            }

            // Fallback: match by title and audioUrl
            if (!matchedItem && track.title && track.audioUrl) {
              matchedItem = parsedFeed.items.find(item =>
                (item.title === track.title && item.audioUrl === track.audioUrl) ||
                item.audioUrl === track.audioUrl
              ) || null;
            }

            if (matchedItem) {
              const updateData: any = {};

              if (matchedItem.v4vRecipient) {
                updateData.v4vRecipient = matchedItem.v4vRecipient;
                v4vUpdated++;
              }
              if (matchedItem.v4vValue) {
                updateData.v4vValue = matchedItem.v4vValue;
              }

              if (Object.keys(updateData).length > 0) {
                await prisma.track.update({
                  where: { id: track.id },
                  data: updateData
                });
                tracksUpdated++;
              }
            }
          }

          console.log(`  ✅ Updated ${tracksUpdated} tracks (${v4vUpdated} with V4V data)`);
        } catch (parseError) {
          console.log(`  ⚠️ Could not reparse feed: ${parseError}`);
        }

        results.push({
          feedId: feed.id,
          title: feed.title || 'Unknown',
          oldUrl: feed.originalUrl,
          newUrl: newestFeed.url,
          newPodcastIndexId: newestFeed.id,
          tracksUpdated,
          v4vUpdated
        });

        updatedCount++;
      } else {
        console.log(`  ✓ Already using newest entry (ID: ${newestFeed.id})`);
      }

      // Rate limit to avoid hammering the API
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
      errorCount++;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total feeds checked: ${checkedCount}`);
  console.log(`Feeds updated to newer entry: ${updatedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (results.length > 0) {
    console.log('\nUpdated feeds:');
    for (const result of results) {
      console.log(`\n  📦 ${result.title}`);
      console.log(`     Old: ${result.oldUrl}`);
      console.log(`     New: ${result.newUrl}`);
      console.log(`     Tracks updated: ${result.tracksUpdated}, V4V updated: ${result.v4vUpdated}`);
    }
  }

  console.log('\n✅ Migration complete!\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
