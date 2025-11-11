import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';

/**
 * GET /api/nostr/auth/me
 * Get current authenticated user - fetches from Nostr relays first (source of truth)
 */
export async function GET(request: NextRequest) {
  try {
    // Get user ID from request header
    const userId = request.headers.get('x-nostr-user-id');

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not authenticated',
        },
        { status: 401 }
      );
    }

    // Get user from database first to get public key
    let user = await prisma.user.findUnique({
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

    // Fetch user's profile metadata from Nostr relays FIRST (Nostr is source of truth)
    let profileMetadata: any = null;
    try {
      const client = new NostrClient(getDefaultRelays());
      await client.connect();
      profileMetadata = await client.getProfile(user.nostrPubkey);
      await client.disconnect();
    } catch (error) {
      console.warn('Failed to fetch profile from Nostr relays:', error);
      // Continue with database data if Nostr fetch fails
    }

    // Use Nostr profile data if available, otherwise fall back to database
    const displayName = profileMetadata?.name || user.displayName || null;
    const avatar = profileMetadata?.picture || user.avatar || null;
    const bio = profileMetadata?.about || user.bio || null;
    const lightningAddress = profileMetadata?.lud16 || profileMetadata?.lud06 || user.lightningAddress || null;

    // Update database with latest Nostr data if it changed
    if (profileMetadata) {
      const updateData: any = {};
      if (profileMetadata.name !== undefined) updateData.displayName = profileMetadata.name || null;
      if (profileMetadata.picture !== undefined) updateData.avatar = profileMetadata.picture || null;
      if (profileMetadata.about !== undefined) updateData.bio = profileMetadata.about || null;
      if (profileMetadata.lud16 || profileMetadata.lud06) {
        updateData.lightningAddress = profileMetadata.lud16 || profileMetadata.lud06 || null;
      }

      if (Object.keys(updateData).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        nostrPubkey: user.nostrPubkey,
        nostrNpub: user.nostrNpub,
        displayName: displayName || user.displayName,
        avatar: avatar || user.avatar,
        bio: bio || user.bio,
        lightningAddress: lightningAddress || user.lightningAddress,
        relays: user.relays,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get user',
      },
      { status: 500 }
    );
  }
}

