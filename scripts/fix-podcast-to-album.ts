#!/usr/bin/env ts-node

/**
 * Script to identify and fix feeds that are marked as "podcast" 
 * but should be "album" type so they show on the main page
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Keywords that suggest a feed is music content, not a podcast
const MUSIC_KEYWORDS = [
  'single',
  'album',
  'ep',
  'song',
  'track',
  'music',
  'release',
  'record',
  'vinyl',
  'cd',
  'mixtape',
  'soundtrack',
  'compilation'
];

// Patterns in titles that suggest music
const MUSIC_PATTERNS = [
  /\(single\)/i,
  /\(album\)/i,
  /\(ep\)/i,
  /\[single\]/i,
  /\[album\]/i,
  /\[ep\]/i,
  / - single$/i,
  / - album$/i,
  / - ep$/i,
];

// Categories that suggest music
const MUSIC_CATEGORIES = [
  'music',
  'music commentary',
  'music interviews',
  'performing arts',
  'comedy music'
];

async function shouldBeAlbum(feed: any): Promise<boolean> {
  const title = (feed.title || '').toLowerCase();
  const description = (feed.description || '').toLowerCase();
  const category = (feed.category || '').toLowerCase();
  const artist = (feed.artist || '').toLowerCase();
  
  // Check for music keywords in title or description
  const hasMusicKeyword = MUSIC_KEYWORDS.some(keyword => 
    title.includes(keyword) || description.includes(keyword)
  );
  
  // Check for music patterns in title
  const hasMusicPattern = MUSIC_PATTERNS.some(pattern => pattern.test(title));
  
  // Check category
  const hasMusicCategory = MUSIC_CATEGORIES.some(cat => category.includes(cat));
  
  // Check if it has tracks (albums usually have multiple tracks)
  const trackCount = feed._count?.Track || 0;
  const hasMultipleTracks = trackCount > 1;
  
  // If it has music indicators and multiple tracks, it's likely an album
  if ((hasMusicKeyword || hasMusicPattern || hasMusicCategory) && hasMultipleTracks) {
    return true;
  }
  
  // Singles often have just one track
  if ((hasMusicKeyword || hasMusicPattern) && trackCount === 1) {
    return true;
  }
  
  // If title looks like a song/album name (short, no "episode", "show", etc.)
  const podcastKeywords = ['episode', 'show', 'podcast', 'radio', 'broadcast', 'interview'];
  const hasPodcastKeyword = podcastKeywords.some(keyword => 
    title.includes(keyword) || description.includes(keyword)
  );
  
  // If it doesn't have podcast keywords but has tracks, might be music
  if (!hasPodcastKeyword && trackCount > 0 && title.length < 50) {
    return true;
  }
  
  return false;
}

async function main() {
  console.log('🔍 Finding feeds marked as "podcast" that should be "album"...\n');
  
  // Get all active feeds marked as podcast
  const podcastFeeds = await prisma.feed.findMany({
    where: {
      status: 'active',
      type: 'podcast'
    },
    include: {
      _count: {
        select: { Track: true }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });
  
  console.log(`Found ${podcastFeeds.length} feeds marked as "podcast"\n`);
  
  const feedsToFix: any[] = [];
  
  for (const feed of podcastFeeds) {
    const shouldFix = await shouldBeAlbum(feed);
    if (shouldFix) {
      feedsToFix.push(feed);
      console.log(`✓ ${feed.title}`);
      console.log(`  Artist: ${feed.artist || 'N/A'}`);
      console.log(`  Tracks: ${feed._count.Track}`);
      console.log(`  Category: ${feed.category || 'N/A'}`);
      console.log(`  URL: ${feed.originalUrl}`);
      console.log('');
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`  Total podcast feeds: ${podcastFeeds.length}`);
  console.log(`  Feeds that should be albums: ${feedsToFix.length}`);
  
  if (feedsToFix.length === 0) {
    console.log('\n✅ No feeds need to be fixed!');
    await prisma.$disconnect();
    return;
  }
  
  console.log(`\n⚠️  Found ${feedsToFix.length} feeds that should be changed from "podcast" to "album"`);
  console.log('\nTo fix them, run:');
  console.log('  npm run fix-podcast-feeds -- --apply\n');
  
  // Check if --apply flag is passed
  const args = process.argv.slice(2);
  if (args.includes('--apply')) {
    console.log('🔄 Applying fixes...\n');
    
    for (const feed of feedsToFix) {
      await prisma.feed.update({
        where: { id: feed.id },
        data: { type: 'album' }
      });
      console.log(`✅ Updated: ${feed.title}`);
    }
    
    console.log(`\n✅ Fixed ${feedsToFix.length} feeds!`);
  } else {
    console.log('💡 Run with --apply to actually update the database');
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);

