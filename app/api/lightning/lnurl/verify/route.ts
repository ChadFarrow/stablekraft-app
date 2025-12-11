import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { verifyUrl } = await request.json();

    if (!verifyUrl) {
      return NextResponse.json({ error: 'verifyUrl is required' }, { status: 400 });
    }

    // Validate URL
    try {
      new URL(verifyUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid verifyUrl' }, { status: 400 });
    }

    const response = await fetch(verifyUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StableKraft-Lightning/1.0',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ settled: false });
    }

    const data = await response.json();

    return NextResponse.json({
      settled: data.settled === true,
      preimage: data.preimage,
    });
  } catch (error) {
    console.error('LNURL verify error:', error);
    return NextResponse.json({ settled: false });
  }
}
