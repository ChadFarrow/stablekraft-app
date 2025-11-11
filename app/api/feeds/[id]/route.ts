import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/feeds/[id]
 * Get a single feed by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Feed ID is required',
        },
        { status: 400 }
      );
    }

    const feed = await prisma.feed.findUnique({
      where: { id },
      include: {
        _count: {
          select: { Track: true },
        },
      },
    });

    if (!feed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Feed not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: feed.id,
        title: feed.title,
        description: feed.description,
        originalUrl: feed.originalUrl,
        cdnUrl: feed.cdnUrl,
        type: feed.type,
        artist: feed.artist,
        image: feed.image,
        language: feed.language,
        category: feed.category,
        explicit: feed.explicit,
        priority: feed.priority,
        status: feed.status,
        v4vRecipient: feed.v4vRecipient,
        v4vValue: feed.v4vValue,
        trackCount: feed._count.Track,
        createdAt: feed.createdAt,
        updatedAt: feed.updatedAt,
        lastFetched: feed.lastFetched,
        lastError: feed.lastError,
      },
    });
  } catch (error) {
    console.error('Error fetching feed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch feed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

