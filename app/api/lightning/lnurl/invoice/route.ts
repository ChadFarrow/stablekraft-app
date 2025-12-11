import { NextRequest, NextResponse } from 'next/server';

interface LNURLPayResponse {
  pr: string; // Lightning invoice
  verify?: string; // URL to poll for payment verification
  successAction?: {
    tag: string;
    message?: string;
    url?: string;
    description?: string;
  };
  routes?: any[];
}

/**
 * Server-side proxy for LNURL invoice requests to avoid CORS issues
 * POST /api/lightning/lnurl/invoice
 */
export async function POST(req: NextRequest) {
  try {
    const { callback, amount, comment, payerData } = await req.json();

    if (!callback || !amount) {
      return NextResponse.json(
        { error: 'callback and amount are required' },
        { status: 400 }
      );
    }

    // Build callback URL with parameters
    const callbackUrl = new URL(callback);
    callbackUrl.searchParams.set('amount', amount.toString());

    if (comment) {
      callbackUrl.searchParams.set('comment', comment);
    }

    if (payerData) {
      callbackUrl.searchParams.set('payerdata', JSON.stringify(payerData));
    }

    // Fetch invoice from the callback URL
    // This happens server-side, so CORS doesn't apply
    const response = await fetch(callbackUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StableKraft-Lightning/1.0',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `HTTP ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log the full response for debugging
    console.log('[LNURL Invoice] Response from provider:', JSON.stringify(data, null, 2));

    if (data.status === 'ERROR') {
      return NextResponse.json(
        { error: data.reason || 'Invoice request failed' },
        { status: 400 }
      );
    }

    if (!data.pr) {
      return NextResponse.json(
        { error: 'No payment request in response' },
        { status: 400 }
      );
    }

    // Return the invoice response
    return NextResponse.json(data as LNURLPayResponse);
  } catch (error) {
    console.error('LNURL invoice request error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
