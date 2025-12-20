import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizePubkey } from '@/lib/nostr/normalize';

/**
 * Validate and sanitize relay URLs.
 * Accept only proper wss:// websocket endpoints.
 */
function sanitizeRelays(relays: string[]): string[] {
  if (!Array.isArray(relays)) return [];

  const cleaned = new Set<string>();

  for (let r of relays) {
    if (typeof r !== 'string') continue;

    r = r.trim();

    if (!r.startsWith('wss://')) continue;

    try {
      const url = new URL(r);

      if (
        url.hostname.includes('localhost') ||
        url.hostname.includes('127.0.0.1') ||
        url.hostname.endsWith('.local')
      ) {
        continue;
      }

      cleaned.add(url.toString());
    } catch {
      continue;
    }
  }

  return [...cleaned];
}

/**
 * GET /api/nostr/relays
 * Get the user's relay list, ensuring DB pubkey normalization consistency.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID required' },
        { status: 401 }
      );
    }

    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { nostrPubkey: true, relays: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const hex = normalizePubkey(user.nostrPubkey);
    if (!hex) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey stored for user' },
        { status: 500 }
      );
    }

    if (hex !== user.nostrPubkey) {
      await prisma.user.update({
        where: { id: userId },
        data: { nostrPubkey: hex },
      });
    }

    const safeRelays = sanitizeRelays(user.relays);

    return NextResponse.json({
      success: true,
      data: safeRelays,
    });
  } catch (error) {
    console.error('Get relays error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get relays' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/nostr/relays
 * Update user's relay list with full sanitization + normalization.
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
    const { relays } = body;

    if (!Array.isArray(relays)) {
      return NextResponse.json(
        { success: false, error: 'relays must be an array of strings' },
        { status: 400 }
      );
    }

    const cleanRelays = sanitizeRelays(relays);

    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { nostrPubkey: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const hex = normalizePubkey(user.nostrPubkey);
    if (!hex) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey stored for user' },
        { status: 500 }
      );
    }

    if (hex !== user.nostrPubkey) {
      user = await prisma.user.update({
        where: { id: userId },
        data: { nostrPubkey: hex },
      });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { relays: cleanRelays },
      select: { relays: true },
    });

    return NextResponse.json({
      success: true,
      data: updated.relays,
      message: 'Relays updated successfully',
    });
  } catch (error) {
    console.error('Update relays error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update relays' },
      { status: 500 }
    );
  }
}