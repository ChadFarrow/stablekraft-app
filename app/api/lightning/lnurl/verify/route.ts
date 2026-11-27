import { NextRequest, NextResponse } from 'next/server';
import { safeFetch, readCappedText, MAX_JSON_BYTES } from '@/lib/safe-fetch';
import { USER_AGENT } from '@/lib/user-agent';

export async function POST(request: NextRequest) {
  try {
    const { verifyUrl } = await request.json();

    if (!verifyUrl) {
      return NextResponse.json({ error: 'verifyUrl is required' }, { status: 400 });
    }

    // safeFetch, not fetch. `new URL(verifyUrl)` proved only that the string
    // parsed — it did not stop `http://127.0.0.1:5432/` or a redirect into the
    // private range, which made this a blind internal port scanner.
    const result = await safeFetch(verifyUrl, {
      timeoutMs: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!result.ok) {
      console.warn(`⚠️ LNURL verify refused ${verifyUrl}: ${result.error}`);
      return NextResponse.json({ settled: false });
    }

    const response = result.response;
    if (!response.ok) {
      return NextResponse.json({ settled: false });
    }

    const body = await readCappedText(response, MAX_JSON_BYTES);
    if (!body.ok) {
      console.warn(`⚠️ LNURL verify response too large from ${verifyUrl}`);
      return NextResponse.json({ settled: false });
    }

    let data: { settled?: unknown; preimage?: unknown };
    try {
      data = JSON.parse(body.value);
    } catch {
      return NextResponse.json({ settled: false });
    }

    return NextResponse.json({
      settled: data.settled === true,
      preimage: typeof data.preimage === 'string' ? data.preimage : undefined,
    });
  } catch (error) {
    console.error('LNURL verify error:', error);
    return NextResponse.json({ settled: false });
  }
}
