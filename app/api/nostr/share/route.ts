import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { verifyEvent } from 'nostr-tools';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * POST /api/nostr/share
 * Share a track or album to Nostr using a signed kind-1 note.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trackId, feedId, signedEvent, message } = body;

    if (!trackId && !feedId) {
      return NextResponse.json(
        { success: false, error: 'trackId or feedId is required' },
        { status: 400 }
      );
    }

    // Load current user
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // --- AUTO-NORMALIZE DB PUBKEY ---
    const normalizedDbKey = normalizePubkey(user.nostrPubkey);
    if (!normalizedDbKey) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey for this user' },
        { status: 500 }
      );
    }

    if (normalizedDbKey !== user.nostrPubkey) {
      user = await prisma.user.update({
        where: { id: userId },
        data: { nostrPubkey: normalizedDbKey },
      });
    }

    const userPubkeyHex = normalizedDbKey;

    // --- VALIDATE SIGNED EVENT ---
    if (!signedEvent) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Signed event required. Use NIP-07, NIP-46, or NIP-55 compatible signer.',
        },
        { status: 400 }
      );
    }

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
        { success: false, error: 'Invalid signature for signed event' },
        { status: 400 }
      );
    }

    if (signedEvent.kind !== 1) {
      return NextResponse.json(
        { success: false, error: 'Event must be a kind 1 note' },
        { status: 400 }
      );
    }

    const event = signedEvent;

    // --- LOAD TRACK/ALBUM METADATA ---
    let track = null;
    let feed = null;

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    if (trackId) {
      track = await prisma.track.findUnique({
        where: { id: trackId },
        include: { Feed: true },
      });

      if (!track) {
        return NextResponse.json(
          { success: false, error: 'Track not found' },
          { status: 404 }
        );
      }
    }

    if (!track && feedId) {
      feed = await prisma.feed.findUnique({ where: { id: feedId } });

      if (!feed) {
        return NextResponse.json(
          { success: false, error: 'Album not found' },
          { status: 404 }
        );
      }
    }

    // --- RELAYS ---
    const relayList =
      user.relays.length > 0 ? user.relays : getDefaultRelays();

    const sanitizedRelays = relayList.filter((r) => r.startsWith('wss://'));

    // --- PUBLISH EVENT ---
    let published = false;
    try {
      const client = new NostrClient(sanitizedRelays);
      await client.connect();
      const results = await client.publish(event, {
        relays: sanitizedRelays,
        waitForRelay: true,
      });
      await client.disconnect();

      published = results.some((r) => r.status === 'fulfilled');
    } catch (err) {
      console.warn('Share publish failed:', err);
    }

    // --- STORE IN DATABASE ---
    const post = await prisma.nostrPost.create({
      data: {
        userId,
        eventId: event.id,
        kind: 1,
        content: event.content,
        trackId: trackId || null,
        feedId: feedId || null,
        nostrPubkey: userPubkeyHex, // NEW
      },
    });

    return NextResponse.json({
      success: true,
      published,
      data: {
        post,
        event: {
          id: event.id,
          content: event.content,
        },
      },
      message: published
        ? 'Shared to Nostr successfully'
        : 'Shared locally, but failed to publish to relays',
    });
  } catch (error) {
    console.error('Share error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to share to Nostr' },
      { status: 500 }
    );
  }
}