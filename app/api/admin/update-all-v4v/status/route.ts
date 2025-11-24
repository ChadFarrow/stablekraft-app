import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

export async function GET(request: NextRequest) {
  try {
    // Check a few sample tracks from the problematic albums to see if they've been updated
    const sampleTracks = await prisma.track.findMany({
      where: {
        OR: [
          { title: 'The Platform' },
          { title: 'MoeFactz' },
          { title: 'Stay Awhile' },
          { title: 'Makin\' Beans' }
        ]
      },
      select: {
        id: true,
        title: true,
        v4vValue: true,
        updatedAt: true,
        Feed: {
          select: {
            title: true
          }
        }
      },
      take: 10
    });

    // Count total tracks with v4vValue
    const tracksWithV4V = await prisma.track.count({
      where: {
        v4vValue: { not: null }
      }
    });

    const totalTracks = await prisma.track.count();
    const totalFeeds = await prisma.feed.count();

    // Check if sample tracks have been updated recently (within last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentlyUpdated = sampleTracks.filter(track => 
      track.updatedAt && new Date(track.updatedAt) > oneHourAgo
    );

    return NextResponse.json({
      success: true,
      status: {
        totalFeeds,
        totalTracks,
        tracksWithV4V,
        coverage: totalTracks > 0 ? Math.round((tracksWithV4V / totalTracks) * 100) : 0,
        sampleTracks: sampleTracks.map(track => ({
          title: track.title,
          feed: track.Feed?.title,
          hasV4V: !!track.v4vValue,
          updatedAt: track.updatedAt,
          recentlyUpdated: track.updatedAt && new Date(track.updatedAt) > oneHourAgo
        })),
        recentlyUpdatedCount: recentlyUpdated.length,
        note: recentlyUpdated.length > 0 
          ? 'Tracks have been updated recently - refresh may be in progress or complete'
          : 'No recent updates detected - refresh may not have started yet or completed earlier'
      }
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

