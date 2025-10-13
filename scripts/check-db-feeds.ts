#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(__dirname, '.env') });
config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

async function main() {
  // Get all feeds that came from Wavlake (likely publisher albums)
  const wavlakeFeeds = await prisma.feed.findMany({
    where: {
      originalUrl: {
        contains: 'wavlake.com'
      }
    },
    select: {
      id: true,
      title: true,
      artist: true,
      type: true,
      originalUrl: true
    },
    orderBy: {
      artist: 'asc'
    }
  });

  console.log(`\n📊 Found ${wavlakeFeeds.length} Wavlake feeds in database\n`);

  // Group by artist
  const byArtist = wavlakeFeeds.reduce((acc, feed) => {
    const artist = feed.artist || 'Unknown';
    if (!acc[artist]) {
      acc[artist] = [];
    }
    acc[artist].push(feed);
    return acc;
  }, {} as Record<string, typeof wavlakeFeeds>);

  Object.entries(byArtist)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([artist, feeds]) => {
      console.log(`${artist}: ${feeds.length} albums`);
      feeds.slice(0, 3).forEach(f => {
        console.log(`  - "${f.title}" (type: ${f.type})`);
      });
      if (feeds.length > 3) {
        console.log(`  ... and ${feeds.length - 3} more`);
      }
      console.log();
    });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
