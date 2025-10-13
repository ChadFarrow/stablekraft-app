#!/usr/bin/env ts-node

/**
 * Check Publisher Album Counts
 *
 * Compares the number of remoteItems in each publisher feed
 * vs the number of albums in the database for that publisher
 */

import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: path.join(__dirname, '.env') });
config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

interface PublisherFeed {
  title: string;
  feed: {
    id: string;
    originalUrl: string;
  };
  remoteItemCount: number;
}

async function countRemoteItems(feedUrl: string): Promise<number> {
  try {
    const response = await fetch(feedUrl);
    if (!response.ok) return 0;

    const xml = await response.text();
    const matches = xml.match(/<podcast:remoteItem[^>]*>/g) || [];
    return matches.length;
  } catch (error) {
    return 0;
  }
}

async function countDatabaseAlbums(publisherName: string): Promise<number> {
  const count = await prisma.feed.count({
    where: {
      artist: {
        contains: publisherName,
        mode: 'insensitive'
      },
      type: 'album'
    }
  });
  return count;
}

async function main() {
  console.log('🔍 Publisher Album Count Comparison\n');
  console.log('═'.repeat(80));

  const publisherFeedsPath = path.join(process.cwd(), 'data', 'publisher-feed-results.json');
  const publisherFeeds: PublisherFeed[] = JSON.parse(fs.readFileSync(publisherFeedsPath, 'utf-8'));

  const results: Array<{
    name: string;
    feedCount: number;
    dbCount: number;
    missing: number;
  }> = [];

  for (const publisherFeed of publisherFeeds) {
    const publisherName = publisherFeed.title?.replace(/<!\\[CDATA\\[|\\]\\]>/g, '') || 'Unknown';
    const feedUrl = publisherFeed.feed.originalUrl;

    console.log(`\n📻 ${publisherName}`);

    // Get count from feed
    const feedCount = await countRemoteItems(feedUrl);
    console.log(`   Feed: ${feedCount} albums`);

    // Get count from database
    const dbCount = await countDatabaseAlbums(publisherName);
    console.log(`   Database: ${dbCount} albums`);

    const missing = Math.max(0, feedCount - dbCount);
    if (missing > 0) {
      console.log(`   ⚠️  Missing: ${missing} albums`);
    } else {
      console.log(`   ✅ Complete`);
    }

    results.push({
      name: publisherName,
      feedCount,
      dbCount,
      missing
    });

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '═'.repeat(80));
  console.log('\n📊 Summary:\n');

  const totalFeedAlbums = results.reduce((sum, r) => sum + r.feedCount, 0);
  const totalDbAlbums = results.reduce((sum, r) => sum + r.dbCount, 0);
  const totalMissing = results.reduce((sum, r) => sum + r.missing, 0);

  console.log(`Total albums in feeds: ${totalFeedAlbums}`);
  console.log(`Total albums in database: ${totalDbAlbums}`);
  console.log(`Total missing: ${totalMissing}`);

  if (totalMissing > 0) {
    console.log('\n⚠️  Publishers with missing albums:\n');
    results
      .filter(r => r.missing > 0)
      .sort((a, b) => b.missing - a.missing)
      .forEach(r => {
        console.log(`   ${r.name}: ${r.missing} missing (${r.dbCount}/${r.feedCount})`);
      });
  }

  console.log('\n' + '═'.repeat(80) + '\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
