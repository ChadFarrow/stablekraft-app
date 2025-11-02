#!/usr/bin/env node

/**
 * Debug specific feeds that should have keysend but don't
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function debugSpecificFeeds() {
  try {
    console.log('🔍 Debugging feeds that should have keysend but are missing from database...\n');

    const feedsToCheck = [
      'https://feeds.rssblue.com/3-way',
      'https://feeds.rssblue.com/age-of-reason'
    ];

    for (const url of feedsToCheck) {
      console.log(`\n📋 Checking: ${url}`);
      
      const feed = await prisma.feed.findFirst({
        where: {
          originalUrl: url
        },
        include: {
          Track: true
        }
      });

      if (!feed) {
        console.log('❌ Feed not found in database');
        continue;
      }

      console.log(`   ID: ${feed.id}`);
      console.log(`   Title: ${feed.title}`);
      console.log(`   Feed v4vRecipient: ${feed.v4vRecipient}`);
      console.log(`   Feed v4vValue: ${JSON.stringify(feed.v4vValue, null, 2)}`);
      console.log(`   Track count: ${feed.Track.length}`);
      
      feed.Track.forEach((track, index) => {
        console.log(`   Track ${index + 1}: ${track.title}`);
        console.log(`     v4vRecipient: ${track.v4vRecipient}`);
        console.log(`     v4vValue: ${JSON.stringify(track.v4vValue, null, 2)}`);
      });
    }

    // Check how many RSS Blue feeds are missing keysend data
    console.log('\n📊 Checking RSS Blue feeds missing keysend data...\n');
    
    const rssBlueFeedsWithoutKeysend = await prisma.feed.findMany({
      where: {
        AND: [
          { originalUrl: { contains: 'rssblue.com' } },
          { v4vRecipient: null },
          { v4vValue: null }
        ]
      },
      include: {
        Track: {
          where: {
            AND: [
              { v4vRecipient: null },
              { v4vValue: null }
            ]
          }
        }
      }
    });

    console.log(`Found ${rssBlueFeedsWithoutKeysend.length} RSS Blue feeds with no keysend data in database`);
    
    if (rssBlueFeedsWithoutKeysend.length > 0) {
      console.log('\nFirst 10 RSS Blue feeds missing keysend data:');
      rssBlueFeedsWithoutKeysend.slice(0, 10).forEach((feed, index) => {
        console.log(`${index + 1}. ${feed.title} - ${feed.originalUrl}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugSpecificFeeds();
