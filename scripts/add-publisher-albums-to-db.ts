#!/usr/bin/env ts-node

/**
 * Add Publisher Remote Items to Database
 *
 * This script:
 * 1. Reads publisher-feed-results.json
 * 2. For each publisher, fetches their feed XML
 * 3. Extracts podcast:remoteItem entries
 * 4. Parses each remote item album feed
 * 5. Adds albums as Feed + Track records to Prisma database
 */

import { PrismaClient } from '@prisma/client';
import Parser from 'rss-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

interface RemoteItem {
  feedGuid?: string;
  feedUrl?: string;
  medium?: string;
}

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

async function fetchAndParsePublisherFeed(feedUrl: string, retryCount = 0): Promise<RemoteItem[]> {
  console.log(`\n📡 Fetching publisher feed: ${feedUrl}`);

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 10000;
        console.log(`   ⚠️  Rate limited - waiting ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchAndParsePublisherFeed(feedUrl, retryCount + 1);
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
    const matches = xml.match(remoteItemRegex) || [];

    const remoteItems: RemoteItem[] = [];
    for (const match of matches) {
      const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
      const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
      const mediumMatch = match.match(/medium="([^"]+)"/);

      if (feedUrlMatch) {
        remoteItems.push({
          feedUrl: feedUrlMatch[1],
          feedGuid: feedGuidMatch?.[1],
          medium: mediumMatch?.[1] || 'music',
        });
      }
    }

    console.log(`   ✅ Found ${remoteItems.length} remote items`);
    return remoteItems;
  } catch (error) {
    console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return [];
  }
}

async function parseAndAddAlbum(feedUrl: string, publisherTitle: string, retryCount = 0): Promise<boolean> {
  console.log(`\n   🎵 Parsing: ${feedUrl.substring(0, 60)}...`);

  try {
    // Check if feed already exists
    const existingFeed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });

    if (existingFeed) {
      console.log(`      ℹ️  Already exists - skipping`);
      return false;
    }

    const response = await fetch(feedUrl);
    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 5000;
        console.log(`      ⚠️  Rate limited - waiting ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return parseAndAddAlbum(feedUrl, publisherTitle, retryCount + 1);
      }
      console.log(`      ⚠️  HTTP ${response.status} - skipping`);
      return false;
    }

    const xml = await response.text();
    const parser = new PodcastParser();
    const feed = await parser.parseString(xml);

    if (!feed || !feed.items || feed.items.length === 0) {
      console.log(`      ⚠️  No items - skipping`);
      return false;
    }

    const albumTitle = feed.title || 'Unknown Album';
    const artist = feed.itunes?.author || publisherTitle || 'Unknown Artist';
    const description = feed.description || '';
    const coverArt = feed.itunes?.image || feed.image?.url || '';

    console.log(`      ✅ "${albumTitle}" by ${artist} (${feed.items.length} tracks)`);

    // Create feed ID from URL
    const feedId = feedUrl.split('/').pop()?.replace(/\.xml$/, '') || `album-${Date.now()}`;

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
        tracks: {
          create: feed.items.map((item: any, index: number) => {
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

            return {
              guid: item.guid || `${feedId}-track-${index + 1}`,
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
            };
          }),
        },
      },
    });

    console.log(`      ✅ Added to database`);
    return true;

  } catch (error) {
    console.error(`      ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return false;
  }
}

async function main() {
  console.log('🎵 Publisher Remote Items → Database');
  console.log('═'.repeat(70));

  const publisherFeedsPath = path.join(process.cwd(), 'data', 'publisher-feed-results.json');

  if (!fs.existsSync(publisherFeedsPath)) {
    console.error('❌ publisher-feed-results.json not found!');
    process.exit(1);
  }

  const publisherFeeds = JSON.parse(fs.readFileSync(publisherFeedsPath, 'utf-8'));
  console.log(`\n📋 Found ${publisherFeeds.length} publishers\n`);

  let totalProcessed = 0;
  let totalAdded = 0;
  let totalSkipped = 0;

  for (const publisherFeed of publisherFeeds) {
    const publisherTitle = publisherFeed.title?.replace(/<!\[CDATA\[|\]\]>/g, '') || publisherFeed.feed.title;
    const feedUrl = publisherFeed.feed.originalUrl;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📻 ${publisherTitle}`);
    console.log(`   ${feedUrl}`);

    const remoteItems = await fetchAndParsePublisherFeed(feedUrl);

    if (remoteItems.length === 0) {
      console.log('   ⚠️  No remote items - skipping');
      continue;
    }

    console.log(`\n   Processing ${remoteItems.length} albums...`);

    for (let i = 0; i < remoteItems.length; i++) {
      const remoteItem = remoteItems[i];
      console.log(`\n   [${i + 1}/${remoteItems.length}]`);

      totalProcessed++;

      if (!remoteItem.feedUrl) {
        console.log('      ⚠️  No feedUrl - skipping');
        totalSkipped++;
        continue;
      }

      const added = await parseAndAddAlbum(remoteItem.feedUrl, publisherTitle);

      if (added) {
        totalAdded++;
      } else {
        totalSkipped++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('\n✅ Complete!');
  console.log(`\n📊 Statistics:`);
  console.log(`   Processed: ${totalProcessed}`);
  console.log(`   Added: ${totalAdded}`);
  console.log(`   Skipped: ${totalSkipped}`);
  console.log(`\n${'═'.repeat(70)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
