import { NextRequest, NextResponse } from 'next/server';
import { bech32 } from 'bech32';
import { safeFetch, readCappedText, MAX_JSON_BYTES } from '@/lib/safe-fetch';
import { USER_AGENT } from '@/lib/user-agent';

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
      // Validate Lightning Address format.
      // The old regex was `^[^\s@]+@[^\s@]+\.[^\s@]+$`, which accepts
      // `x@127.0.0.1` — a dot is not a domain. safeFetch below is the real
      // stop, but keep the shape check honest too.
      const addressRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
      if (!addressRegex.test(address)) {
        return NextResponse.json(
          { error: 'Invalid Lightning Address format' },
          { status: 400 }
        );
      }

      // Convert Lightning Address to URL
      const [username, domain] = address.split('@');
      url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(username)}`;
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

    // Fetch LNURL-pay parameters from the remote server.
    // safeFetch, not fetch: a bech32 `lnurl` decodes to an ARBITRARY url of any
    // scheme and any host, and the whole JSON body was returned to the caller.
    const result = await safeFetch(url, {
      timeoutMs: 15000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!result.ok) {
      console.warn(`⚠️ LNURL resolve refused: ${result.error}`);
      return NextResponse.json({ error: 'LNURL-pay request failed' }, { status: 400 });
    }

    const response = result.response;

    if (!response.ok) {
      return NextResponse.json(
        { error: `LNURL-pay request failed (HTTP ${response.status})` },
        { status: response.status }
      );
    }

    const body = await readCappedText(response, MAX_JSON_BYTES);
    if (!body.ok) {
      return NextResponse.json({ error: 'LNURL-pay response too large' }, { status: 502 });
    }

    let data: LNURLPayParams & { status?: string; reason?: string };
    try {
      data = JSON.parse(body.value);
    } catch {
      return NextResponse.json({ error: 'Invalid LNURL-pay response' }, { status: 502 });
    }

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
      { error: 'LNURL resolution failed' },
      { status: 500 }
    );
  }
}
