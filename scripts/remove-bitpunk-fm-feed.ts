#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Feeds to remove
const FEEDS_TO_REMOVE = [
  {
    url: 'https://zine.bitpunk.fm/feeds/bitpunk-fm.xml',
    id: 'bitpunk-fm',
    name: 'bitpunk.fm'
  },
  {
    url: 'https://zine.bitpunk.fm/feeds/unwound.xml',
    id: 'unwound',
    name: 'bitpunk.fm unwound'
  }
];

async function removeFeed(feedConfig: typeof FEEDS_TO_REMOVE[0]) {
  try {
    // First, find the feed
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { originalUrl: feedConfig.url },
          { id: feedConfig.id }
        ]
      }
    });

    if (!feed) {
      console.log(`⚠️  ${feedConfig.name} feed not found in database`);
      return false;
    }

    console.log(`\n📋 Found feed: ${feed.title} (ID: ${feed.id})`);
    console.log(`   URL: ${feed.originalUrl}`);

    // Count related data before deletion
    const trackCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    const favoriteAlbumCount = await prisma.favoriteAlbum.count({
      where: { feedId: feed.id }
    });

    // Get track IDs first, then count favorite tracks
    const trackIds = await prisma.track.findMany({
      where: { feedId: feed.id },
      select: { id: true }
    });
    
    const favoriteTrackCount = trackIds.length > 0
      ? await prisma.favoriteTrack.count({
          where: { trackId: { in: trackIds.map(t => t.id) } }
        })
      : 0;

    const nostrPostCount = await prisma.nostrPost.count({
      where: { feedId: feed.id }
    });

    console.log(`\n📊 Related data:`);
    console.log(`  - Tracks: ${trackCount}`);
    console.log(`  - Favorite albums: ${favoriteAlbumCount}`);
    console.log(`  - Favorite tracks: ${favoriteTrackCount}`);
    console.log(`  - Nostr posts: ${nostrPostCount}`);

    // Delete the feed (tracks will cascade delete due to onDelete: Cascade)
    console.log('\n🗑️  Deleting feed and all related data...');
    
    // First delete FavoriteAlbum records
    if (favoriteAlbumCount > 0) {
      await prisma.favoriteAlbum.deleteMany({
        where: { feedId: feed.id }
      });
      console.log(`  ✅ Deleted ${favoriteAlbumCount} favorite album records`);
    }

    // Delete FavoriteTrack records (tracks will be deleted, but we need to delete favorites first)
    if (favoriteTrackCount > 0 && trackIds.length > 0) {
      await prisma.favoriteTrack.deleteMany({
        where: { trackId: { in: trackIds.map(t => t.id) } }
      });
      console.log(`  ✅ Deleted ${favoriteTrackCount} favorite track records`);
    }

    // Delete NostrPost records
    if (nostrPostCount > 0) {
      await prisma.nostrPost.deleteMany({
        where: { feedId: feed.id }
      });
      console.log(`  ✅ Deleted ${nostrPostCount} Nostr post records`);
    }

    // Delete the feed (tracks will cascade)
    await prisma.feed.delete({
      where: { id: feed.id }
    });

    console.log(`  ✅ Deleted feed and ${trackCount} tracks`);

    // Verify deletion
    const remainingFeed = await prisma.feed.findFirst({
      where: {
        OR: [
          { originalUrl: feedConfig.url },
          { id: feedConfig.id }
        ]
      }
    });

    if (!remainingFeed) {
      console.log(`\n✅ Successfully removed ${feedConfig.name} feed from database!`);
      return true;
    } else {
      console.error(`\n❌ ${feedConfig.name} feed still exists in database - removal may have failed`);
      return false;
    }

  } catch (error) {
    console.error(`❌ Error removing ${feedConfig.name} feed:`, error);
    return false;
  }
}

async function removeBitpunkFmFeeds() {
  try {
    console.log('🎯 Removing bitpunk.fm feeds...\n');
    console.log(`Found ${FEEDS_TO_REMOVE.length} feed(s) to remove\n`);

    let successCount = 0;
    for (const feedConfig of FEEDS_TO_REMOVE) {
      const success = await removeFeed(feedConfig);
      if (success) successCount++;
    }

    console.log(`\n\n📊 Summary: ${successCount}/${FEEDS_TO_REMOVE.length} feed(s) removed successfully`);

  } catch (error) {
    console.error('❌ Error removing bitpunk.fm feeds:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

removeBitpunkFmFeeds();

