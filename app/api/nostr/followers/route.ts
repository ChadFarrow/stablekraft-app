import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * GET /api/nostr/followers
 * Get followers for a user.
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

    // Load followers
    const follows = await prisma.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: {
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
      const follower = follow.follower;
      if (!follower) continue;

      // Normalize pubkey
      const hex = normalizePubkey(follower.nostrPubkey);
      if (!hex) {
        console.warn('Invalid pubkey for follower:', follower.id, follower.nostrPubkey);
        continue;
      }

      // Auto-fix legacy DB values if mismatched
      if (hex !== follower.nostrPubkey) {
        await prisma.user.update({
          where: { id: follower.id },
          data: { nostrPubkey: hex },
        });
      }

      normalized.push({
        id: follower.id,
        nostrPubkey: hex,
        nostrNpub: follower.nostrNpub,
        displayName: follower.displayName,
        avatar: follower.avatar,
        bio: follower.bio,
        followedAt: follow.createdAt,
      });
    }

    return NextResponse.json({
      success: true,
      data: normalized,
      count: normalized.length,
    });
  } catch (error) {
    console.error('Get followers error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get followers' },
      { status: 500 }
    );
  }
}