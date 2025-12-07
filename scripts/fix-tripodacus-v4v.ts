#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

async function fixTripodacusV4V() {
  try {
    const feedUrl = 'https://music.behindthesch3m3s.com/wp-content/uploads/Tripodacus/tripodacus.xml';
    
    console.log(`\n🔄 Reparsing feed: ${feedUrl}\n`);
    
    // Parse the feed with the updated parser
    const parsedFeed = await parseRSSFeedWithSegments(feedUrl);
    
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

    let updatedCount = 0;

    for (const parsedItem of parsedFeed.items) {
      // Find matching track by GUID or title
      const track = tracks.find(t => 
        t.guid === parsedItem.guid || 
        t.title === parsedItem.title
      );

      if (!track) {
        console.log(`⚠️  Track not found: ${parsedItem.title}`);
        continue;
      }

      // Update track with correct V4V data
      await prisma.track.update({
        where: { id: track.id },
        data: {
          v4vRecipient: parsedItem.v4vRecipient || null,
          v4vValue: parsedItem.v4vValue ? parsedItem.v4vValue : null,
          updatedAt: new Date()
        }
      });

      console.log(`✅ Updated: ${track.title}`);
      if (parsedItem.v4vValue?.recipients) {
        console.log(`   Recipients: ${parsedItem.v4vValue.recipients.length}`);
        parsedItem.v4vValue.recipients.forEach((r: any) => {
          console.log(`     - ${r.name}: ${r.split}%`);
        });
      }
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

