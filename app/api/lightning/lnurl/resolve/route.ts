import { NextRequest, NextResponse } from 'next/server';
import { bech32 } from 'bech32';

interface LNURLPayParams {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  tag: string;
  commentAllowed?: number;
  payerData?: {
    name?: { mandatory: boolean };
    pubkey?: { mandatory: boolean };
    identifier?: { mandatory: boolean };
    email?: { mandatory: boolean };
    auth?: { mandatory: boolean; k1: string };
  };
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

/**
 * Server-side proxy for LNURL resolution to avoid CORS issues
 * POST /api/lightning/lnurl/resolve
 */
export async function POST(req: NextRequest) {
  try {
    const { address, lnurl } = await req.json();

    if (!address && !lnurl) {
      return NextResponse.json(
        { error: 'Either address or lnurl is required' },
        { status: 400 }
      );
    }

    let url: string;

    if (address) {
      // Validate Lightning Address format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(address)) {
        return NextResponse.json(
          { error: 'Invalid Lightning Address format' },
          { status: 400 }
        );
      }

      // Convert Lightning Address to URL
      const [username, domain] = address.split('@');
      url = `https://${domain}/.well-known/lnurlp/${username}`;
    } else {
      // Decode LNURL to URL
      try {
        const decoded = bech32.decode(lnurl, 2000);
        if (decoded.prefix !== 'lnurl') {
          return NextResponse.json(
            { error: 'Invalid LNURL format: wrong prefix' },
            { status: 400 }
          );
        }
        const words = bech32.fromWords(decoded.words);
        url = Buffer.from(words).toString('utf8');
      } catch (error) {
        return NextResponse.json(
          { error: 'Invalid LNURL format' },
          { status: 400 }
        );
      }
    }

    // Fetch LNURL-pay parameters from the remote server
    // This happens server-side, so CORS doesn't apply
    const response = await fetch(url, {
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

    if (data.status === 'ERROR') {
      return NextResponse.json(
        { error: data.reason || 'LNURL-pay request failed' },
        { status: 400 }
      );
    }

    if (data.tag !== 'payRequest') {
      return NextResponse.json(
        { error: 'Invalid LNURL-pay response: wrong tag' },
        { status: 400 }
      );
    }

    // Return the LNURL-pay parameters
    return NextResponse.json(data as LNURLPayParams);
  } catch (error) {
    console.error('LNURL resolution error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
