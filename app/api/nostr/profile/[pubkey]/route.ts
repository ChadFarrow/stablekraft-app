import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * GET /api/nostr/profile/[pubkey]
 * Accepts npub or hex, normalizes to hex, and returns user profile.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pubkey: string }> }
) {
  try {
    const { pubkey } = await params;
    const raw = pubkey;

    // Normalize npub or hex → strict hex
    const hexPubkey = normalizePubkey(raw);
    if (!hexPubkey) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey format' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { nostrPubkey: hexPubkey },
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
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: user,
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to get profile' },
      { status: 500 }
    );
  }
}