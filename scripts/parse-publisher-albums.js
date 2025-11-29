#!/usr/bin/env node

/**
 * Parse Publisher Albums - One-Time Backfill Script
 *
 * This script:
 * 1. Reads all publisher feeds from the database
 * 2. For each publisher, fetches the feed XML
 * 3. Extracts podcast:remoteItem entries (album references)
 * 4. Parses each album feed and adds to database
 * 5. Links albums to publishers via publisherId
 */

const { PrismaClient } = require('@prisma/client');
const Parser = require('rss-parser');

const prisma = new PrismaClient();

// Custom RSS parser with podcast namespace support
const parser = new Parser({
  customFields: {
    feed: [
      ['podcast:guid', 'podcastGuid'],
      ['podcast:medium', 'medium'],
    ],
    item: [
      ['podcast:guid', 'guid'],
      ['enclosure', 'enclosure'],
      ['itunes:duration', 'duration'],
      ['itunes:image', 'image'],
      ['itunes:explicit', 'explicit'],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

/**
 * Parse duration string (MM:SS or HH:MM:SS) to seconds
 */
function parseDuration(durationStr) {
  if (!durationStr) return 0;
  const str = String(durationStr);
  const parts = str.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parseInt(str) || 0;
}

/**
 * Extract remoteItem entries from publisher feed XML
 */
function extractRemoteItems(xml) {
  const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
  const matches = xml.match(remoteItemRegex) || [];

  const items = [];
  for (const match of matches) {
    const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
    const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
    const mediumMatch = match.match(/medium="([^"]+)"/);

    // Skip publisher references (we only want albums)
    if (mediumMatch && mediumMatch[1] === 'publisher') {
      continue;
    }

    if (feedUrlMatch) {
      items.push({
        feedUrl: feedUrlMatch[1],
        feedGuid: feedGuidMatch?.[1],
        medium: mediumMatch?.[1] || 'music',
      });
    }
  }

  return items;
}

/**
 * Fetch publisher feed XML
 */
async function fetchPublisherFeed(url, retryCount = 0) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 2000;
        console.log(`   Rate limited - waiting ${waitTime/1000}s...`);
        await new Promise(r => setTimeout(r, waitTime));
        return fetchPublisherFeed(url, retryCount + 1);
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`   Error fetching: ${error.message}`);
    return null;
  }
}

/**
 * Parse and add album to database
 */
async function parseAndAddAlbum(feedUrl, publisherId, publisherArtist, retryCount = 0) {
  try {
    // Check if album already exists
    const existing = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl }
    });

    if (existing) {
      // Update publisherId if not set
      if (!existing.publisherId) {
        await prisma.feed.update({
          where: { id: existing.id },
          data: { publisherId }
        });
        return { status: 'linked', title: existing.title };
      }
      return { status: 'exists', title: existing.title };
    }

    // Fetch the album feed
    const response = await fetch(feedUrl);
    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        const waitTime = (retryCount + 1) * 2000;
        await new Promise(r => setTimeout(r, waitTime));
        return parseAndAddAlbum(feedUrl, publisherId, publisherArtist, retryCount + 1);
      }
      return { status: 'error', error: `HTTP ${response.status}` };
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);

    if (!feed || !feed.items || feed.items.length === 0) {
      return { status: 'empty' };
    }

    const albumTitle = feed.title || 'Unknown Album';
    const artist = feed.itunes?.author || publisherArtist || 'Unknown Artist';
    const description = feed.description || '';
    const coverArt = feed.itunes?.image || feed.image?.url || '';

    // Extract feed ID from URL
    const urlParts = feedUrl.split('/');
    const feedId = urlParts[urlParts.length - 1]?.replace(/\.xml$/, '') ||
                   urlParts.filter(p => p).pop() ||
                   `album-${Date.now()}`;

    // Create Feed + Tracks
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
        publisherId,
        updatedAt: new Date(),
        Track: {
          create: feed.items.map((item, index) => {
            const rawGuid = item.guid || `track-${index + 1}`;
            const uniqueGuid = `${feedId}-${rawGuid}`;
            return {
              id: uniqueGuid.substring(0, 255),
              guid: uniqueGuid.substring(0, 255),
              title: item.title || `Track ${index + 1}`,
              description: item.contentEncoded || item.description || '',
              audioUrl: item.enclosure?.url || '',
              duration: parseDuration(item.duration || item.itunes?.duration),
              image: item.image || coverArt,
              explicit: item.explicit === 'yes' || item.itunes?.explicit === 'yes',
              artist,
              album: albumTitle,
              trackOrder: index + 1,
              publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
              updatedAt: new Date()
            };
          }),
        },
      },
    });

    return { status: 'added', title: albumTitle, tracks: feed.items.length };

  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

