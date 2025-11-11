import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyEvent } from 'nostr-tools';
import { Metadata } from 'nostr-tools/kinds';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';

/**
 * POST /api/nostr/profile/update
 * Update user profile - publishes to Nostr relays (kind 0) and caches in database
 * Body: { displayName?: string, avatar?: string, bio?: string, lightningAddress?: string, relays?: string[], signedEvent?: Event }
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
    const { displayName, avatar, bio, lightningAddress, relays, signedEvent } = body;

    // Get current user to merge with existing data
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found',
        },
        { status: 404 }
      );
    }

    // Validate signedEvent if provided (for NIP-07 signing)
    if (signedEvent) {
      // Verify the signed event
      if (!verifyEvent(signedEvent)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid signed event signature',
          },
          { status: 401 }
        );
      }

      // Verify event kind is 0 (metadata)
      if (signedEvent.kind !== Metadata) {
        return NextResponse.json(
          {
            success: false,
            error: 'Signed event must be kind 0 (metadata)',
          },
          { status: 400 }
        );
      }

      if (signedEvent.pubkey !== currentUser.nostrPubkey) {
        return NextResponse.json(
          {
            success: false,
            error: 'Signed event pubkey does not match user',
          },
          { status: 401 }
        );
      }
    }

    // Build metadata object (merge with existing)
    const metadata: any = {
      name: displayName !== undefined ? displayName : currentUser.displayName || '',
      about: bio !== undefined ? bio : currentUser.bio || '',
      picture: avatar !== undefined ? avatar : currentUser.avatar || '',
    };

    if (lightningAddress !== undefined && lightningAddress) {
      metadata.lud16 = lightningAddress;
    }

    // If signedEvent is provided, use it directly (NIP-07 signing)
    let metadataEvent = signedEvent;
    let published = false;

    if (signedEvent) {
      // Use user's relays or default relays
      const relayUrls = relays && relays.length > 0 ? relays : (currentUser.relays.length > 0 ? currentUser.relays : getDefaultRelays());
      const client = new NostrClient(relayUrls);
      await client.connect();
      const publishResults = await client.publish(signedEvent, {
        relays: relayUrls,
        waitForRelay: true,
      });
      await client.disconnect();

      published = publishResults.some(r => r.status === 'fulfilled');
      if (!published) {
        console.warn('⚠️ Failed to publish profile update to any Nostr relay');
      }
    } else {
      // No signed event provided - just update database (client should sign on their end)
      console.warn('⚠️ No signed event provided - profile update will not be published to Nostr');
    }

    // Update database cache AFTER publishing to Nostr
    const updateData: any = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (bio !== undefined) updateData.bio = bio;
    if (lightningAddress !== undefined) updateData.lightningAddress = lightningAddress;
    if (relays !== undefined) updateData.relays = relays;

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        nostrPubkey: user.nostrPubkey,
        nostrNpub: user.nostrNpub,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        lightningAddress: user.lightningAddress,
        relays: user.relays,
      },
      eventId: metadataEvent?.id || null,
      published,
      message: signedEvent ? 'Profile updated and published to Nostr successfully' : 'Profile updated successfully (Nostr publishing requires signed event)',
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update profile',
      },
      { status: 500 }
    );
  }
}

