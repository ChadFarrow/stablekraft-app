import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Get all album feeds that are missing images
    const feedsWithoutImages = await prisma.feed.findMany({
      where: {
        type: 'album',
        status: 'active',
        OR: [
          { image: null },
          { image: '' }
        ]
      },
      select: {
        id: true,
        title: true,
        artist: true,
        originalUrl: true,
        image: true,
        _count: {
          select: { Track: true }
        }
      },
      orderBy: {
        title: 'asc'
      }
    });

    // Get total album feeds for comparison
    const totalAlbumFeeds = await prisma.feed.count({
      where: {
        type: 'album',
        status: 'active'
      }
    });

    const feedsWithImages = await prisma.feed.count({
      where: {
        type: 'album',
        status: 'active',
        AND: [
          {
            image: {
              not: null
            }
          },
          {
            image: {
              not: ''
            }
          }
        ]
      }
    });

    return NextResponse.json({
      summary: {
        totalAlbumFeeds,
        feedsWithImages,
        feedsWithoutImages: totalAlbumFeeds - feedsWithImages,
        percentageMissing: ((totalAlbumFeeds - feedsWithImages) / totalAlbumFeeds * 100).toFixed(2) + '%'
      },
      feedsWithoutImages: feedsWithoutImages.map(feed => ({
        id: feed.id,
        title: feed.title,
        artist: feed.artist,
        originalUrl: feed.originalUrl,
        trackCount: feed._count.Track
      }))
    }, { status: 200 });
  } catch (error) {
    console.error('Error checking missing images:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: (error as Error).message },
      { status: 500 }
    );
  }
}
