#!/usr/bin/env node

/**
 * Parse Publisher Remote Items
 *
 * This script:
 * 1. Reads publisher-feed-results.json
 * 2. For each publisher feed, fetches the feed XML
 * 3. Extracts podcast:remoteItem entries
 * 4. Parses each remote item feed URL and adds albums to parsed-feed-results.json
 */

import Parser from 'rss-parser';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom RSS parser with podcast namespace support
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
          ['itunes:episode', 'episodeNumber'],
          ['podcast:season', 'seasonNumber'],
        ],
      },
    });
  }
}

async function fetchAndParsePublisherFeed(feedUrl, retryCount = 0) {
  console.log(`\n📡 Fetching publisher feed: ${feedUrl}`);

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 10000; // 10s, 20s, 30s
        console.log(`   ⚠️  Rate limited - waiting ${waitTime/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return fetchAndParsePublisherFeed(feedUrl, retryCount + 1);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();

    // Extract podcast:remoteItem entries using regex
    const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
    const matches = xml.match(remoteItemRegex) || [];

    const remoteItems = [];

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
    console.error(`   ❌ Error fetching feed: ${error.message}`);
    return [];
  }
}

async function parseAlbumFeed(feedUrl, publisherId, publisherTitle, retryCount = 0) {
  console.log(`\n   🎵 Parsing album feed: ${feedUrl.substring(0, 60)}...`);

  try {
    const response = await fetch(feedUrl);
    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 5000; // 5s, 10s, 15s
        console.log(`      ⚠️  Rate limited - waiting ${waitTime/1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return parseAlbumFeed(feedUrl, publisherId, publisherTitle, retryCount + 1);
      }
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
    const artist = feed.itunes?.author || 'Unknown Artist';
    const description = feed.description || '';
    const coverArt = feed.itunes?.image || feed.image?.url || '';

    console.log(`      ✅ Found album: "${albumTitle}" by ${artist} (${feed.items.length} tracks)`);

    // Create album ID from feed URL
    const urlParts = feedUrl.split('/');
    const albumId = urlParts[urlParts.length - 1]?.replace(/\.xml$/, '') ||
                    urlParts.filter(p => p).pop() ||
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
      keywords: [],
    }));

    return {
      feed: {
        id: albumId,
        originalUrl: feedUrl,
        type: 'album',
        title: albumTitle,
      },
      parseStatus: 'success',
      parsedAt: new Date().toISOString(),
      parsedData: {
        album: {
          id: albumId,
          title: albumTitle,
          artist,
          description,
          coverArt,
          tracks,
          releaseDate: feed.pubDate || new Date().toISOString(),
          feedUrl,
          feedId: albumId,
          feedGuid: albumId,
          explicit: feed.itunes?.explicit === 'yes',
          publisher: {
            feedGuid: publisherId,
            feedUrl: '', // Will be filled by caller
            title: publisherTitle,
          },
        },
      },
    };

  } catch (error) {
    console.error(`      ❌ Error parsing album: ${error.message}`);
    return null;
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

  const publisherFeeds = JSON.parse(fs.readFileSync(publisherFeedsPath, 'utf-8'));
  console.log(`\n📋 Found ${publisherFeeds.length} publisher feeds\n`);

  // Read existing parsed-feed-results.json
  const parsedFeedsPath = path.join(process.cwd(), 'data', 'parsed-feed-results.json');
  let existingFeeds = [];

  if (fs.existsSync(parsedFeedsPath)) {
    existingFeeds = JSON.parse(fs.readFileSync(parsedFeedsPath, 'utf-8'));
    console.log(`📋 Loaded ${existingFeeds.length} existing parsed feeds\n`);
  }

  // Create a Set of existing feed URLs for fast lookup
  const existingFeedUrls = new Set(existingFeeds.map(f => f.feed.originalUrl));

  let totalProcessed = 0;
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const newFeeds = [];

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

      // Check if this feed already exists
      if (existingFeedUrls.has(remoteItem.feedUrl)) {
        console.log(`      ℹ️  Album already exists in database - skipping`);
        totalSkipped++;
        continue;
      }

      // Parse the album feed
      const albumFeed = await parseAlbumFeed(remoteItem.feedUrl, publisherId, publisherTitle);

      if (!albumFeed) {
        totalErrors++;
        continue;
      }

      // Add publisher info
      albumFeed.parsedData.album.publisher.feedUrl = feedUrl;

      // Add to new feeds list
      newFeeds.push(albumFeed);
      existingFeedUrls.add(remoteItem.feedUrl); // Track as added
      totalAdded++;

      console.log(`      ✅ Added to queue`);

      // Rate limiting - wait 3 seconds between requests to avoid 429 errors
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Append new feeds to existing feeds
  if (newFeeds.length > 0) {
    const allFeeds = [...existingFeeds, ...newFeeds];

    // Write to parsed-feed-results.json
    fs.writeFileSync(
      parsedFeedsPath,
      JSON.stringify(allFeeds, null, 2),
      'utf-8'
    );

    console.log(`\n💾 Saved ${newFeeds.length} new albums to parsed-feed-results.json`);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('\n✅ Processing Complete!');
  console.log(`\n📊 Statistics:`);
  console.log(`   Total remote items processed: ${totalProcessed}`);
  console.log(`   Albums added: ${totalAdded}`);
  console.log(`   Albums skipped (already exist): ${totalSkipped}`);
  console.log(`   Errors encountered: ${totalErrors}`);
  console.log(`\n${'═'.repeat(70)}\n`);
}

main().catch(console.error);
