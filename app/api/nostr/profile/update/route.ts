import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createMetadata } from '@/lib/nostr/events';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';

/**
 * POST /api/nostr/profile/update
 * Update user profile - publishes to Nostr relays (kind 0) and caches in database
 * Body: { displayName?: string, avatar?: string, bio?: string, lightningAddress?: string, relays?: string[] }
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
    const { displayName, avatar, bio, lightningAddress, relays } = body;

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

    // Build metadata object (merge with existing)
    const metadata: any = {
      name: displayName !== undefined ? displayName : currentUser.displayName || '',
      about: bio !== undefined ? bio : currentUser.bio || '',
      picture: avatar !== undefined ? avatar : currentUser.avatar || '',
    };

    if (lightningAddress !== undefined && lightningAddress) {
      metadata.lud16 = lightningAddress;
    }

    // Create and publish kind 0 metadata event to Nostr
    const metadataEvent = createMetadata(metadata, privateKey);

    // Use user's relays or default relays
    const relayUrls = relays && relays.length > 0 ? relays : (currentUser.relays.length > 0 ? currentUser.relays : getDefaultRelays());
    const client = new NostrClient(relayUrls);
    await client.connect();
    const publishResults = await client.publish(metadataEvent, {
      relays: relayUrls,
      waitForRelay: true,
    });
    await client.disconnect();

    const published = publishResults.some(r => r.status === 'fulfilled');
    if (!published) {
      console.warn('⚠️ Failed to publish profile update to any Nostr relay');
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
      eventId: metadataEvent.id,
      published,
      message: 'Profile updated and published to Nostr successfully',
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

