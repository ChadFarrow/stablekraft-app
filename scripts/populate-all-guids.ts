/**
 * Populate GUIDs for all feeds and tracks
 * Extracts podcast:guid from RSS feeds and updates database
 */

import { prisma } from '../lib/prisma';
import { parsePodcastGuidFromXML } from '../lib/rss-parser-db';

interface ItemGuid {
  title: string;
  guid: string;
}

/**
 * Extract item GUIDs from RSS feed XML
 */
function extractItemGuidsFromXML(xmlText: string): ItemGuid[] {
  const itemGuids: ItemGuid[] = [];

  try {
    // Match all <item> blocks
    const itemRegex = /<item>(.*?)<\/item>/gs;
    let itemMatch;

    while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
      const itemContent = itemMatch[1];

      // Extract title
      const titleMatch = itemContent.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // Extract guid
      const guidMatch = itemContent.match(/<guid[^>]*>([^<]+)<\/guid>/);
      const guid = guidMatch ? guidMatch[1].trim() : '';

      if (title && guid) {
        itemGuids.push({ title, guid });
      }
    }

    console.log(`   Found ${itemGuids.length} item GUIDs`);
    return itemGuids;
  } catch (error) {
    console.error('   Error extracting item GUIDs:', error);
    return [];
  }
}

async function populateAllGuids() {
  console.log('🔍 Starting GUID population for all feeds and tracks...\n');

  // Get all feeds
  const feeds = await prisma.feed.findMany({
    where: {
      status: 'active'
    },
    select: {
      id: true,
      guid: true,
      title: true,
      originalUrl: true,
      Track: {
        select: {
          id: true,
          title: true,
          guid: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  console.log(`📊 Found ${feeds.length} feeds to process\n`);

  let feedsUpdated = 0;
  let feedsSkipped = 0;
  let feedsFailed = 0;
  let tracksUpdated = 0;
  let tracksSkipped = 0;

  for (const feed of feeds) {
    console.log(`\n📻 Processing: ${feed.title}`);
    console.log(`   Feed ID: ${feed.id}`);
    console.log(`   URL: ${feed.originalUrl}`);

    try {
      // Fetch RSS feed
      const response = await fetch(feed.originalUrl);
      if (!response.ok) {
        console.log(`   ⚠️  Failed to fetch RSS (${response.status})`);
        feedsFailed++;
        continue;
      }

      const xmlText = await response.text();

      // Extract feed GUID
      const feedGuid = parsePodcastGuidFromXML(xmlText);

      if (feedGuid && feedGuid !== feed.guid) {
        await prisma.feed.update({
          where: { id: feed.id },
          data: { guid: feedGuid }
        });
        console.log(`   ✅ Updated feed GUID: ${feedGuid}`);
        feedsUpdated++;
      } else if (feedGuid && feedGuid === feed.guid) {
        console.log(`   ℹ️  Feed GUID already set: ${feedGuid}`);
        feedsSkipped++;
      } else {
        console.log(`   ⚠️  No podcast:guid found in RSS feed`);
        feedsSkipped++;
      }

      // Extract item GUIDs
      const itemGuids = extractItemGuidsFromXML(xmlText);

      if (itemGuids.length > 0) {
        // Match items to tracks by title
        for (const track of feed.Track) {
          if (track.guid) {
            console.log(`   ℹ️  Track "${track.title}" already has GUID`);
            tracksSkipped++;
            continue;
          }

          // Find matching item by title (case-insensitive)
          const matchingItem = itemGuids.find(
            item => item.title.toLowerCase().trim() === track.title.toLowerCase().trim()
          );

          if (matchingItem) {
            await prisma.track.update({
              where: { id: track.id },
              data: { guid: matchingItem.guid }
            });
            console.log(`   ✅ Updated track GUID: "${track.title}" -> ${matchingItem.guid.substring(0, 40)}...`);
            tracksUpdated++;
          } else {
            console.log(`   ⚠️  No matching GUID found for track: "${track.title}"`);
            tracksSkipped++;
          }
        }
      }

      // Rate limiting to avoid overwhelming servers
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`   ❌ Error processing feed:`, error instanceof Error ? error.message : error);
      feedsFailed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Feeds:`);
  console.log(`  ✅ Updated: ${feedsUpdated}`);
  console.log(`  ℹ️  Skipped: ${feedsSkipped}`);
  console.log(`  ❌ Failed: ${feedsFailed}`);
  console.log(`\nTracks:`);
  console.log(`  ✅ Updated: ${tracksUpdated}`);
  console.log(`  ℹ️  Skipped: ${tracksSkipped}`);
  console.log('='.repeat(60));
}

// Run the script
populateAllGuids()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
