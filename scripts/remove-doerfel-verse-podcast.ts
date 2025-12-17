#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeDoerfelVerse() {
  try {
    console.log('🎯 Removing Into The Doerfel-Verse podcast feed...\n');

    // First, find the feed
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { title: { contains: 'Doerfel-Verse', mode: 'insensitive' } },
          { title: { contains: 'Into The Doerfel', mode: 'insensitive' } }
        ]
      }
    });

    if (!feed) {
      console.log('⚠️  Into The Doerfel-Verse feed not found in database');
      return;
    }

    console.log(`Found feed: ${feed.title} (ID: ${feed.id})`);
    console.log(`URL: ${feed.originalUrl}`);
    console.log(`Type: ${feed.type}`);

    // Count related data before deletion
    const trackCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    const favoriteAlbumCount = await prisma.favoriteAlbum.count({
      where: { feedId: feed.id }
    });

    const nostrPostCount = await prisma.nostrPost.count({
      where: { feedId: feed.id }
    });

    console.log(`\n📊 Related data:`);
    console.log(`  - Tracks: ${trackCount}`);
    console.log(`  - Favorite albums: ${favoriteAlbumCount}`);
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
          { title: { contains: 'Doerfel-Verse', mode: 'insensitive' } },
          { title: { contains: 'Into The Doerfel', mode: 'insensitive' } }
        ]
      }
    });

    if (!remainingFeed) {
      console.log('\n✅ Successfully removed Into The Doerfel-Verse podcast from database!');
    } else {
      console.error('\n❌ Feed still exists in database - removal may have failed');
    }

  } catch (error) {
    console.error('❌ Error removing Into The Doerfel-Verse:', error);
  } finally {
    await prisma.$disconnect();
  }
}

removeDoerfelVerse();
