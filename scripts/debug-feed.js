#!/usr/bin/env node

/**
 * Debug script to check a specific feed for keysend detection issues
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugFeed() {
  try {
    console.log('🔍 Debugging feed: Age of Reason\n');

    // Find the feed by URL
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: {
          contains: 'age-of-reason'
        }
      },
      include: {
        Track: true
      }
    });

    if (!feed) {
      console.log('❌ Feed not found in database');
      return;
    }

    console.log(`📋 Feed Details:`);
    console.log(`   ID: ${feed.id}`);
    console.log(`   Title: ${feed.title}`);
    console.log(`   URL: ${feed.originalUrl}`);
    console.log(`   v4vRecipient: ${feed.v4vRecipient}`);
    console.log(`   v4vValue: ${JSON.stringify(feed.v4vValue, null, 2)}`);
    console.log(`   Track Count: ${feed.Track.length}\n`);

    // Check each track
    console.log('🎵 Track Details:');
    feed.Track.forEach((track, index) => {
      console.log(`   Track ${index + 1}: ${track.title}`);
      console.log(`     v4vRecipient: ${track.v4vRecipient}`);
      console.log(`     v4vValue: ${JSON.stringify(track.v4vValue, null, 2)}`);
      console.log('');
    });

    // Test our keysend detection function
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

    console.log('🔍 Keysend Detection Test:');
    console.log(`   Feed-level keysend detected: ${hasKeysendInV4VValue(feed.v4vValue)}`);
    
    feed.Track.forEach((track, index) => {
      const hasKeysend = hasKeysendInV4VValue(track.v4vValue);
      console.log(`   Track ${index + 1} keysend detected: ${hasKeysend}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugFeed();
