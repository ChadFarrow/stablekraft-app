import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/nostr/relays
 * Get user's relay list
 */
export async function GET(request: NextRequest) {
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { relays: true },
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
      data: user.relays,
    });
  } catch (error) {
    console.error('Get relays error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get relays',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/nostr/relays
 * Update user's relay list
 * Body: { relays: string[] }
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
    const { relays } = body;

    if (!Array.isArray(relays)) {
      return NextResponse.json(
        {
          success: false,
          error: 'relays must be an array',
        },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { relays },
    });

    return NextResponse.json({
      success: true,
      data: user.relays,
      message: 'Relays updated successfully',
    });
  } catch (error) {
    console.error('Update relays error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update relays',
      },
      { status: 500 }
    );
  }
}

