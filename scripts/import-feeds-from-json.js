#!/usr/bin/env node
/**
 * Import feeds from data/feeds.json to PostgreSQL database
 * This skips Podcast Index API and just creates Feed records
 * Then parse-feeds can populate tracks later
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

(async () => {
  try {
    console.log('=== Import Feeds from JSON to PostgreSQL ===\n');

    // Read feeds.json
    const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
    const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

    console.log(`Found ${feedsData.feeds.length} feeds in JSON file\n`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < feedsData.feeds.length; i++) {
      const feed = feedsData.feeds[i];

      // Skip if no URL
      if (!feed.originalUrl && !feed.url) {
        skipped++;
        continue;
      }

      // Use feedGuid as ID if available, otherwise use id
      const feedId = feed.feedGuid || feed.guid || feed.id;
      const feedUrl = feed.originalUrl || feed.url;

      try {
        // Check if already exists
        const existing = await prisma.feed.findUnique({
          where: { id: feedId },
          select: { id: true }
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Also check by URL
        const existingByUrl = await prisma.feed.findFirst({
          where: { originalUrl: feedUrl },
          select: { id: true }
        });

        if (existingByUrl) {
          skipped++;
          continue;
        }

        // Create feed record
        await prisma.feed.create({
          data: {
            id: feedId,
            guid: feed.feedGuid || feed.guid || null,
            title: feed.title || 'Unknown Feed',
            description: feed.description || null,
            originalUrl: feedUrl,
            artist: feed.artist || null,
            image: feed.image || feed.artwork || null,
            language: feed.language || 'en',
            explicit: feed.explicit || false,
            type: feed.type || 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });

        created++;

        if (created % 50 === 0) {
          console.log(`Progress: ${created} created, ${skipped} skipped, ${errors} errors (${i+1}/${feedsData.feeds.length})`);
        }

      } catch (error) {
        // Handle duplicate key errors silently
        if (error.code === 'P2002') {
          skipped++;
        } else {
          errors++;
          if (errors <= 10) {
            console.error(`Error creating feed ${feedId}:`, error.message);
          }
        }
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Created: ${created}`);
    console.log(`Skipped (already exists): ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log('\nNow run parse-feeds to populate tracks:');
    console.log('curl -X POST https://stablekraft.app/api/playlist/parse-feeds');

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
