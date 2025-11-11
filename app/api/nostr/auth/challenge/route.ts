import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

/**
 * POST /api/nostr/auth/challenge
 * Generate a challenge for Nostr authentication
 */
export async function POST(request: NextRequest) {
  try {
    // Generate a random challenge string
    const challenge = randomBytes(32).toString('hex');

    // Store challenge in session/cookie (in production, use secure session storage)
    // For now, we'll return it and the client will sign it
    // In production, store it server-side and verify it matches

    return NextResponse.json({
      success: true,
      challenge,
      message: 'Challenge generated',
    });
  } catch (error) {
    console.error('Challenge generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate challenge',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}

