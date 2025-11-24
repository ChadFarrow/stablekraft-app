/**
 * Script to re-parse all feeds and update track v4v data with corrected parser
 *
 * This script:
 * 1. Finds all active feeds with RSS URLs
 * 2. Re-fetches and re-parses each feed XML
 * 3. Updates track v4v data with corrected item-level splits
 */

import { PrismaClient } from '@prisma/client';
import Parser from 'rss-parser';
import { parseV4VFromXML } from '../lib/rss-parser-db';

const prisma = new PrismaClient();
const parser = new Parser({
  customFields: {
    item: ['guid', 'enclosure', 'itunes:duration', 'itunes:image']
  }
});

async function main() {
  console.log('🔄 Starting full feed v4v refresh...\n');

  try {
    // Find all active feeds with RSS URLs
    const feeds = await prisma.feed.findMany({
      where: {
        status: 'active'
      },
      include: {
        Track: true
      }
    });

    console.log(`📊 Found ${feeds.length} active feeds to refresh\n`);

    let feedsProcessed = 0;
    let feedsWithErrors = 0;
    let tracksUpdated = 0;
    let tracksWithItemLevelData = 0;

    for (const feed of feeds) {
      if (!feed.originalUrl) continue;

      try {
        console.log(`\n📦 Processing feed: "${feed.title}" (${feed.Track.length} tracks)`);
        console.log(`   URL: ${feed.originalUrl}`);

        // Fetch the feed XML
        const response = await fetch(feed.originalUrl);
        if (!response.ok) {
          console.warn(`⚠️ Failed to fetch feed: ${response.status} ${response.statusText}`);
          feedsWithErrors++;
          continue;
        }

        const xmlText = await response.text();

        // Parse feed with rss-parser to get episodes
        const parsedFeed = await parser.parseString(xmlText);

        // Parse v4v data from XML
        const parsedV4V = parseV4VFromXML(xmlText);

        // Update feed-level v4v data
        if (parsedV4V?.channelValue) {
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              v4vValue: {
                type: parsedV4V.channelValue.type,
                method: parsedV4V.channelValue.method,
                suggested: parsedV4V.channelValue.suggested,
                recipients: parsedV4V.channelValue.recipients.map(r => ({
                  name: r.name,
                  type: r.type,
                  address: r.address,
                  split: r.split,
                  customKey: r.customKey,
                  customValue: r.customValue,
                  fee: r.fee || false
                }))
              },
              v4vRecipient: parsedV4V.channelValue.recipients[0]?.address || null
            }
          });
          console.log(`✅ Updated feed-level v4v data`);
        }

        // Update each track's v4v data
        for (const track of feed.Track) {
          // Find matching episode in parsed feed
          const episode = parsedFeed.items.find(item =>
            item.title === track.title || item.guid === track.guid
          );

          if (!episode) {
            console.log(`⏭️ Skipping track "${track.title}" (not found in feed)`);
            continue;
          }

          // Get item-level v4v data if available
          const itemV4V = parsedV4V?.itemValues?.get(episode.guid || '');

          if (itemV4V) {
            // Update track with item-level v4v data
            await prisma.track.update({
              where: { id: track.id },
              data: {
                v4vValue: {
                  type: itemV4V.type,
                  method: itemV4V.method,
                  suggested: itemV4V.suggested,
                  recipients: itemV4V.recipients.map(r => ({
                    name: r.name,
                    type: r.type,
                    address: r.address,
                    split: r.split,
                    customKey: r.customKey,
                    customValue: r.customValue,
                    fee: r.fee || false
                  }))
                },
                v4vRecipient: itemV4V.recipients[0]?.address || null
              }
            });

            console.log(`✅ Updated "${track.title}" with item-level v4v (${itemV4V.recipients.length} recipients)`);
            tracksUpdated++;
            tracksWithItemLevelData++;
          } else {
            // Clear track v4v data (will fall back to channel-level)
            await prisma.track.update({
              where: { id: track.id },
              data: {
                v4vValue: null,
                v4vRecipient: null
              }
            });

            console.log(`🧹 Cleared "${track.title}" (no item-level v4v, will use feed-level)`);
            tracksUpdated++;
          }
        }

        feedsProcessed++;
        console.log(`✅ Completed feed "${feed.title}"`);

        // Add delay to avoid overwhelming the servers
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Error processing feed "${feed.title}":`, error);
        feedsWithErrors++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Refresh Summary:');
    console.log('='.repeat(60));
    console.log(`Feeds processed: ${feedsProcessed}/${feeds.length}`);
    console.log(`Feeds with errors: ${feedsWithErrors}`);
    console.log(`Tracks updated: ${tracksUpdated}`);
    console.log(`Tracks with item-level v4v: ${tracksWithItemLevelData}`);
    console.log('='.repeat(60));
    console.log('\n✅ Refresh complete!');

  } catch (error) {
    console.error('❌ Error during refresh:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
