#!/usr/bin/env node

/**
 * Script to find feeds that don't have any keysend addresses
 * 
 * This script queries the database to find:
 * 1. Feeds that don't have a v4vRecipient set at the feed level
 * 2. Feeds where none of their tracks have v4vRecipient set
 * 
 * Usage: node scripts/find-feeds-without-keysend.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function findFeedsWithoutKeysend() {
  try {
    console.log('🔍 Searching for feeds without keysend addresses...\n');

    // Get all feeds
    const allFeeds = await prisma.feed.findMany({
      select: {
        id: true,
        title: true,
        originalUrl: true,
        v4vRecipient: true,
        Track: {
          select: {
            id: true,
            title: true,
            v4vRecipient: true
          }
        }
      },
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`📊 Total feeds in database: ${allFeeds.length}\n`);

    // Find feeds without keysend addresses
    const feedsWithoutKeysend = [];

    for (const feed of allFeeds) {
      const hasFeedLevelKeysend = feed.v4vRecipient && feed.v4vRecipient.trim() !== '';
      const hasTrackLevelKeysend = feed.Track.some(track => 
        track.v4vRecipient && track.v4vRecipient.trim() !== ''
      );

      if (!hasFeedLevelKeysend && !hasTrackLevelKeysend) {
        feedsWithoutKeysend.push({
          id: feed.id,
          title: feed.title,
          url: feed.originalUrl,
          trackCount: feed.Track.length,
          feedLevelKeysend: feed.v4vRecipient,
          trackLevelKeysend: feed.Track.filter(t => t.v4vRecipient && t.v4vRecipient.trim() !== '').length
        });
      }
    }

    console.log(`❌ Feeds without any keysend addresses: ${feedsWithoutKeysend.length}\n`);

    if (feedsWithoutKeysend.length > 0) {
      console.log('📋 Detailed list:\n');
      console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ Feeds Without Keysend Addresses                                                │');
      console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
      
      feedsWithoutKeysend.forEach((feed, index) => {
        console.log(`│ ${(index + 1).toString().padStart(3)} │ ${feed.title.padEnd(50)} │ ${feed.trackCount.toString().padStart(3)} tracks │`);
        console.log(`│     │ ${feed.url.padEnd(78)} │`);
        console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
      });
      
      console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');

      // Generate summary statistics
      const totalTracksWithoutKeysend = feedsWithoutKeysend.reduce((sum, feed) => sum + feed.trackCount, 0);
      console.log('📈 Summary Statistics:');
      console.log(`   • Feeds without keysend: ${feedsWithoutKeysend.length}`);
      console.log(`   • Total tracks in these feeds: ${totalTracksWithoutKeysend}`);
      console.log(`   • Percentage of feeds without keysend: ${((feedsWithoutKeysend.length / allFeeds.length) * 100).toFixed(1)}%\n`);

      // Export to file
      const fs = require('fs');
      const outputFile = 'feeds-without-keysend.json';
      fs.writeFileSync(outputFile, JSON.stringify(feedsWithoutKeysend, null, 2));
      console.log(`💾 Results exported to: ${outputFile}`);

    } else {
      console.log('✅ All feeds have at least one keysend address!');
    }

    // Additional analysis: Show feeds with only feed-level keysend
    const feedsWithOnlyFeedLevelKeysend = allFeeds.filter(feed => {
      const hasFeedLevelKeysend = feed.v4vRecipient && feed.v4vRecipient.trim() !== '';
      const hasTrackLevelKeysend = feed.Track.some(track => 
        track.v4vRecipient && track.v4vRecipient.trim() !== ''
      );
      return hasFeedLevelKeysend && !hasTrackLevelKeysend;
    });

    console.log(`\n📊 Additional Analysis:`);
    console.log(`   • Feeds with only feed-level keysend: ${feedsWithOnlyFeedLevelKeysend.length}`);
    console.log(`   • Feeds with only track-level keysend: ${allFeeds.filter(feed => {
      const hasFeedLevelKeysend = feed.v4vRecipient && feed.v4vRecipient.trim() !== '';
      const hasTrackLevelKeysend = feed.Track.some(track => 
        track.v4vRecipient && track.v4vRecipient.trim() !== ''
      );
      return !hasFeedLevelKeysend && hasTrackLevelKeysend;
    }).length}`);
    console.log(`   • Feeds with both feed and track-level keysend: ${allFeeds.filter(feed => {
      const hasFeedLevelKeysend = feed.v4vRecipient && feed.v4vRecipient.trim() !== '';
      const hasTrackLevelKeysend = feed.Track.some(track => 
        track.v4vRecipient && track.v4vRecipient.trim() !== ''
      );
      return hasFeedLevelKeysend && hasTrackLevelKeysend;
    }).length}`);

  } catch (error) {
    console.error('❌ Error querying database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
findFeedsWithoutKeysend();
