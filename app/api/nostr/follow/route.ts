import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createContactList } from '@/lib/nostr/events';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';

/**
 * POST /api/nostr/follow
 * Follow or unfollow a user - publishes to Nostr relays (kind 3) and caches in database
 * Body: { followingId: string, action: 'follow' | 'unfollow' }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    const privateKey = request.headers.get('x-nostr-private-key');

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'User ID required',
        },
        { status: 401 }
      );
    }

    if (!privateKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Private key required for Nostr publishing',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { followingId, action } = body;

    if (!followingId || typeof followingId !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'followingId is required',
        },
        { status: 400 }
      );
    }

    if (userId === followingId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot follow yourself',
        },
        { status: 400 }
      );
    }

    // Get current user
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'Current user not found',
        },
        { status: 404 }
      );
    }

    // Verify following user exists
    const followingUser = await prisma.user.findUnique({
      where: { id: followingId },
    });

    if (!followingUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found',
        },
        { status: 404 }
      );
    }

    if (action === 'follow') {
      // Check if already following
      const existing = await prisma.follow.findUnique({
        where: {
          followerId_followingId: {
            followerId: userId,
            followingId,
          },
        },
      });

      if (existing) {
        return NextResponse.json({
          success: true,
          data: existing,
          message: 'Already following',
        });
      }

      // Create follow relationship in database first
      const follow = await prisma.follow.create({
        data: {
          followerId: userId,
          followingId,
        },
      });

      // Get all users this user is following (including the new one) to build contact list
      const allFollows = await prisma.follow.findMany({
        where: { followerId: userId },
        include: {
          following: {
            select: {
              nostrPubkey: true,
            },
          },
        },
      });

      // Build contact list with all pubkeys
      const pubkeys = allFollows.map(f => f.following.nostrPubkey);

      // Create and publish kind 3 contact list event to Nostr
      const contactListEvent = createContactList(pubkeys, privateKey);

      // Use user's relays or default relays
      const relayUrls = currentUser.relays.length > 0 ? currentUser.relays : getDefaultRelays();
      const client = new NostrClient(relayUrls);
      await client.connect();
      const publishResults = await client.publish(contactListEvent, {
        relays: relayUrls,
        waitForRelay: true,
      });
      await client.disconnect();

      const published = publishResults.some(r => r.status === 'fulfilled');
      if (!published) {
        console.warn('⚠️ Failed to publish contact list to any Nostr relay');
      }

      return NextResponse.json({
        success: true,
        data: follow,
        eventId: contactListEvent.id,
        published,
        message: 'Followed and published to Nostr successfully',
      });
    } else if (action === 'unfollow') {
      // Remove follow relationship from database first
      const deleted = await prisma.follow.deleteMany({
        where: {
          followerId: userId,
          followingId,
        },
      });

      if (deleted.count === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Not following this user',
          },
          { status: 404 }
        );
      }

      // Get remaining users this user is following to rebuild contact list
      const remainingFollows = await prisma.follow.findMany({
        where: { followerId: userId },
        include: {
          following: {
            select: {
              nostrPubkey: true,
            },
          },
        },
      });

      // Build contact list with remaining pubkeys
      const pubkeys = remainingFollows.map(f => f.following.nostrPubkey);

      // Create and publish updated kind 3 contact list event to Nostr
      const contactListEvent = createContactList(pubkeys, privateKey);

      // Use user's relays or default relays
      const relayUrls = currentUser.relays.length > 0 ? currentUser.relays : getDefaultRelays();
      const client = new NostrClient(relayUrls);
      await client.connect();
      const publishResults = await client.publish(contactListEvent, {
        relays: relayUrls,
        waitForRelay: true,
      });
      await client.disconnect();

      const published = publishResults.some(r => r.status === 'fulfilled');
      if (!published) {
        console.warn('⚠️ Failed to publish updated contact list to any Nostr relay');
      }

      return NextResponse.json({
        success: true,
        eventId: contactListEvent.id,
        published,
        message: 'Unfollowed and published to Nostr successfully',
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid action. Use "follow" or "unfollow"',
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Follow/unfollow error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to follow/unfollow user',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/nostr/follow
 * Check if following a user
 * Query: ?followingId=string
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'User ID required',
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const followingId = searchParams.get('followingId');

    if (!followingId) {
      return NextResponse.json(
        {
          success: false,
          error: 'followingId is required',
        },
        { status: 400 }
      );
    }

    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId,
        },
      },
    });

    return NextResponse.json({
      success: true,
      isFollowing: !!follow,
      data: follow,
    });
  } catch (error) {
    console.error('Check follow error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check follow status',
      },
      { status: 500 }
    );
  }
}

