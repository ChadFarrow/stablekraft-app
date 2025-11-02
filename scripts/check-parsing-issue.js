#!/usr/bin/env node

/**
 * Check if RSS parsing is working correctly for keysend detection
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkParsingIssue() {
  try {
    console.log('🔍 Checking RSS parsing for keysend detection...\n');

    // Get some feeds that should have keysend based on the corrected analysis
    const feedsWithKeysend = await prisma.feed.findMany({
      where: {
        OR: [
          { v4vRecipient: { not: null } },
          { v4vValue: { not: null } }
        ]
      },
      take: 5,
      include: {
        Track: {
          take: 1
        }
      }
    });

    console.log(`📊 Found ${feedsWithKeysend.length} feeds with v4v data in database\n`);

    feedsWithKeysend.forEach((feed, index) => {
      console.log(`${index + 1}. ${feed.title}`);
      console.log(`   URL: ${feed.originalUrl}`);
      console.log(`   v4vRecipient: ${feed.v4vRecipient}`);
      console.log(`   v4vValue: ${JSON.stringify(feed.v4vValue, null, 2)}`);
      console.log(`   Track v4vValue: ${JSON.stringify(feed.Track[0]?.v4vValue, null, 2)}`);
      console.log('');
    });

    // Check some feeds that should have keysend but might not be parsed
    console.log('🔍 Checking feeds that might have parsing issues...\n');
    
    const potentiallyMissingFeeds = await prisma.feed.findMany({
      where: {
        AND: [
          { v4vRecipient: null },
          { v4vValue: null },
          { originalUrl: { contains: 'rssblue.com' } }
        ]
      },
      take: 3
    });

    console.log(`Found ${potentiallyMissingFeeds.length} RSS Blue feeds with no v4v data:\n`);
    
    potentiallyMissingFeeds.forEach((feed, index) => {
      console.log(`${index + 1}. ${feed.title}`);
      console.log(`   URL: ${feed.originalUrl}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkParsingIssue();