async function main() {
  console.log('Publisher Albums Backfill');
  console.log('='.repeat(70));

  // Get all publisher feeds from database
  const publishers = await prisma.feed.findMany({
    where: {
      type: 'publisher',
      status: 'active'
    },
    select: {
      id: true,
      title: true,
      artist: true,
      originalUrl: true
    }
  });

  console.log(`\nFound ${publishers.length} publishers in database\n`);

  let stats = {
    publishersProcessed: 0,
    albumsAdded: 0,
    albumsLinked: 0,
    albumsSkipped: 0,
    albumsEmpty: 0,
    errors: 0
  };

  for (const publisher of publishers) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Publisher: ${publisher.title || publisher.id}`);
    console.log(`URL: ${publisher.originalUrl}`);

    if (!publisher.originalUrl) {
      console.log('   No URL - skipping');
      continue;
    }

    // Fetch publisher feed
    const xml = await fetchPublisherFeed(publisher.originalUrl);
    if (!xml) {
      console.log('   Failed to fetch feed');
      stats.errors++;
      continue;
    }

    // Extract remote items
    const remoteItems = extractRemoteItems(xml);
    console.log(`   Found ${remoteItems.length} album references`);

    if (remoteItems.length === 0) {
      continue;
    }

    stats.publishersProcessed++;
    const publisherArtist = publisher.artist || publisher.title;

    // Process each album
    for (let i = 0; i < remoteItems.length; i++) {
      const item = remoteItems[i];
      process.stdout.write(`   [${i + 1}/${remoteItems.length}] `);

      if (!item.feedUrl) {
        console.log('No feedUrl - skipping');
        stats.albumsSkipped++;
        continue;
      }

      const result = await parseAndAddAlbum(item.feedUrl, publisher.id, publisherArtist);

      switch (result.status) {
        case 'added':
          console.log(`Added: ${result.title} (${result.tracks} tracks)`);
          stats.albumsAdded++;
          break;
        case 'linked':
          console.log(`Linked: ${result.title}`);
          stats.albumsLinked++;
          break;
        case 'exists':
          console.log(`Exists: ${result.title}`);
          stats.albumsSkipped++;
          break;
        case 'empty':
          console.log('Empty feed - skipping');
          stats.albumsEmpty++;
          break;
        case 'error':
          console.log(`Error: ${result.error}`);
          stats.errors++;
          break;
      }

      // Rate limit: 250ms between requests
      await new Promise(r => setTimeout(r, 250));
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('\nComplete!\n');
  console.log('Statistics:');
  console.log(`   Publishers processed: ${stats.publishersProcessed}`);
  console.log(`   Albums added: ${stats.albumsAdded}`);
  console.log(`   Albums linked: ${stats.albumsLinked}`);
  console.log(`   Albums skipped (exist): ${stats.albumsSkipped}`);
  console.log(`   Albums empty: ${stats.albumsEmpty}`);
  console.log(`   Errors: ${stats.errors}`);
  console.log(`\n${'='.repeat(70)}\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
