import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyEvent } from 'nostr-tools';
import { Metadata } from 'nostr-tools/kinds';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * POST /api/nostr/profile/update
 * Update user profile metadata and publish a kind 0 event.
 * Auto-normalizes pubkeys, fixes legacy DB entries, and ensures strict hex-only comparisons.
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
    const {
      displayName,
      avatar,
      bio,
      lightningAddress,
      relays: incomingRelays,
      signedEvent
    } = body;

    // Fetch current user
    let currentUser = await prisma.user.findUnique({ where: { id: userId } });

    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // --- AUTO-NORMALIZE DB PUBKEY IF NEEDED ---
    const normalizedDbKey = normalizePubkey(currentUser.nostrPubkey);
    if (!normalizedDbKey) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey stored for this user' },
        { status: 500 }
      );
    }

    // Fix DB if pubkey was npub or wrong-case hex
    if (normalizedDbKey !== currentUser.nostrPubkey) {
      currentUser = await prisma.user.update({
        where: { id: currentUser.id },
        data: { nostrPubkey: normalizedDbKey },
      });
    }

    const userPubkeyHex = normalizedDbKey;

    // --- VERIFY SIGNED EVENT IF PROVIDED ---
    let metadataEvent = null;
    let published = false;

    if (signedEvent) {
      const eventPubkeyHex = normalizePubkey(signedEvent.pubkey);
      if (!eventPubkeyHex) {
        return NextResponse.json(
          { success: false, error: 'Invalid signed event pubkey' },
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
          { success: false, error: 'Invalid Nostr event signature' },
          { status: 401 }
        );
      }

      if (signedEvent.kind !== Metadata) {
        return NextResponse.json(
          { success: false, error: 'Signed event must be kind 0 (metadata)' },
          { status: 400 }
        );
      }

      metadataEvent = signedEvent;

      // Select relay set
      const relayUrls =
        Array.isArray(incomingRelays) && incomingRelays.length > 0
          ? incomingRelays
          : currentUser.relays?.length > 0
          ? currentUser.relays
          : getDefaultRelays();

      const client = new NostrClient(relayUrls);

      try {
        await client.connect();
        const publishResults = await client.publish(signedEvent, {
          relays: relayUrls,
          waitForRelay: true,
        });
        published = publishResults.some((r) => r.status === 'fulfilled');
      } finally {
        await client.disconnect();
      }
    }

    // --- UPDATE DB AFTER PUBLISHING ---
    const updateData: any = {};

    if (displayName !== undefined) updateData.displayName = displayName;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (bio !== undefined) updateData.bio = bio;
    if (lightningAddress !== undefined) updateData.lightningAddress = lightningAddress;

    if (incomingRelays !== undefined) {
      updateData.relays = Array.isArray(incomingRelays)
        ? incomingRelays.filter((r: string) => typeof r === 'string' && r.startsWith('wss://'))
        : currentUser.relays;
    }

    const updatedUser = await prisma.user.update({
      where: { id: currentUser.id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        nostrPubkey: updatedUser.nostrPubkey,
        nostrNpub: updatedUser.nostrNpub,
        displayName: updatedUser.displayName,
        avatar: updatedUser.avatar,
        bio: updatedUser.bio,
        lightningAddress: updatedUser.lightningAddress,
        relays: updatedUser.relays,
      },
      eventId: metadataEvent?.id || null,
      published,
      message: signedEvent
        ? 'Profile updated and published to Nostr'
        : 'Profile updated (no Nostr publish — missing signed event)',
    });
  } catch (err: any) {
    console.error('Profile update error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Failed to update profile' },
      { status: 500 }
    );
  }
}