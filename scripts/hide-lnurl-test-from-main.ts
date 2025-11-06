/**
 * Script to hide the lnurl-testing-podcast from the main site
 * while keeping it accessible in the sidebar/menu
 *
 * Usage:
 *   npx tsx scripts/hide-lnurl-test-from-main.ts
 *
 * Or manually update in database:
 *   UPDATE "Feed" SET status = 'sidebar-only', "updatedAt" = NOW()
 *   WHERE title ILIKE '%lnurl%' OR title ILIKE '%testing%'
 *   OR "originalUrl" ILIKE '%lnurl-testing-podcast%';
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('🔍 Searching for lnurl-testing-podcast feed...');

    // Find the feed by title or URL pattern
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { title: { contains: 'lnurl', mode: 'insensitive' } },
          { title: { contains: 'testing', mode: 'insensitive' } },
          { originalUrl: { contains: 'lnurl-testing-podcast', mode: 'insensitive' } }
        ]
      }
    });

    if (!feed) {
      console.log('❌ Feed not found. Please check if it exists in the database.');
      console.log('📝 You may need to add it first or check the exact title/URL.');
      return;
    }

    console.log(`✅ Found feed: ${feed.title}`);
    console.log(`   ID: ${feed.id}`);
    console.log(`   Current status: ${feed.status}`);
    console.log(`   URL: ${feed.originalUrl}`);

    // Update the status to 'sidebar-only'
    const updated = await prisma.feed.update({
      where: { id: feed.id },
      data: {
        status: 'sidebar-only',
        updatedAt: new Date()
      }
    });

    console.log(`✨ Updated feed status to: ${updated.status}`);
    console.log('✅ Feed will now only appear in sidebar, not on main site.');

  } catch (error) {
    console.error('❌ Error updating feed:', error);
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
