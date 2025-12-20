import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyEvent } from 'nostr-tools';
import { Contacts } from 'nostr-tools/kinds';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * POST /api/nostr/follow
 * Follow or unfollow a user using a signed kind-3 contact list event.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Missing user ID' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { followingId, action, signedEvent } = body;

    if (!followingId || typeof followingId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'followingId is required' },
        { status: 400 }
      );
    }

    if (followingId === userId) {
      return NextResponse.json(
        { success: false, error: 'You cannot follow yourself' },
        { status: 400 }
      );
    }

    // Load current user
    let currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Current user not found' },
        { status: 404 }
      );
    }

    // --- AUTO-NORMALIZE DB PUBKEY ---
    const normalizedDbKey = normalizePubkey(currentUser.nostrPubkey);
    if (!normalizedDbKey) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey stored for current user' },
        { status: 500 }
      );
    }

    if (normalizedDbKey !== currentUser.nostrPubkey) {
      currentUser = await prisma.user.update({
        where: { id: currentUser.id },
        data: { nostrPubkey: normalizedDbKey },
      });
    }

    const userPubkeyHex = normalizedDbKey;

    // Validate signed event (if provided)
    if (signedEvent) {
      const eventPubkeyHex = normalizePubkey(signedEvent.pubkey);
      if (!eventPubkeyHex) {
        return NextResponse.json(
          { success: false, error: 'Invalid pubkey in signed event' },
          { status: 400 }
        );
      }

      if (eventPubkeyHex !== userPubkeyHex) {
        return NextResponse.json(
          { success: false, error: 'Signed event pubkey does not match your account' },
          { status: 401 }
        );
      }

      if (!verifyEvent(signedEvent)) {
        return NextResponse.json(
          { success: false, error: 'Invalid signature' },
          { status: 400 }
        );
      }

      if (signedEvent.kind !== Contacts) {
        return NextResponse.json(
          { success: false, error: 'Signed event must be kind 3 (contact list)' },
          { status: 400 }
        );
      }
    }

    // Check that the target user exists
    const followingUser = await prisma.user.findUnique({ where: { id: followingId } });
    if (!followingUser) {
      return NextResponse.json(
        { success: false, error: 'The user you are following does not exist' },
        { status: 404 }
      );
    }

    // --- FOLLOW ---
    if (action === 'follow') {
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

      // Create follow relationship
      const follow = await prisma.follow.create({
        data: {
          followerId: userId,
          followingId,
        },
      });

      // Publish contact list if signed event provided
      if (signedEvent) {
        const relays =
          currentUser.relays.length > 0 ? currentUser.relays : getDefaultRelays();
        const sanitizedRelays = relays.filter((r) => r.startsWith('wss://'));

        const client = new NostrClient(sanitizedRelays);
        await client.connect();
        const results = await client.publish(signedEvent, {
          relays: sanitizedRelays,
          waitForRelay: true,
        });
        await client.disconnect();

        const published = results.some((r) => r.status === 'fulfilled');

        return NextResponse.json({
          success: true,
          data: follow,
          eventId: signedEvent.id,
          published,
          message: published
            ? 'Followed and published to Nostr'
            : 'Followed (failed to publish to relays)',
        });
      }

      return NextResponse.json({
        success: true,
        data: follow,
        message: 'Followed (waiting for signed event to publish)',
      });
    }

    // --- UNFOLLOW ---
    if (action === 'unfollow') {
      const deleted = await prisma.follow.deleteMany({
        where: {
          followerId: userId,
          followingId,
        },
      });

      if (deleted.count === 0) {
        return NextResponse.json(
          { success: false, error: 'You are not following this user' },
          { status: 404 }
        );
      }

      if (signedEvent) {
        const relays =
          currentUser.relays.length > 0 ? currentUser.relays : getDefaultRelays();
        const sanitizedRelays = relays.filter((r) => r.startsWith('wss://'));

        const client = new NostrClient(sanitizedRelays);
        await client.connect();
        const results = await client.publish(signedEvent, {
          relays: sanitizedRelays,
          waitForRelay: true,
        });
        await client.disconnect();

        const published = results.some((r) => r.status === 'fulfilled');

        return NextResponse.json({
          success: true,
          eventId: signedEvent.id,
          published,
          message: published
            ? 'Unfollowed and published to Nostr'
            : 'Unfollowed (failed to publish to relays)',
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Unfollowed (waiting for signed event to publish)',
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action (use follow or unfollow)' },
      { status: 400 }
    );
  } catch (err) {
    console.error('Follow route error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to follow/unfollow' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/nostr/follow
 * Check if one user is following another
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Missing user ID' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const followingId = searchParams.get('followingId');

    if (!followingId) {
      return NextResponse.json(
        { success: false, error: 'followingId is required' },
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
  } catch (err) {
    console.error('Check follow error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to check follow status' },
      { status: 500 }
    );
  }
}