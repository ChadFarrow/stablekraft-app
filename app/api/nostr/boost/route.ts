import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { verifyEvent } from 'nostr-tools';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * POST /api/nostr/boost
 * Post a boost to Nostr as a kind 1 note.
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
    const { trackId, feedId, amount, message, paymentHash, signedEvent } = body;

    if ((!trackId && !feedId) || !amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Either trackId or feedId is required AND amount must be > 0',
        },
        { status: 400 }
      );
    }

    // Load user
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
        { success: false, error: 'Invalid pubkey stored for user' },
        { status: 500 }
      );
    }

    if (normalizedDbKey !== user.nostrPubkey) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { nostrPubkey: normalizedDbKey },
      });
    }

    const userPubkeyHex = normalizedDbKey;

    // --- VALIDATE SIGNED EVENT ---
    if (!signedEvent) {
      return NextResponse.json(
        {
          success: false,
          error: 'Signed event required (use NIP-07, NIP-46, or NIP-55 signer)',
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
        { success: false, error: 'Invalid event signature' },
        { status: 400 }
      );
    }

    if (signedEvent.kind !== 1) {
      return NextResponse.json(
        { success: false, error: 'Boost event must be a kind 1 note' },
        { status: 400 }
      );
    }

    const noteEvent = signedEvent;

    // --- LOAD TRACK OR FEED (OPTIONAL) ---
    let finalFeedId: string | null = null;

    if (trackId) {
      const track = await prisma.track.findUnique({
        where: { id: trackId },
        include: { Feed: true },
      });
      finalFeedId = track?.feedId ?? null;
    }

    if (!finalFeedId && feedId) {
      finalFeedId = feedId;
    }

    // --- VALIDATE RELAYS ---
    const relayUrls =
      user.relays && user.relays.length > 0
        ? user.relays
        : getDefaultRelays();

    const sanitizedRelays = relayUrls.filter((r) => typeof r === 'string' && r.startsWith('wss://'));

    // --- PUBLISH TO NOSTR ---
    let published = false;
    try {
      const client = new NostrClient(sanitizedRelays);
      await client.connect();

      const results = await client.publish(noteEvent, {
        relays: sanitizedRelays,
        waitForRelay: true,
      });

      await client.disconnect();

      published = results.some((r) => r.status === 'fulfilled');
    } catch (err) {
      console.warn('Boost publish failed:', err);
    }

    // --- STORE NOSTR POST ---
    const nostrPost = await prisma.nostrPost.create({
      data: {
        userId,
        eventId: noteEvent.id,
        kind: 1,
        content: noteEvent.content,
        trackId: trackId || null,
        feedId: finalFeedId,
        nostrPubkey: userPubkeyHex,
      },
    });

    // --- STORE BOOST EVENT ---
    const boostEvent = await prisma.boostEvent.create({
      data: {
        userId,
        trackId: trackId ?? '',
        eventId: noteEvent.id,
        amount,
        message: message ?? null,
        paymentHash: paymentHash ?? null,
        relayUrls: sanitizedRelays,
        nostrPubkey: userPubkeyHex,
      },
    });

    return NextResponse.json({
      success: true,
      published,
      data: {
        nostrPost,
        boostEvent,
        event: {
          id: noteEvent.id,
          content: noteEvent.content,
        },
      },
      eventId: noteEvent.id,
      message: published
        ? 'Boost posted to Nostr successfully'
        : 'Boost saved locally but failed to publish to relays',
    });
  } catch (err) {
    console.error('Boost error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to post boost to Nostr' },
      { status: 500 }
    );
  }
}