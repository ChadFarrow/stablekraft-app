import { NextRequest, NextResponse } from 'next/server';
import { USER_AGENT } from '@/lib/user-agent';

const BOOSTBOX_URL = process.env.BOOSTBOX_URL || 'https://tardbox.com';
const BOOSTBOX_API_KEY = process.env.BOOSTBOX_API_KEY || 'v4v4me';

/**
 * Server-side proxy for BoostBox API to avoid CORS issues.
 * POST /api/lightning/boostbox
 */
export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const response = await fetch(`${BOOSTBOX_URL}/boost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': BOOSTBOX_API_KEY,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `BoostBox error: ${response.status}`, detail: text },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('BoostBox proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
