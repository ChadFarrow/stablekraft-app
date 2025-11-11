import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { npubToPublicKey } from '@/lib/nostr/keys';

/**
 * GET /api/nostr/profile/[pubkey]
 * Get user profile by public key (npub or hex)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;

    // Convert npub to hex if needed
    let publicKeyHex: string;
    try {
      if (pubkey.startsWith('npub')) {
        publicKeyHex = npubToPublicKey(pubkey);
      } else {
        publicKeyHex = pubkey;
      }
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid public key format',
        },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { nostrPubkey: publicKeyHex },
      select: {
        id: true,
        nostrPubkey: true,
        nostrNpub: true,
        displayName: true,
        avatar: true,
        bio: true,
        lightningAddress: true,
        relays: true,
        createdAt: true,
      },
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

    return NextResponse.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get profile',
      },
      { status: 500 }
    );
  }
}

