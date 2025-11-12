import { NextRequest, NextResponse } from 'next/server';
import { npubToPublicKey } from '@/lib/nostr/keys';

/**
 * POST /api/admin/verify
 * Verify if a Nostr user (by npub or pubkey) is whitelisted for admin access
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { npub, pubkey } = body;

    if (!npub && !pubkey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing npub or pubkey',
        },
        { status: 400 }
      );
    }

    // Get whitelisted npubs from environment variable
    const adminNpubs = process.env.ADMIN_NPUBS?.split(',').map(n => n.trim()).filter(Boolean) || [];
    
    if (adminNpubs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No admin npubs configured',
        },
        { status: 500 }
      );
    }

    // Normalize npub (remove whitespace, convert to lowercase for comparison)
    let normalizedNpub: string | null = null;
    let normalizedPubkey: string | null = null;

    if (npub) {
      normalizedNpub = npub.trim();
      // Convert npub to pubkey for comparison
      try {
        normalizedPubkey = npubToPublicKey(normalizedNpub);
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid npub format',
          },
          { status: 400 }
        );
      }
    } else if (pubkey) {
      normalizedPubkey = pubkey.trim();
      // Convert pubkey to npub for comparison
      try {
        const { publicKeyToNpub } = await import('@/lib/nostr/keys');
        normalizedNpub = publicKeyToNpub(normalizedPubkey);
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid pubkey format',
          },
          { status: 400 }
        );
      }
    }

    // Check if npub is in whitelist
    const isWhitelisted = adminNpubs.some(whitelistedNpub => {
      const trimmed = whitelistedNpub.trim();
      // Compare both npub and pubkey formats
      if (trimmed === normalizedNpub) return true;
      
      // Also check if whitelisted npub converts to the same pubkey
      try {
        const whitelistedPubkey = npubToPublicKey(trimmed);
        return whitelistedPubkey === normalizedPubkey;
      } catch {
        // If whitelisted entry is not a valid npub, skip it
        return false;
      }
    });

    if (!isWhitelisted) {
      return NextResponse.json(
        {
          success: false,
          error: 'Not authorized for admin access',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      authorized: true,
      npub: normalizedNpub,
      pubkey: normalizedPubkey,
    });
  } catch (error) {
    console.error('Admin verification error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to verify admin access',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}

