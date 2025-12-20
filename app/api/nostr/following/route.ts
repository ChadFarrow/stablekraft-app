import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * GET /api/nostr/following
 * Get the users someone is following.
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
        { success: false, error: 'User ID required' },
        { status: 400 }
      );
    }

    // Load follow entries
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

    const normalized = [];

    for (const follow of follows) {
      const user = follow.following;

      if (!user) continue;

      const hex = normalizePubkey(user.nostrPubkey);

      if (!hex) {
        console.warn('Invalid nostrPubkey for following user:', user.id, user.nostrPubkey);
        continue;
      }

      // Auto-fix DB if needed
      if (hex !== user.nostrPubkey) {
        await prisma.user.update({
          where: { id: user.id },
          data: { nostrPubkey: hex },
        });
      }

      normalized.push({
        id: user.id,
        nostrPubkey: hex,
        nostrNpub: user.nostrNpub,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        followedAt: follow.createdAt,
      });
    }

    return NextResponse.json({
      success: true,
      data: normalized,
      count: normalized.length,
    });
  } catch (error) {
    console.error('Get following error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get following' },
      { status: 500 }
    );
  }
}