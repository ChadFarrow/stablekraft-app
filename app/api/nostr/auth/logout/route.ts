import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/nostr/auth/logout
 * Clear Nostr authentication session
 */
export async function POST(request: NextRequest) {
  try {
    // In production, clear server-side session/cookie
    // For now, the client will handle clearing localStorage

    return NextResponse.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Logout failed',
      },
      { status: 500 }
    );
  }
}

