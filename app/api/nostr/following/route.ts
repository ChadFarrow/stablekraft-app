import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/nostr/following
 * Get users being followed
 * Query: ?userId=string (optional, defaults to current user)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const currentUserId = request.headers.get('x-nostr-user-id');

    const userId = targetUserId || currentUserId;

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'User ID required',
        },
        { status: 400 }
      );
    }

    const follows = await prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            id: true,
            nostrPubkey: true,
            nostrNpub: true,
            displayName: true,
            avatar: true,
            bio: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const following = follows.map(follow => ({
      ...follow.following,
      followedAt: follow.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data: following,
      count: following.length,
    });
  } catch (error) {
    console.error('Get following error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get following',
      },
      { status: 500 }
    );
  }
}

