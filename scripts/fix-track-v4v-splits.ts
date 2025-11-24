/**
 * Migration script to fix track v4v splits
 *
 * Problem: Tracks were incorrectly storing channel-level v4v splits
 * Solution: Clear track v4v data if it matches the feed's channel-level data
 *
 * This allows the frontend to correctly fall back to feed-level splits
 * when displaying tracks that don't have item-level splits.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Starting v4v splits migration...\n');

  try {
    // Get all feeds with v4v data
    const feeds = await prisma.feed.findMany({
      where: {
        v4vValue: {
          not: null
        }
      },
      include: {
        Track: {
          where: {
            v4vValue: {
              not: null
            }
          }
        }
      }
    });

    console.log(`📊 Found ${feeds.length} feeds with v4v data`);

    let totalTracksChecked = 0;
    let tracksCleared = 0;
    let tracksKept = 0;

    for (const feed of feeds) {
      if (feed.Track.length === 0) {
        console.log(`⏭️  Skipping feed "${feed.title}" (no tracks with v4v data)`);
        continue;
      }

      console.log(`\n📦 Processing feed: "${feed.title}" (${feed.Track.length} tracks with v4v)`);

      // Parse feed v4v value
      let feedV4v: any = null;
      if (typeof feed.v4vValue === 'string') {
        try {
          feedV4v = JSON.parse(feed.v4vValue);
        } catch (e) {
          console.warn(`⚠️  Failed to parse feed v4vValue as JSON`);
        }
      } else {
        feedV4v = feed.v4vValue;
      }

      if (!feedV4v || !feedV4v.recipients) {
        console.log(`⏭️  Skipping feed "${feed.title}" (no valid feed v4v data)`);
        continue;
      }

      // Create a signature for the feed's v4v data (to compare with tracks)
      const feedSignature = JSON.stringify(
        feedV4v.recipients
          .filter((r: any) => !r.fee)
          .map((r: any) => ({ address: r.address, split: r.split, type: r.type }))
          .sort((a: any, b: any) => a.address.localeCompare(b.address))
      );

      for (const track of feed.Track) {
        totalTracksChecked++;

        // Parse track v4v value
        let trackV4v: any = null;
        if (typeof track.v4vValue === 'string') {
          try {
            trackV4v = JSON.parse(track.v4vValue);
          } catch (e) {
            console.warn(`⚠️  Failed to parse track v4vValue for "${track.title}"`);
            continue;
          }
        } else {
          trackV4v = track.v4vValue;
        }

        if (!trackV4v || !trackV4v.recipients) {
          console.log(`⏭️  Skipping track "${track.title}" (no valid v4v data)`);
          continue;
        }

        // Create a signature for the track's v4v data
        const trackSignature = JSON.stringify(
          trackV4v.recipients
            .filter((r: any) => !r.fee)
            .map((r: any) => ({ address: r.address, split: r.split, type: r.type }))
            .sort((a: any, b: any) => a.address.localeCompare(b.address))
        );

        // If signatures match, this track has channel-level data
        if (trackSignature === feedSignature) {
          console.log(`🧹 Clearing channel-level data from track "${track.title}"`);

          await prisma.track.update({
            where: { id: track.id },
            data: {
              v4vValue: null,
              v4vRecipient: null
            }
          });

          tracksCleared++;
        } else {
          console.log(`✅ Keeping item-level data for track "${track.title}"`);
          tracksKept++;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`Feeds processed: ${feeds.length}`);
    console.log(`Tracks checked: ${totalTracksChecked}`);
    console.log(`Tracks cleared (had channel-level data): ${tracksCleared}`);
    console.log(`Tracks kept (had item-level data): ${tracksKept}`);
    console.log('='.repeat(60));
    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('❌ Error during migration:', error);
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
