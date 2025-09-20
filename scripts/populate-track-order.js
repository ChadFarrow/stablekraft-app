#!/usr/bin/env node

/**
 * Script to populate trackOrder field for existing tracks
 * This script assigns track order based on publishedAt date (ascending order)
 * For albums, this should represent the intended track sequence
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function populateTrackOrder() {
  console.log('🎵 Starting track order population...');
  
  try {
    // Get all feeds with their tracks
    const feeds = await prisma.feed.findMany({
      include: {
        tracks: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ]
        }
      }
    });

    console.log(`📊 Found ${feeds.length} feeds to process`);

    let totalTracksUpdated = 0;

    for (const feed of feeds) {
      if (feed.tracks.length === 0) {
        console.log(`⏭️  Skipping feed "${feed.title}" - no tracks`);
        continue;
      }

      console.log(`🔄 Processing feed "${feed.title}" with ${feed.tracks.length} tracks`);

      // Update each track with its order within the feed
      for (let i = 0; i < feed.tracks.length; i++) {
        const track = feed.tracks[i];
        const trackOrder = i + 1; // Start from 1, not 0

        await prisma.track.update({
          where: { id: track.id },
          data: { trackOrder }
        });

        console.log(`  ✅ Track ${trackOrder}: "${track.title}"`);
        totalTracksUpdated++;
      }
    }

    console.log(`\n🎉 Successfully updated ${totalTracksUpdated} tracks with track order`);
    console.log('📝 Track order is now based on publishedAt date (ascending)');
    console.log('💡 For albums, this should represent the intended track sequence');

  } catch (error) {
    console.error('❌ Error populating track order:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  populateTrackOrder()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { populateTrackOrder };
