import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import type { Event } from 'nostr-tools';

/**
 * POST /api/nostr/boost
 * Post a boost to Nostr as a kind 1 note
 * Body: { trackId?: string, feedId?: string, amount: number, message?: string, paymentHash?: string, signedEvent: Event }
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
    const { trackId, feedId, amount, message, paymentHash, signedEvent } = body;

    // Require either trackId or feedId, and amount
    if ((!trackId && !feedId) || !amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either trackId or feedId, and amount are required',
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

    // Get track or feed (optional - tracks/feeds may not be in database if loaded from RSS)
    let track: any = null;
    let feed: any = null;
    let finalFeedId: string | null = null;

    if (trackId) {
      track = await prisma.track.findUnique({
        where: { id: trackId },
        include: { Feed: true },
      });

      // Track not in database is okay - it might be from an RSS feed
      if (track) {
        finalFeedId = track.feedId;
      } else {
        console.log(`ℹ️ Track ${trackId} not in database (RSS feed track) - proceeding anyway`);
      }
    }

    if (feedId) {
      feed = await prisma.feed.findUnique({
        where: { id: feedId },
      });

      // Feed not in database is okay - it might be from an RSS feed
      if (feed) {
        finalFeedId = feedId;
      } else {
        console.log(`ℹ️ Feed ${feedId} not in database (RSS feed) - proceeding anyway`);
        // Use feedId even if not in database
        finalFeedId = feedId;
      }
    }

    // Use user's relays or default relays
    const relays = user.relays.length > 0 ? user.relays : getDefaultRelays();

    // Use signed note from client (signed by user's signer: NIP-07, NIP-46, or NIP-55)
    if (!signedEvent) {
      return NextResponse.json(
        {
          success: false,
          error: 'Signed event is required. Please ensure you have a signer connected (NIP-07 extension, NIP-46, or NIP-55).',
        },
        { status: 400 }
      );
    }
    
    // Verify the event structure and signature
    const { verifyEvent } = await import('nostr-tools');
    if (!verifyEvent(signedEvent)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid signed event - signature verification failed',
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
        feedId: finalFeedId || null,
      },
    });

    // Also store in BoostEvent for backwards compatibility and tracking
    // Note: BoostEvent requires trackId, so we'll use a placeholder or skip if it's an album boost
    let boostEvent = null;
    if (trackId) {
      boostEvent = await prisma.boostEvent.create({
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
    }

    return NextResponse.json({
      success: true,
      data: {
        boostEvent: boostEvent || null,
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

