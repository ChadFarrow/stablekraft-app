#!/usr/bin/env node

/**
 * Corrected script to find feeds that don't have any keysend addresses
 * 
 * Keysend payments are identified by: type="node" in v4vValue JSON
 * 
 * This script checks:
 * 1. Feeds that don't have a v4vRecipient set at the feed level
 * 2. Feeds where none of their tracks have v4vRecipient set
 * 3. Feeds where v4vValue JSON doesn't contain type="node" (keysend)
 * 
 * Usage: node scripts/find-feeds-without-keysend-corrected.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function hasKeysendInV4VValue(v4vValue) {
  if (!v4vValue) return false;
  
  try {
    const value = typeof v4vValue === 'string' ? JSON.parse(v4vValue) : v4vValue;
    
    // Check for keysend payments: type="node"
    if (Array.isArray(value)) {
      return value.some(item => item.type === 'node');
    }
    
    if (typeof value === 'object') {
      // Check if it's a single recipient with type="node"
      if (value.type === 'node') {
        return true;
      }
      
      // Check if it has a recipients array with type="node"
      if (value.recipients && Array.isArray(value.recipients)) {
        return value.recipients.some(recipient => recipient.type === 'node');
      }
    }
    
    return false;
  } catch (error) {
    console.log(`Error parsing v4vValue: ${error.message}`);
    return false;
  }
}

async function findFeedsWithoutKeysend() {
  try {
    console.log('🔍 Corrected search for feeds without keysend addresses...\n');
    console.log('📝 Keysend payments identified by: type="node" in v4vValue JSON\n');

    // Get all feeds with more detailed information
    const allFeeds = await prisma.feed.findMany({
      select: {
        id: true,
        title: true,
        originalUrl: true,
        v4vRecipient: true,
        v4vValue: true,
        Track: {
          select: {
            id: true,
            title: true,
            v4vRecipient: true,
            v4vValue: true
          }
        }
      },
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`📊 Total feeds in database: ${allFeeds.length}\n`);

    // Find feeds without keysend addresses (corrected check)
    const feedsWithoutKeysend = [];
    const feedsWithKeysend = [];

    for (const feed of allFeeds) {
      const hasFeedLevelKeysend = feed.v4vRecipient && feed.v4vRecipient.trim() !== '';
      const hasFeedLevelKeysendInV4V = hasKeysendInV4VValue(feed.v4vValue);
      
      const trackKeysendInfo = feed.Track.map(track => ({
        hasRecipient: track.v4vRecipient && track.v4vRecipient.trim() !== '',
        hasV4VKeysend: hasKeysendInV4VValue(track.v4vValue),
        title: track.title
      }));
      
      const hasTrackLevelKeysend = trackKeysendInfo.some(t => t.hasRecipient || t.hasV4VKeysend);

      if (!hasFeedLevelKeysend && !hasFeedLevelKeysendInV4V && !hasTrackLevelKeysend) {
        feedsWithoutKeysend.push({
          id: feed.id,
          title: feed.title,
          url: feed.originalUrl,
          trackCount: feed.Track.length,
          feedLevelKeysend: feed.v4vRecipient,
          feedLevelV4VKeysend: hasFeedLevelKeysendInV4V,
          trackLevelKeysend: trackKeysendInfo.filter(t => t.hasRecipient).length,
          trackLevelV4VKeysend: trackKeysendInfo.filter(t => t.hasV4VKeysend).length,
          v4vValue: feed.v4vValue
        });
      } else {
        // Track feeds that DO have keysend for analysis
        feedsWithKeysend.push({
          id: feed.id,
          title: feed.title,
          url: feed.originalUrl,
          feedLevelKeysend: hasFeedLevelKeysend,
          feedLevelV4VKeysend: hasFeedLevelKeysendInV4V,
          trackLevelKeysend: trackKeysendInfo.filter(t => t.hasRecipient).length,
          trackLevelV4VKeysend: trackKeysendInfo.filter(t => t.hasV4VKeysend).length,
          v4vValue: feed.v4vValue
        });
      }
    }

    console.log(`❌ Feeds without any keysend addresses: ${feedsWithoutKeysend.length}\n`);
    console.log(`✅ Feeds with keysend addresses: ${feedsWithKeysend.length}\n`);

    if (feedsWithoutKeysend.length > 0) {
      console.log('📋 Detailed list of feeds WITHOUT keysend:\n');
      console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
      console.log('│ Feeds Without Keysend Addresses (type="node")                                  │');
      console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
      
      feedsWithoutKeysend.forEach((feed, index) => {
        console.log(`│ ${(index + 1).toString().padStart(3)} │ ${feed.title.padEnd(50)} │ ${feed.trackCount.toString().padStart(3)} tracks │`);
        console.log(`│     │ ${feed.url.padEnd(78)} │`);
        console.log('├─────────────────────────────────────────────────────────────────────────────────┤');
      });
      
      console.log('└─────────────────────────────────────────────────────────────────────────────────┘\n');
    }

    // Show some examples of feeds WITH keysend
    if (feedsWithKeysend.length > 0) {
      console.log('🔍 Examples of feeds WITH keysend (type="node"):\n');
      feedsWithKeysend.slice(0, 5).forEach((feed, index) => {
        console.log(`${index + 1}. ${feed.title}`);
        console.log(`   URL: ${feed.url}`);
        console.log(`   Feed-level keysend: ${feed.feedLevelKeysend || feed.feedLevelV4VKeysend}`);
        console.log(`   Track-level keysend: ${feed.trackLevelKeysend + feed.trackLevelV4VKeysend}`);
        console.log(`   V4V Value: ${JSON.stringify(feed.v4vValue, null, 2)}`);
        console.log('');
      });
    }

    // Generate summary statistics
    const totalTracksWithoutKeysend = feedsWithoutKeysend.reduce((sum, feed) => sum + feed.trackCount, 0);
    console.log('📈 Corrected Summary Statistics:');
    console.log(`   • Feeds without any keysend: ${feedsWithoutKeysend.length}`);
    console.log(`   • Feeds with keysend addresses: ${feedsWithKeysend.length}`);
    console.log(`   • Total tracks in feeds without keysend: ${totalTracksWithoutKeysend}`);
    console.log(`   • Percentage of feeds without keysend: ${((feedsWithoutKeysend.length / allFeeds.length) * 100).toFixed(1)}%`);
    console.log(`   • Percentage of feeds with keysend: ${((feedsWithKeysend.length / allFeeds.length) * 100).toFixed(1)}%\n`);

    // Export to files
    const fs = require('fs');
    
    fs.writeFileSync('feeds-without-keysend-corrected.json', JSON.stringify(feedsWithoutKeysend, null, 2));
    console.log(`💾 Feeds without keysend exported to: feeds-without-keysend-corrected.json`);
    
    fs.writeFileSync('feeds-with-keysend-corrected.json', JSON.stringify(feedsWithKeysend, null, 2));
    console.log(`💾 Feeds with keysend exported to: feeds-with-keysend-corrected.json`);

  } catch (error) {
    console.error('❌ Error querying database:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
findFeedsWithoutKeysend();
