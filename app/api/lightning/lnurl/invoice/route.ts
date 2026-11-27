import { NextRequest, NextResponse } from 'next/server';
import { safeFetch, readCappedText, MAX_JSON_BYTES } from '@/lib/safe-fetch';
import { USER_AGENT } from '@/lib/user-agent';

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

    // Build callback URL with parameters.
    // `new URL(callback)` only proves the string parses. The caller also
    // controls the query params appended below, so before the safeFetch call
    // this was a parameterised request forgery: any internal host, any port,
    // with the response handed straight back.
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(callback);
    } catch {
      return NextResponse.json({ error: 'Invalid callback URL' }, { status: 400 });
    }
    callbackUrl.searchParams.set('amount', amount.toString());

    if (comment) {
      callbackUrl.searchParams.set('comment', comment);
    }

    if (payerData) {
      callbackUrl.searchParams.set('payerdata', JSON.stringify(payerData));
    }

    // Fetch invoice from the callback URL
    // This happens server-side, so CORS doesn't apply
    const result = await safeFetch(callbackUrl.toString(), {
      timeoutMs: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!result.ok) {
      console.warn(`⚠️ LNURL invoice callback refused: ${result.error}`);
      return NextResponse.json({ error: 'Invoice request failed' }, { status: 400 });
    }

    const response = result.response;

    if (!response.ok) {
      return NextResponse.json(
        { error: `Invoice request failed (HTTP ${response.status})` },
        { status: response.status }
      );
    }

    const body = await readCappedText(response, MAX_JSON_BYTES);
    if (!body.ok) {
      return NextResponse.json({ error: 'Invoice response too large' }, { status: 502 });
    }

    let data: LNURLPayResponse & { status?: string; reason?: string };
    try {
      data = JSON.parse(body.value);
    } catch {
      return NextResponse.json({ error: 'Invalid invoice response' }, { status: 502 });
    }

    // Not the full body: it carries the bolt11 invoice and payer metadata, and
    // this line put all of it into the Railway logs on every boost.
    console.warn(`[LNURL Invoice] provider responded, pr present: ${Boolean(data.pr)}`);

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
      { error: 'Invoice request failed' },
      { status: 500 }
    );
  }
}
