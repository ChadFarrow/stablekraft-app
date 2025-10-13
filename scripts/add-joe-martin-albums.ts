#!/usr/bin/env ts-node

/**
 * Add Joe Martin's albums to the database
 *
 * This script specifically adds Joe Martin's missing albums from his publisher feed
 */

import { PrismaClient } from '@prisma/client';
import Parser from 'rss-parser';
import fetch from 'node-fetch';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

// Custom RSS parser
class PodcastParser extends Parser {
  constructor() {
    super({
      customFields: {
        item: [
          ['enclosure', 'enclosure'],
          ['itunes:duration', 'duration'],
          ['itunes:image', 'image'],
          ['itunes:explicit', 'explicit'],
          ['content:encoded', 'contentEncoded'],
        ],
      },
    });
  }
}

// Joe Martin's remoteItem GUIDs from his publisher feed
const joeMartinRemoteItems = [
  { guid: '1c7917cc-357c-4eaf-ab54-1a7cda504976', url: 'https://wavlake.com/feed/music/1c7917cc-357c-4eaf-ab54-1a7cda504976' },
  { guid: 'e1f9dfcb-ee9b-4a6d-aee7-189043917fb5', url: 'https://wavlake.com/feed/music/e1f9dfcb-ee9b-4a6d-aee7-189043917fb5' },
  { guid: '95ea253a-4058-402c-8503-204f6d3f1494', url: 'https://wavlake.com/feed/music/95ea253a-4058-402c-8503-204f6d3f1494' },
  { guid: 'd4f791c3-4d0c-4fbd-a543-c136ee78a9de', url: 'https://wavlake.com/feed/music/d4f791c3-4d0c-4fbd-a543-c136ee78a9de' },
  { guid: '51606506-66f8-4394-b6c6-cc0c1b554375', url: 'https://wavlake.com/feed/music/51606506-66f8-4394-b6c6-cc0c1b554375' },
  { guid: '6b7793b8-fd9d-432b-af1a-184cd41aaf9d', url: 'https://wavlake.com/feed/music/6b7793b8-fd9d-432b-af1a-184cd41aaf9d' },
  { guid: '0bb8c9c7-1c55-4412-a517-572a98318921', url: 'https://wavlake.com/feed/music/0bb8c9c7-1c55-4412-a517-572a98318921' },
  { guid: '16e46ed0-b392-4419-a937-a7815f6ca43b', url: 'https://wavlake.com/feed/music/16e46ed0-b392-4419-a937-a7815f6ca43b' },
  { guid: '2cd1b9ea-9ef3-4a54-aa25-55295689f442', url: 'https://wavlake.com/feed/music/2cd1b9ea-9ef3-4a54-aa25-55295689f442' },
  { guid: '33eeda7e-8591-4ff5-83f8-f36a879b0a09', url: 'https://wavlake.com/feed/music/33eeda7e-8591-4ff5-83f8-f36a879b0a09' },
  { guid: '32a79df8-ec3e-4a14-bfcb-7a074e1974b9', url: 'https://wavlake.com/feed/music/32a79df8-ec3e-4a14-bfcb-7a074e1974b9' },
  { guid: '06376ab5-efca-459c-9801-49ceba5fdab1', url: 'https://wavlake.com/feed/music/06376ab5-efca-459c-9801-49ceba5fdab1' },
  { guid: 'c16028bf-ceb4-4200-9463-4b45ea8c0b7b', url: 'https://wavlake.com/feed/music/c16028bf-ceb4-4200-9463-4b45ea8c0b7b' },
];

async function parseAndAddAlbum(feedUrl: string, feedGuid: string): Promise<boolean> {
  console.log(`\n🎵 Processing: ${feedGuid}`);

  try {
    // Check if feed already exists
    const existingFeed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });

    if (existingFeed) {
      console.log(`   ℹ️  Already exists - skipping`);
      return false;
    }

    // Fetch and parse the feed
    const response = await fetch(feedUrl);
    if (!response.ok) {
      console.log(`   ⚠️  HTTP ${response.status} - skipping`);
      return false;
    }

    const xml = await response.text();
    const parser = new PodcastParser();
    const feed = await parser.parseString(xml);

    if (!feed || !feed.items || feed.items.length === 0) {
      console.log(`   ⚠️  No items - skipping`);
      return false;
    }

    const albumTitle = feed.title || 'Unknown Album';
    const artist = feed.itunes?.author || 'Joe Martin';
    const description = feed.description || '';
    const coverArt = feed.itunes?.image || feed.image?.url || '';

    console.log(`   ✅ "${albumTitle}" by ${artist} (${feed.items.length} tracks)`);

    // Create feed ID from GUID
    const feedId = `wavlake-${feedGuid.substring(0, 8)}`;

    // Create tracks data with unique GUIDs
    const tracksData = feed.items.map((item: any, index: number) => {
      // Parse duration from MM:SS or HH:MM:SS format to seconds
      let durationInSeconds = 0;
      if (item.duration || item.itunes?.duration) {
        const durationStr = (item.duration || item.itunes?.duration || '').toString();
        const parts = durationStr.split(':').map(Number);
        if (parts.length === 2) {
          // MM:SS
          durationInSeconds = parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
          // HH:MM:SS
          durationInSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }

      // Use a more unique GUID that includes the feed GUID and index
      const trackGuid = item.guid || `${feedGuid}-track-${index + 1}`;

      return {
        id: `${feedId}-${trackGuid}`,
        guid: trackGuid,
        title: item.title || `Track ${index + 1}`,
        description: item.contentEncoded || item.description || '',
        audioUrl: item.enclosure?.url || '',
        duration: durationInSeconds,
        image: item.image || coverArt,
        explicit: item.explicit === 'yes' || item.itunes?.explicit === 'yes',
        artist,
        album: albumTitle,
        trackOrder: index + 1,
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        updatedAt: new Date()
      };
    });

    // Create Feed + Tracks in database
    await prisma.feed.create({
      data: {
        id: feedId,
        originalUrl: feedUrl,
        title: albumTitle,
        description,
        type: 'album',
        status: 'active',
        artist,
        image: coverArt,
        explicit: feed.itunes?.explicit === 'yes',
        priority: 'normal',
        updatedAt: new Date(),
        Track: {
          create: tracksData,
        },
      },
    });

    console.log(`   ✅ Added to database`);
    return true;

  } catch (error) {
    console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return false;
  }
}

async function main() {
  console.log('🎵 Adding Joe Martin Albums to Database');
  console.log('═'.repeat(70));

  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < joeMartinRemoteItems.length; i++) {
    const item = joeMartinRemoteItems[i];
    console.log(`\n[${i + 1}/${joeMartinRemoteItems.length}]`);

    try {
      const success = await parseAndAddAlbum(item.url, item.guid);
      if (success) {
        added++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      errors++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('\n✅ Complete!');
  console.log(`\n📊 Statistics:`);
  console.log(`   Added: ${added}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`\n${'═'.repeat(70)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
