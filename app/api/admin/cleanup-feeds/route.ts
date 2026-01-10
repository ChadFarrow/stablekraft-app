import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Cutoff date - feeds created before this are considered "manually added" and kept
const BULK_IMPORT_CUTOFF = new Date('2025-11-01T00:00:00Z');

async function getCleanupStats() {
  // Get feeds to KEEP
  const feedsWithTracks = await prisma.feed.findMany({
    where: { Track: { some: {} } },
    select: { id: true, title: true }
  });

  const feedsLinkedToPublisher = await prisma.feed.findMany({
    where: {
      publisherId: { not: null },
      id: { notIn: feedsWithTracks.map(f => f.id) }
    },
    select: { id: true, title: true }
  });

  const publisherFeeds = await prisma.feed.findMany({
    where: {
      type: 'publisher',
      id: { notIn: [...feedsWithTracks, ...feedsLinkedToPublisher].map(f => f.id) }
    },
    select: { id: true, title: true }
  });

  const preImportFeeds = await prisma.feed.findMany({
    where: {
      createdAt: { lt: BULK_IMPORT_CUTOFF },
      id: { notIn: [...feedsWithTracks, ...feedsLinkedToPublisher, ...publisherFeeds].map(f => f.id) }
    },
    select: { id: true, title: true }
  });

  // Combine all IDs to keep
  const keepIds = new Set([
    ...feedsWithTracks.map(f => f.id),
    ...feedsLinkedToPublisher.map(f => f.id),
    ...publisherFeeds.map(f => f.id),
    ...preImportFeeds.map(f => f.id)
  ]);

  // Get feeds to DELETE (only Wavlake feeds not in keep list)
  const feedsToDelete = await prisma.feed.findMany({
    where: {
      id: { notIn: Array.from(keepIds) },
      originalUrl: { contains: 'wavlake.com' }
    },
    select: { id: true, title: true, artist: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });

  // Get total counts
  const totalFeeds = await prisma.feed.count();
  const totalWavlakeFeeds = await prisma.feed.count({
    where: { originalUrl: { contains: 'wavlake.com' } }
  });

  return {
    totalFeeds,
    totalWavlakeFeeds,
    keepReasons: {
      hasTracks: feedsWithTracks.length,
      linkedToPublisher: feedsLinkedToPublisher.length,
      isPublisher: publisherFeeds.length,
      preImport: preImportFeeds.length,
      totalToKeep: keepIds.size
    },
    toDelete: {
      count: feedsToDelete.length,
      feeds: feedsToDelete
    }
  };
}

// GET - Preview what will be deleted (dry run)
export async function GET() {
  try {
    console.log('🔍 Running cleanup dry run...');

    const stats = await getCleanupStats();

    return NextResponse.json({
      dryRun: true,
      message: 'This is a preview. Use POST with { "confirm": true } to execute.',
      stats: {
        totalFeeds: stats.totalFeeds,
        totalWavlakeFeeds: stats.totalWavlakeFeeds,
        feedsToKeep: stats.keepReasons.totalToKeep,
        feedsToDelete: stats.toDelete.count,
        keepReasons: stats.keepReasons
      },
      sampleDeletions: stats.toDelete.feeds.slice(0, 20).map(f => ({
        id: f.id,
        title: f.title,
        artist: f.artist,
        createdAt: f.createdAt
      })),
      allDeletions: stats.toDelete.feeds.map(f => `${f.title} - ${f.artist}`)
    });

  } catch (error) {
    console.error('❌ Cleanup dry run error:', error);
    return NextResponse.json(
      { error: 'Failed to run cleanup preview', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// POST - Execute deletion with confirmation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.confirm) {
      return NextResponse.json(
        { error: 'Confirmation required. Send { "confirm": true } to execute cleanup.' },
        { status: 400 }
      );
    }

    console.log('🧹 Starting feed cleanup...');

    const stats = await getCleanupStats();
    const feedIdsToDelete = stats.toDelete.feeds.map(f => f.id);

    if (feedIdsToDelete.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No feeds to delete',
        deleted: 0
      });
    }

    // Log what we're about to delete
    console.log(`🗑️ Deleting ${feedIdsToDelete.length} feeds...`);
    stats.toDelete.feeds.forEach(f => {
      console.log(`  - ${f.title} (${f.artist})`);
    });

    // Delete tracks first (should cascade, but being explicit)
    const deletedTracks = await prisma.track.deleteMany({
      where: { feedId: { in: feedIdsToDelete } }
    });

    // Delete the feeds
    const deletedFeeds = await prisma.feed.deleteMany({
      where: { id: { in: feedIdsToDelete } }
    });

    console.log(`✅ Cleanup complete: ${deletedFeeds.count} feeds, ${deletedTracks.count} tracks deleted`);

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed',
      deleted: {
        feeds: deletedFeeds.count,
        tracks: deletedTracks.count
      },
      deletedFeedTitles: stats.toDelete.feeds.map(f => `${f.title} - ${f.artist}`)
    });

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to execute cleanup', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
