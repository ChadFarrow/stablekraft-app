/**
 * Re-sync Errored Feeds
 * Fetches the 11 feeds with status='error' directly from Wavlake and updates them
 */

import { PrismaClient } from '@prisma/client';
import { RSSParser } from '../lib/rss-parser';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();

// The 11 feeds that exist on Wavlake but have status='error' in our DB
const ERRORED_FEED_GUIDS = [
  '0bb8c9c7-1c55-4412-a517-572a98318921',  // Daddy Gene by Joe Martin
  '1c7917cc-357c-4eaf-ab54-1a7cda504976',  // Crocodile Tears by Joe Martin
  '33eeda7e-8591-4ff5-83f8-f36a879b0a09',  // Small World by Joe Martin
  '51606506-66f8-4394-b6c6-cc0c1b554375',  // Bound For Lonesome by Joe Martin
  '6b7793b8-fd9d-432b-af1a-184cd41aaf9d',  // The First Five Years by Joe Martin
  '95ea253a-4058-402c-8503-204f6d3f1494',  // Empty Passenger Seat by Joe Martin
  'c5cc9864-c687-4c6d-937d-0aa5f103a8d2',  // Home by Ollie
  'd0bebcfa-e20b-4b1b-b797-bd7ac95e646f',  // Perfect Timing by Ollie
  'd4f791c3-4d0c-4fbd-a543-c136ee78a9de',  // Hero by Joe Martin
  'e1f9dfcb-ee9b-4a6d-aee7-189043917fb5',  // Letters Of Regret by Joe Martin
  'e678589b-5a9f-4918-9622-34119d2eed2c',  // Singles by Nate Johnivan
];

async function resyncFeed(guid: string): Promise<boolean> {
  try {
    const feedUrl = `https://wavlake.com/feed/music/${guid}`;
    console.log(`\n🔄 Re-syncing: ${guid}`);
    console.log(`   Feed URL: ${feedUrl}`);

    // Check current status
    const existingFeed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl },
      select: { id: true, title: true, artist: true, status: true }
    });

    if (!existingFeed) {
      console.log(`   ⚠️  Feed not found in database`);
      return false;
    }

    console.log(`   Current: ${existingFeed.title} by ${existingFeed.artist} (status: ${existingFeed.status})`);

    // Parse the feed from Wavlake
    const albumData = await RSSParser.parseAlbumFeed(feedUrl);

    if (!albumData) {
      console.log(`   ❌ Failed to parse feed from Wavlake`);
      return false;
    }

    console.log(`   ✅ Parsed: ${albumData.tracks.length} tracks`);

    // Update the feed
    await prisma.feed.update({
      where: { id: existingFeed.id },
      data: {
        title: albumData.title,
        description: albumData.description,
        artist: albumData.artist,
        image: albumData.coverArt,
        status: 'active',
        lastFetched: new Date(),
        updatedAt: new Date(),
        language: albumData.language,
        explicit: albumData.explicit,
      }
    });

    console.log(`   💾 Updated feed to status='active'`);

    // Delete existing tracks
    await prisma.track.deleteMany({
      where: { feedId: existingFeed.id }
    });

    console.log(`   🗑️  Deleted old tracks`);

    // Create new tracks
    const tracksData = albumData.tracks.map((track, index) => {
      let v4vRecipient = null;
      let v4vValue = null;

      // Extract V4V data from the raw value (stored as any)
      if (albumData.v4vValue && albumData.v4vValue.destinations) {
        const mainRecipient = albumData.v4vValue.destinations.find((d: any) => !d.fee);
        if (mainRecipient) {
          v4vRecipient = mainRecipient.address;
          v4vValue = albumData.v4vValue;
        }
      }

      return {
        id: `${existingFeed.id}-track-${index}-${Date.now()}`,
        feedId: existingFeed.id,
        guid: track.url || `${existingFeed.id}-${index}`,
        title: track.title,
        description: track.subtitle || track.summary || null,
        artist: albumData.artist,
        audioUrl: track.url || '',
        duration: track.duration ? parseInt(track.duration.split(':').reduce((acc, time) => (60 * acc) + +time, 0).toString()) : 0,
        explicit: track.explicit || false,
        image: track.image || albumData.coverArt || null,
        publishedAt: albumData.releaseDate ? new Date(albumData.releaseDate) : new Date(),
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

    console.log(`   ✅ Added ${tracksData.length} tracks`);
    return true;

  } catch (error) {
    console.error(`   ❌ Error:`, error instanceof Error ? error.message : error);
    return false;
  }
}

async function resyncAllErroredFeeds() {
  console.log('🚀 Re-syncing Errored Wavlake Feeds\n');
  console.log('='.repeat(70));

  let success = 0;
  let failed = 0;

  for (const guid of ERRORED_FEED_GUIDS) {
    const result = await resyncFeed(guid);
    if (result) {
      success++;
    } else {
      failed++;
    }
    // Small delay to be respectful
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(70));
  console.log('📊 Summary');
  console.log('='.repeat(70));
  console.log(`Total: ${ERRORED_FEED_GUIDS.length}`);
  console.log(`✅ Success: ${success}`);
  console.log(`❌ Failed: ${failed}`);

  console.log('\n✨ Done!');
  await prisma.$disconnect();
}

resyncAllErroredFeeds().catch(error => {
  console.error('💥 Fatal error:', error);
  prisma.$disconnect();
  process.exit(1);
});
