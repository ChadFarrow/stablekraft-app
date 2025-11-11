import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import type { Event } from 'nostr-tools';

/**
 * POST /api/nostr/boost
 * Post a boost to Nostr as a kind 1 note
 * Body: { trackId: string, amount: number, message?: string, paymentHash?: string, signedEvent: Event }
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { trackId, amount, message, paymentHash, signedEvent } = body;

    if (!trackId || !amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'trackId and amount are required',
        },
        { status: 400 }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found',
        },
        { status: 404 }
      );
    }

    // Get track
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      include: { Feed: true },
    });

    if (!track) {
      return NextResponse.json(
        {
          success: false,
          error: 'Track not found',
        },
        { status: 404 }
      );
    }

    // Use user's relays or default relays
    const relays = user.relays.length > 0 ? user.relays : getDefaultRelays();

    // Use signed note from client (extension-based only)
    if (!signedEvent) {
      return NextResponse.json(
        {
          success: false,
          error: 'Signed event is required (NIP-07 extension)',
        },
        { status: 400 }
      );
    }
    
    // Verify the event is signed by the user
    const { verifyEvent } = await import('nostr-tools');
    if (!verifyEvent(signedEvent)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid signed event',
        },
        { status: 400 }
      );
    }
    
    // Verify the event is signed by the user
    if (signedEvent.pubkey !== user.nostrPubkey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Signed event does not match user public key',
        },
        { status: 400 }
      );
    }
    
    // Verify it's a kind 1 note
    if (signedEvent.kind !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Event must be a kind 1 note',
        },
        { status: 400 }
      );
    }
    
    const noteEvent = signedEvent;

    // Publish to Nostr
    const client = new NostrClient(relays);
    await client.connect();
    const results = await client.publish(noteEvent, {
      relays,
      waitForRelay: true,
    });
    await client.disconnect();

    // Store in database as NostrPost (kind 1 note)
    const nostrPost = await prisma.nostrPost.create({
      data: {
        userId,
        eventId: noteEvent.id,
        kind: 1,
        content: noteEvent.content,
        trackId: trackId || null,
        feedId: track.feedId || null,
      },
    });

    // Also store in BoostEvent for backwards compatibility and tracking
    const boostEvent = await prisma.boostEvent.create({
      data: {
        userId,
        trackId,
        eventId: noteEvent.id,
        amount,
        message: message || null,
        paymentHash: paymentHash || null,
        relayUrls: relays,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        boostEvent,
        nostrPost,
        event: {
          id: noteEvent.id,
          content: noteEvent.content,
        },
        published: results.some(r => r.status === 'fulfilled'),
      },
      eventId: noteEvent.id,
      message: 'Boost posted to Nostr successfully',
    });
  } catch (error) {
    console.error('Post boost to Nostr error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to post boost to Nostr',
      },
      { status: 500 }
    );
  }
}

