/**
 * Script to add artwork to Strange Textures albums
 * Updates: An Observed Earth, Heartland Captives, Connector, and Endless
 *
 * Usage:
 *   npx tsx scripts/add-strange-textures-artwork.ts
 *
 * Or manually update in database:
 *   UPDATE "Feed" SET image = 'https://f.strangetextures.com/media/podcasts/aoe/cover_feed.png', "updatedAt" = NOW() WHERE "originalUrl" = 'https://f.strangetextures.com/@aoe/feed.xml';
 *   UPDATE "Feed" SET image = 'https://f.strangetextures.com/media/podcasts/hc/cover_feed.png', "updatedAt" = NOW() WHERE "originalUrl" = 'https://f.strangetextures.com/@hc/feed.xml';
 *   UPDATE "Feed" SET image = 'https://f.strangetextures.com/media/podcasts/connector/cover_feed.jpg', "updatedAt" = NOW() WHERE "originalUrl" = 'https://f.strangetextures.com/@connector/feed.xml';
 *   UPDATE "Feed" SET image = 'https://f.strangetextures.com/media/podcasts/endless/cover_feed.jpg', "updatedAt" = NOW() WHERE "originalUrl" = 'https://f.strangetextures.com/@endless/feed.xml';
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const artworkUpdates = [
  {
    feedUrl: 'https://f.strangetextures.com/@aoe/feed.xml',
    artworkUrl: 'https://f.strangetextures.com/media/podcasts/aoe/cover_feed.png',
    title: 'An Observed Earth'
  },
  {
    feedUrl: 'https://f.strangetextures.com/@hc/feed.xml',
    artworkUrl: 'https://f.strangetextures.com/media/podcasts/hc/cover_feed.png',
    title: 'Heartland Captives'
  },
  {
    feedUrl: 'https://f.strangetextures.com/@connector/feed.xml',
    artworkUrl: 'https://f.strangetextures.com/media/podcasts/connector/cover_feed.jpg',
    title: 'Connector (Overtime Edition)'
  },
  {
    feedUrl: 'https://f.strangetextures.com/@endless/feed.xml',
    artworkUrl: 'https://f.strangetextures.com/media/podcasts/endless/cover_feed.jpg',
    title: 'Endless (Journeyland Edition)'
  }
];

async function main() {
  try {
    console.log('🎨 Adding artwork to Strange Textures albums...\n');

    for (const update of artworkUpdates) {
      console.log(`Processing: ${update.title}`);

      // Find the feed
      const feed = await prisma.feed.findFirst({
        where: { originalUrl: update.feedUrl }
      });

      if (!feed) {
        console.log(`  ❌ Feed not found: ${update.feedUrl}`);
        console.log(`  ℹ️  You may need to add this feed first\n`);
        continue;
      }

      console.log(`  ✅ Found feed: ${feed.title}`);
      console.log(`  📸 Current image: ${feed.image || 'None'}`);

      // Update the artwork
      const updated = await prisma.feed.update({
        where: { id: feed.id },
        data: {
          image: update.artworkUrl,
          updatedAt: new Date()
        }
      });

      console.log(`  ✨ Updated artwork to: ${updated.image}`);
      console.log(`  ✅ ${update.title} artwork added successfully!\n`);
    }

    console.log('🎉 All artwork updates completed!');

  } catch (error) {
    console.error('❌ Error updating artwork:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
