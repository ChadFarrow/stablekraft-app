#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixTripodacusV4V() {
  try {
    const feedUrl = 'https://music.behindthesch3m3s.com/wp-content/uploads/Tripodacus/tripodacus.xml';
    
    // Find the feed in database
    const feed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });

    if (!feed) {
      console.log('❌ Feed not found in database');
      return;
    }

    console.log(`📋 Found feed: ${feed.title} (${feed.id})\n`);

    // Get all tracks for this feed
    const tracks = await prisma.track.findMany({
      where: { feedId: feed.id }
    });

    console.log(`🎵 Found ${tracks.length} tracks to update\n`);

    // Correct V4V data with all 4 recipients
    const correctV4VValue = {
      type: 'lightning',
      method: 'keysend',
      recipients: [
        {
          name: 'Music Side Project',
          type: 'node',
          address: '035ad2c954e264004986da2d9499e1732e5175e1dcef2453c921c6cdcc3536e9d8',
          split: 1,
          fee: false
        },
        {
          name: 'tripodacus@fountain.fm',
          type: 'node',
          address: '03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79',
          split: 97,
          fee: false,
          customKey: '906608',
          customValue: '01j5yzEweshxXZFdbT3sZy'
        },
        {
          name: 'BoostBot',
          type: 'node',
          address: '03d55f4d4c870577e98ac56605a54c5ed20c8897e41197a068fd61bdb580efaa67',
          split: 1,
          fee: false
        },
        {
          name: 'ThunderRoad',
          type: 'node',
          address: '03589f3ddb81f3802f3fc9aaa359b684ed19840b55db88f7c9c2cc671e74ac93e2',
          split: 1,
          fee: false
        }
      ]
    };

    // Primary recipient should be the one with highest split (97%)
    const primaryRecipient = '03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79';

    let updatedCount = 0;

    for (const track of tracks) {
      await prisma.track.update({
        where: { id: track.id },
        data: {
          v4vRecipient: primaryRecipient,
          v4vValue: correctV4VValue,
          updatedAt: new Date()
        }
      });

      console.log(`✅ Updated: ${track.title}`);
      console.log(`   Primary recipient: tripodacus@fountain.fm (97%)`);
      console.log(`   Total recipients: 4`);
      updatedCount++;
    }

    console.log(`\n✅ Updated ${updatedCount} tracks with correct V4V data\n`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixTripodacusV4V();

