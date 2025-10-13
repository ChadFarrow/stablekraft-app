#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

const joeMartinGuids = [
  '1c7917cc-357c-4eaf-ab54-1a7cda504976',
  'e1f9dfcb-ee9b-4a6d-aee7-189043917fb5',
  '95ea253a-4058-402c-8503-204f6d3f1494',
  'd4f791c3-4d0c-4fbd-a543-c136ee78a9de',
  '51606506-66f8-4394-b6c6-cc0c1b554375',
  '6b7793b8-fd9d-432b-af1a-184cd41aaf9d',
  '0bb8c9c7-1c55-4412-a517-572a98318921',
  '16e46ed0-b392-4419-a937-a7815f6ca43b',
  '2cd1b9ea-9ef3-4a54-aa25-55295689f442',
  '33eeda7e-8591-4ff5-83f8-f36a879b0a09',
  '32a79df8-ec3e-4a14-bfcb-7a074e1974b9',
  '06376ab5-efca-459c-9801-49ceba5fdab1',
  'c16028bf-ceb4-4200-9463-4b45ea8c0b7b'
];

async function checkGuids() {
  console.log('Checking which Joe Martin GUIDs exist in database...\n');

  let found = 0;
  let notFound = 0;

  for (const guid of joeMartinGuids) {
    const feeds = await prisma.feed.findMany({
      where: {
        originalUrl: {
          contains: guid,
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        title: true,
        artist: true,
        originalUrl: true
      }
    });

    if (feeds.length > 0) {
      found++;
      console.log(`✅ ${guid}`);
      feeds.forEach(feed => {
        console.log(`   Title: ${feed.title}`);
        console.log(`   Artist: ${feed.artist}`);
        console.log(`   ID: ${feed.id}`);
      });
    } else {
      notFound++;
      console.log(`❌ ${guid} - NOT IN DATABASE`);
    }
    console.log('');
  }

  console.log(`\nSummary: ${found}/${joeMartinGuids.length} albums found in database`);
  console.log(`Missing: ${notFound} albums`);

  await prisma.$disconnect();
}

checkGuids().catch(console.error).finally(() => prisma.$disconnect());
