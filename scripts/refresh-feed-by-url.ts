#!/usr/bin/env ts-node

/**
 * Refresh a feed by its URL to update track order based on episode numbers
 * Usage: npx tsx scripts/refresh-feed-by-url.ts <feed-url>
 */

import { PrismaClient } from '@prisma/client';
import { parseRSSFeedWithSegments, calculateTrackOrder } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

async function refreshFeedByUrl(feedUrl: string) {
  try {
    console.log(`\n🔄 Refreshing feed: ${feedUrl}\n`);

    // Find the feed by URL
    let feed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });

    if (!feed) {
      console.log('❌ Feed not found in database');
      console.log('💡 Creating new feed...');
      
      // Parse the feed first
      const parsedFeed = await parseRSSFeedWithSegments(feedUrl);
      
      // Create the feed
      feed = await prisma.feed.create({
        data: {
          id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
          lastFetched: new Date(),
          status: 'active',
          updatedAt: new Date()
        }
      });

      // Add all tracks
      if (parsedFeed.items.length > 0) {
        const tracksData = parsedFeed.items.map((item, index) => ({
          id: `${feed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
          feedId: feed.id,
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
          trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1, // Use season/episode if available
          updatedAt: new Date()
        }));

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        console.log(`✅ Created feed with ${parsedFeed.items.length} tracks`);
      }

      return;
    }

    console.log(`📋 Found feed: ${feed.title} (ID: ${feed.id})`);

    // Parse the RSS feed
    const parsedFeed = await parseRSSFeedWithSegments(feedUrl);

    // Update feed metadata
    await prisma.feed.update({
      where: { id: feed.id },
      data: {
        title: parsedFeed.title,
        description: parsedFeed.description,
        artist: parsedFeed.artist,
        image: parsedFeed.image,
        language: parsedFeed.language,
        category: parsedFeed.category,
        explicit: parsedFeed.explicit,
        lastFetched: new Date(),
        status: 'active',
        lastError: null,
        updatedAt: new Date()
      }
    });

    // Get existing tracks
    const existingTracks = await prisma.track.findMany({
      where: { feedId: feed.id },
      select: { id: true, guid: true, title: true, audioUrl: true, trackOrder: true }
    });

    console.log(`📊 Found ${existingTracks.length} existing tracks`);

    const existingGuids = new Set(existingTracks.map((t: { guid: string | null }) => t.guid).filter(Boolean));
    const existingTracksByGuid = new Map(existingTracks.map((t: { guid: string | null; id: string }) => [t.guid, t]));

    // Create a map of parsed items by GUID for order lookup
    const parsedItemsByGuid = new Map(
      parsedFeed.items.map((item, index) => [item.guid, { item, order: index + 1 }])
    );

    // Update trackOrder for ALL existing tracks based on episode numbers
    const updatePromises: Promise<any>[] = [];
    let updatedCount = 0;

    for (const track of existingTracks) {
      let order: number | null = null;
      let matchedItem: typeof parsedFeed.items[0] | null = null;

      // First try to match by GUID
      if (track.guid) {
        const parsedData = parsedItemsByGuid.get(track.guid);
        if (parsedData) {
          matchedItem = parsedData.item;
          // Use season/episode if available, otherwise use RSS position
          order = matchedItem.episode
            ? calculateTrackOrder(matchedItem.episode, matchedItem.season)
            : parsedData.order;
        }
      }

      // If no GUID match, try to match by title and audioUrl
      if (order === null && track.title && track.audioUrl) {
        const matchingIndex = parsedFeed.items.findIndex(item =>
          (item.title === track.title && item.audioUrl === track.audioUrl) ||
          item.audioUrl === track.audioUrl
        );
        if (matchingIndex >= 0) {
          matchedItem = parsedFeed.items[matchingIndex];
          // Use season/episode if available, otherwise use RSS position
          order = matchedItem.episode
            ? calculateTrackOrder(matchedItem.episode, matchedItem.season)
            : (matchingIndex + 1);
        }
      }

      if (order !== null && order !== track.trackOrder) {
        updatePromises.push(
          prisma.track.update({
            where: { id: track.id },
            data: { trackOrder: order }
          })
        );
        updatedCount++;
        console.log(`  📝 Updating "${track.title}": trackOrder ${track.trackOrder} → ${order}${matchedItem?.episode ? ' (from episode number)' : ''}`);
      }
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      console.log(`\n✅ Updated ${updatedCount} tracks with correct track order`);
    } else {
      console.log(`\nℹ️  No tracks needed updating (all orders are correct)`);
    }

    // Filter out tracks that already exist
    const newItems = parsedFeed.items.filter(item =>
      !item.guid || !existingGuids.has(item.guid)
    );

    // Add new tracks with proper trackOrder
    if (newItems.length > 0) {
      const tracksData = newItems.map((item, index) => {
        // Find the item's position in the full parsed feed
        const fullIndex = parsedFeed.items.findIndex(i =>
          i.guid === item.guid ||
          (i.title === item.title && i.audioUrl === item.audioUrl)
        );
        const parsedItem = fullIndex >= 0 ? parsedFeed.items[fullIndex] : null;
        // Use season/episode if available, otherwise use RSS position
        const order = parsedItem?.episode
          ? calculateTrackOrder(parsedItem.episode, parsedItem.season)
          : (fullIndex >= 0 ? fullIndex + 1 : parsedFeed.items.length + index + 1);

        return {
          id: `${feed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
          feedId: feed.id,
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
          trackOrder: order,
          updatedAt: new Date()
        };
      });

      await prisma.track.createMany({
        data: tracksData,
        skipDuplicates: true
      });

      console.log(`✅ Added ${newItems.length} new tracks`);
    }

    // Show final track order
    const finalTracks = await prisma.track.findMany({
      where: { feedId: feed.id },
      select: { title: true, trackOrder: true, guid: true },
      orderBy: { trackOrder: 'asc' }
    });

    console.log(`\n📋 Final track order:`);
    finalTracks.forEach((track: { trackOrder: number | null; title: string }) => {
      console.log(`  ${track.trackOrder}. ${track.title}`);
    });

  } catch (error) {
    console.error('❌ Error refreshing feed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Get feed URL from command line argument
const feedUrl = process.argv[2];

if (!feedUrl) {
  console.error('❌ Please provide a feed URL as an argument');
  console.error('Usage: npx ts-node scripts/refresh-feed-by-url.ts <feed-url>');
  process.exit(1);
}

refreshFeedByUrl(feedUrl)
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

