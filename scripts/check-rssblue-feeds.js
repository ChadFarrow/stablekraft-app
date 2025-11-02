#!/usr/bin/env node

/**
 * Check RSS Blue feeds specifically for parsing issues
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkRSSBlueFeeds() {
  try {
    console.log('🔍 Checking RSS Blue feeds for parsing issues...\n');

    // Get RSS Blue feeds
    const rssBlueFeeds = await prisma.feed.findMany({
      where: {
        originalUrl: {
          contains: 'rssblue.com'
        }
      },
      take: 10,
      include: {
        Track: {
          take: 1
        }
      }
    });

    console.log(`📊 Found ${rssBlueFeeds.length} RSS Blue feeds\n`);

    let feedsWithV4V = 0;
    let feedsWithoutV4V = 0;

    rssBlueFeeds.forEach((feed, index) => {
      const hasV4V = feed.v4vRecipient || feed.v4vValue || 
                    (feed.Track[0] && (feed.Track[0].v4vRecipient || feed.Track[0].v4vValue));
      
      if (hasV4V) {
        feedsWithV4V++;
        console.log(`✅ ${index + 1}. ${feed.title} - HAS v4v data`);
        console.log(`   Feed v4vRecipient: ${feed.v4vRecipient}`);
        console.log(`   Feed v4vValue: ${JSON.stringify(feed.v4vValue, null, 2)}`);
        if (feed.Track[0]) {
          console.log(`   Track v4vRecipient: ${feed.Track[0].v4vRecipient}`);
          console.log(`   Track v4vValue: ${JSON.stringify(feed.Track[0].v4vValue, null, 2)}`);
        }
      } else {
        feedsWithoutV4V++;
        console.log(`❌ ${index + 1}. ${feed.title} - NO v4v data`);
        console.log(`   URL: ${feed.originalUrl}`);
      }
      console.log('');
    });

    console.log(`📈 Summary:`);
    console.log(`   RSS Blue feeds with v4v data: ${feedsWithV4V}`);
    console.log(`   RSS Blue feeds without v4v data: ${feedsWithoutV4V}`);
    console.log(`   Percentage with v4v: ${((feedsWithV4V / rssBlueFeeds.length) * 100).toFixed(1)}%`);

    // Check the specific "Age of Reason" feed
    console.log('\n🔍 Checking Age of Reason specifically...\n');
    const ageOfReason = await prisma.feed.findFirst({
      where: {
        originalUrl: 'https://feeds.rssblue.com/age-of-reason'
      },
      include: {
        Track: true
      }
    });

    if (ageOfReason) {
      console.log(`Found Age of Reason feed:`);
      console.log(`   ID: ${ageOfReason.id}`);
      console.log(`   Title: ${ageOfReason.title}`);
      console.log(`   v4vRecipient: ${ageOfReason.v4vRecipient}`);
      console.log(`   v4vValue: ${JSON.stringify(ageOfReason.v4vValue, null, 2)}`);
      console.log(`   Track count: ${ageOfReason.Track.length}`);
      
      ageOfReason.Track.forEach((track, index) => {
        console.log(`   Track ${index + 1}: ${track.title}`);
        console.log(`     v4vRecipient: ${track.v4vRecipient}`);
        console.log(`     v4vValue: ${JSON.stringify(track.v4vValue, null, 2)}`);
      });
    } else {
      console.log('Age of Reason feed not found in database');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkRSSBlueFeeds();
