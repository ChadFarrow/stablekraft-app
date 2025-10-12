#!/usr/bin/env ts-node

/**
 * Parse Publisher Remote Items
 *
 * This script:
 * 1. Reads publisher-feed-results.json
 * 2. For each publisher feed, fetches the feed XML
 * 3. Extracts podcast:remoteItem entries
 * 4. Parses each remote item feed URL and adds albums to the database
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

interface PublisherFeedData {
  feed: {
    id: string;
    originalUrl: string;
    type: string;
    title: string;
  };
  title?: string;
  description?: string;
  itunesImage?: string;
}

// Custom RSS parser with podcast namespace support
class PodcastParser extends Parser {
  constructor() {
    super({
      customFields: {
        feed: [
          ['podcast:guid', 'podcastGuid'],
          ['podcast:medium', 'medium'],
        ] as any,
        item: [
          ['podcast:guid', 'guid'],
          ['enclosure', 'enclosure'],
          ['itunes:duration', 'duration'],
          ['itunes:image', 'image'],
          ['itunes:explicit', 'explicit'],
          ['content:encoded', 'contentEncoded'],
          ['itunes:episode', 'episodeNumber'],
          ['podcast:season', 'seasonNumber'],
        ] as any,
      },
    });
  }
}

async function fetchAndParsePublisherFeed(feedUrl: string): Promise<RemoteItem[]> {
  console.log(`\n📡 Fetching publisher feed: ${feedUrl}`);

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();

    // Extract podcast:remoteItem entries using regex
    const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
    const matches = xml.match(remoteItemRegex) || [];

    const remoteItems: RemoteItem[] = [];

    for (const match of matches) {
      const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
      const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
      const mediumMatch = match.match(/medium="([^"]+)"/);

      if (feedUrlMatch || feedGuidMatch) {
        remoteItems.push({
          feedGuid: feedGuidMatch?.[1],
          feedUrl: feedUrlMatch?.[1],
          medium: mediumMatch?.[1] || 'music',
        });
      }
    }

    console.log(`   ✅ Found ${remoteItems.length} remote items`);
    return remoteItems;

  } catch (error) {
    console.error(`   ❌ Error fetching feed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return [];
  }
}

async function parseAlbumFeed(feedUrl: string, publisherId: string): Promise<any | null> {
  console.log(`\n   🎵 Parsing album feed: ${feedUrl.substring(0, 60)}...`);

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      console.log(`      ⚠️  HTTP ${response.status} - skipping`);
      return null;
    }

    const xml = await response.text();
    const parser = new PodcastParser();
    const feed = await parser.parseString(xml);

    if (!feed || !feed.items || feed.items.length === 0) {
      console.log(`      ⚠️  No items in feed - skipping`);
      return null;
    }

    // Extract album info
    const albumTitle = feed.title || 'Unknown Album';
    const artist = feed.itunes?.author || feed.author || 'Unknown Artist';
    const description = feed.description || '';
    const coverArt = feed.itunes?.image || feed.image?.url || '';

    console.log(`      ✅ Found album: "${albumTitle}" by ${artist} (${feed.items.length} tracks)`);

    // Create album ID from feed URL
    const albumId = feedUrl.split('/').pop()?.replace(/\.xml$/, '') ||
                    feedUrl.split('/').filter(p => p).pop() ||
                    `album-${Date.now()}`;

    // Map tracks
    const tracks = feed.items.map((item, index) => ({
      title: item.title || `Track ${index + 1}`,
      duration: item.duration || item.itunes?.duration || '0:00',
      url: item.enclosure?.url || '',
      trackNumber: index + 1,
      subtitle: item.itunes?.subtitle || '',
      summary: item.contentEncoded || item.description || '',
      image: item.image || coverArt,
      explicit: item.explicit === 'yes' || item.itunes?.explicit === 'yes',
    }));

    return {
      id: albumId,
      title: albumTitle,
      artist,
      description,
      coverArt,
      tracks,
      releaseDate: feed.pubDate || new Date().toISOString(),
      feedUrl,
      feedId: albumId,
      explicit: feed.itunes?.explicit === 'yes',
      publisher: {
        feedGuid: publisherId,
        feedUrl: '', // Will be filled by caller
        title: artist,
      },
    };

  } catch (error) {
    console.error(`      ❌ Error parsing album: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return null;
  }
}

async function addAlbumToDatabase(albumData: any): Promise<boolean> {
  try {
    // Check if album already exists
    const existing = await prisma.album.findUnique({
      where: { id: albumData.id },
    });

    if (existing) {
      console.log(`      ℹ️  Album already exists in database - skipping`);
      return false;
    }

    // Create album with tracks
    await prisma.album.create({
      data: {
        id: albumData.id,
        title: albumData.title,
        artist: albumData.artist,
        description: albumData.description,
        coverArt: albumData.coverArt,
        releaseDate: new Date(albumData.releaseDate),
        feedUrl: albumData.feedUrl,
        feedId: albumData.feedId,
        explicit: albumData.explicit,
        lastUpdated: new Date(),
        tracks: {
          create: albumData.tracks.map((track: any) => ({
            title: track.title,
            duration: track.duration,
            url: track.url,
            trackNumber: track.trackNumber,
            subtitle: track.subtitle || '',
            summary: track.summary || '',
            image: track.image || '',
            explicit: track.explicit || false,
          })),
        },
        publisher: albumData.publisher ? {
          create: {
            feedGuid: albumData.publisher.feedGuid,
            feedUrl: albumData.publisher.feedUrl,
            title: albumData.publisher.title,
          },
        } : undefined,
      },
    });

    console.log(`      ✅ Added to database`);
    return true;

  } catch (error) {
    console.error(`      ❌ Database error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

async function main() {
  console.log('🎵 Publisher Remote Items Parser');
  console.log('═'.repeat(70));

  // Read publisher-feed-results.json
  const publisherFeedsPath = path.join(process.cwd(), 'data', 'publisher-feed-results.json');

  if (!fs.existsSync(publisherFeedsPath)) {
    console.error('❌ publisher-feed-results.json not found!');
    process.exit(1);
  }

  const publisherFeeds: PublisherFeedData[] = JSON.parse(fs.readFileSync(publisherFeedsPath, 'utf-8'));
  console.log(`\n📋 Found ${publisherFeeds.length} publisher feeds\n`);

  let totalProcessed = 0;
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const publisherFeed of publisherFeeds) {
    const publisherId = publisherFeed.feed.id;
    const publisherTitle = publisherFeed.title?.replace(/<!\[CDATA\[|\]\]>/g, '') || publisherFeed.feed.title;
    const feedUrl = publisherFeed.feed.originalUrl;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📻 Publisher: ${publisherTitle}`);
    console.log(`   ID: ${publisherId}`);
    console.log(`   Feed: ${feedUrl}`);

    // Fetch publisher feed to get remote items
    const remoteItems = await fetchAndParsePublisherFeed(feedUrl);

    if (remoteItems.length === 0) {
      console.log('   ⚠️  No remote items found - skipping');
      continue;
    }

    console.log(`\n   Processing ${remoteItems.length} remote items...`);

    for (let i = 0; i < remoteItems.length; i++) {
      const remoteItem = remoteItems[i];
      console.log(`\n   [${i + 1}/${remoteItems.length}]`);

      totalProcessed++;

      if (!remoteItem.feedUrl) {
        console.log('      ⚠️  No feedUrl - skipping');
        totalSkipped++;
        continue;
      }

      // Parse the album feed
      const albumData = await parseAlbumFeed(remoteItem.feedUrl, publisherId);

      if (!albumData) {
        totalErrors++;
        continue;
      }

      // Add publisher info
      albumData.publisher.feedUrl = feedUrl;
      albumData.publisher.title = publisherTitle;

      // Add to database
      const added = await addAlbumToDatabase(albumData);

      if (added) {
        totalAdded++;
      } else {
        totalSkipped++;
      }

      // Rate limiting - wait 1 second between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('\n✅ Processing Complete!');
  console.log(`\n📊 Statistics:`);
  console.log(`   Total remote items processed: ${totalProcessed}`);
  console.log(`   Albums added to database: ${totalAdded}`);
  console.log(`   Albums skipped (already exist): ${totalSkipped}`);
  console.log(`   Errors encountered: ${totalErrors}`);
  console.log(`\n${'═'.repeat(70)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
