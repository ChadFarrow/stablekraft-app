import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createZapRequest, createZapReceipt } from '@/lib/nostr/events';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';

/**
 * POST /api/nostr/boost
 * Post a boost to Nostr as a zap (kind 9735)
 * Body: { trackId: string, amount: number, message?: string, paymentHash?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    const privateKey = request.headers.get('x-nostr-private-key');

    if (!userId || !privateKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'User ID and private key required',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trackId, amount, message, paymentHash } = body;

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

    // Get recipient pubkey if available (from track artist or feed)
    // For now, we'll create a zap request without a specific recipient
    // In production, you might want to look up the artist's Nostr pubkey
    // If the track has a v4vRecipient that's a Nostr pubkey, use it
    let recipientPubkey = '';
    if (track.v4vRecipient && track.v4vRecipient.length === 64) {
      // Check if it's a hex pubkey
      recipientPubkey = track.v4vRecipient;
    }

    // Use user's relays or default relays
    const relays = user.relays.length > 0 ? user.relays : getDefaultRelays();

    // Create zap request (kind 9735)
    // Note: For a proper zap, we'd need the LN invoice, but we can create a zap request without it
    // The zap receipt (kind 9736) would require the invoice
    const zapRequest = createZapRequest(
      recipientPubkey || user.nostrPubkey, // recipientPubkey - use track's pubkey if available, otherwise self
      amount * 1000, // amount in millisats
      '', // invoice - empty for now (would be included in zap receipt)
      privateKey,
      relays,
      message || `⚡ Boosted ${amount} sats to ${track.title}${track.artist ? ` by ${track.artist}` : ''}`
    );

    // Publish to Nostr
    const client = new NostrClient(relays);
    await client.connect();
    const results = await client.publish(zapRequest, {
      relays,
      waitForRelay: true,
    });
    await client.disconnect();

    // Store in database
    const boostEvent = await prisma.boostEvent.create({
      data: {
        userId,
        trackId,
        eventId: zapRequest.id,
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
        event: {
          id: zapRequest.id,
          content: zapRequest.content,
        },
        published: results.some(r => r.status === 'fulfilled'),
      },
      eventId: zapRequest.id,
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

