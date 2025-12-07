#!/usr/bin/env ts-node

/**
 * Update payment info for a specific feed by re-parsing it
 * Usage: npx tsx scripts/update-feed-payment-info.ts <feed-url>
 */

import { PrismaClient } from '@prisma/client';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

async function updateFeedPaymentInfo(feedUrl: string) {
  try {
    console.log(`\n🔄 Updating payment info for feed: ${feedUrl}\n`);

    // Find the feed by URL
    const feed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl },
      select: { id: true, title: true, artist: true, v4vRecipient: true }
    });

    // Parse the feed to extract payment info first
    console.log(`\n📡 Parsing RSS feed to extract payment info...`);
    const parsedFeed = await parseRSSFeedWithSegments(feedUrl);

    if (!feed) {
      console.log('❌ Feed not found in database');
      console.log('💡 Creating new feed with payment info...');
      
      // Generate a feed ID
      const feedId = parsedFeed.podcastGuid 
        ? `feed-${parsedFeed.podcastGuid}`
        : `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create the feed with payment info
      const newFeed = await prisma.feed.create({
        data: {
          id: feedId,
          guid: parsedFeed.podcastGuid || null,
          originalUrl: feedUrl,
          cdnUrl: feedUrl,
          type: 'album',
          priority: 'normal',
          title: parsedFeed.title,
          description: parsedFeed.description,
          artist: parsedFeed.artist,
          image: parsedFeed.image,
          language: parsedFeed.language,
          category: parsedFeed.category,
          explicit: parsedFeed.explicit,
          v4vRecipient: parsedFeed.v4vRecipient || null,
          v4vValue: parsedFeed.v4vValue || null,
          lastFetched: new Date(),
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      console.log(`✅ Created feed: ${newFeed.title} by ${newFeed.artist}`);
      console.log(`   Payment recipient: ${newFeed.v4vRecipient || 'NONE'}`);
      
      // Add tracks if any
      if (parsedFeed.items.length > 0) {
        console.log(`\n📝 Adding ${parsedFeed.items.length} tracks...`);
        const tracksData = parsedFeed.items.map((item, index) => ({
          id: `${newFeed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
          feedId: newFeed.id,
          guid: item.guid,
          title: item.title,
          subtitle: item.subtitle,
          description: item.description,
          artist: item.artist,
          audioUrl: item.audioUrl,
          duration: item.duration,
          explicit: item.explicit,
          image: item.image,
          publishedAt: item.publishedAt,
          itunesAuthor: item.itunesAuthor,
          itunesSummary: item.itunesSummary,
          itunesImage: item.itunesImage,
          itunesDuration: item.itunesDuration,
          itunesKeywords: item.itunesKeywords || [],
          itunesCategories: item.itunesCategories || [],
          v4vRecipient: item.v4vRecipient,
          v4vValue: item.v4vValue,
          startTime: item.startTime,
          endTime: item.endTime,
          trackOrder: index + 1,
          updatedAt: new Date()
        }));

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        console.log(`✅ Added ${tracksData.length} tracks`);
      }

      return;
    }

    console.log(`✅ Found feed: ${feed.title} by ${feed.artist}`);
    console.log(`   Current payment recipient: ${feed.v4vRecipient || 'NONE'}`);

    if (!parsedFeed.v4vRecipient && !parsedFeed.v4vValue) {
      console.log('⚠️  No payment info found in RSS feed');
      return;
    }

    console.log(`✅ Found payment info:`);
    console.log(`   Recipient: ${parsedFeed.v4vRecipient}`);
    console.log(`   Value data:`, JSON.stringify(parsedFeed.v4vValue, null, 2));

    // Update the feed with payment info
    await prisma.feed.update({
      where: { id: feed.id },
      data: {
        v4vRecipient: parsedFeed.v4vRecipient,
        v4vValue: parsedFeed.v4vValue,
        updatedAt: new Date()
      }
    });

    console.log(`\n✅ Successfully updated payment info for feed: ${feed.title}`);
    console.log(`   New recipient: ${parsedFeed.v4vRecipient}`);

  } catch (error) {
    console.error('❌ Error updating feed payment info:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get feed URL from command line arguments
const feedUrl = process.argv[2];

if (!feedUrl) {
  console.error('❌ Please provide a feed URL');
  console.error('Usage: npx tsx scripts/update-feed-payment-info.ts <feed-url>');
  process.exit(1);
}

updateFeedPaymentInfo(feedUrl)
  .then(() => {
    console.log('\n✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

