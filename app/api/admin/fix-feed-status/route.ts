import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/fix-feed-status
 * Sets status to 'active' for feeds that have tracks but are in 'error' status
 */
export async function POST(request: NextRequest) {
  try {
    // Find all feeds with error status that have at least one track
    const errorFeedsWithTracks = await prisma.feed.findMany({
      where: {
        status: 'error',
        Track: {
          some: {}
        }
      },
      include: {
        _count: {
          select: { Track: true }
        }
      }
    });

    console.log(`Found ${errorFeedsWithTracks.length} error feeds with tracks`);

    // Update them to active
    const updated = await prisma.feed.updateMany({
      where: {
        id: {
          in: errorFeedsWithTracks.map(f => f.id)
        }
      },
      data: {
        status: 'active',
        lastError: null
      }
    });

    const feedList = errorFeedsWithTracks.map(f => ({
      id: f.id,
      title: f.title,
      trackCount: f._count.Track
    }));

    return NextResponse.json({
      success: true,
      message: `Updated ${updated.count} feeds from error to active`,
      feeds: feedList
    });

  } catch (error) {
    console.error('Error fixing feed status:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fix feed status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
