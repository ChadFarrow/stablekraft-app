#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

async function checkUrls() {
  const feeds = await prisma.feed.findMany({
    where: {
      artist: 'Joe Martin',
      status: 'active',
      type: 'album'
    },
    select: {
      id: true,
      title: true,
      originalUrl: true
    }
  });

  console.log(`Found ${feeds.length} Joe Martin albums in database:\n`);

  feeds.forEach((feed, i) => {
    console.log(`${i + 1}. ${feed.title}`);
    console.log(`   ID: ${feed.id}`);
    console.log(`   URL: ${feed.originalUrl}`);

    // Extract GUID from URL
    const guidMatch = feed.originalUrl.match(/([a-f0-9-]{36})/i);
    if (guidMatch) {
      console.log(`   GUID: ${guidMatch[1]}`);
    } else {
      console.log(`   GUID: NOT FOUND`);
    }
    console.log('');
  });

  await prisma.$disconnect();
}

checkUrls().catch(console.error).finally(() => prisma.$disconnect());
