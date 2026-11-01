import { NextRequest, NextResponse } from 'next/server';
import { nip19 } from 'nostr-tools';
import { RateLimiter, clientIp, rateLimitHeaders } from '@/lib/rate-limit';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_S,
  adminPubkeys,
  checkAdminAuthEvent,
  signAdminSession,
} from '@/lib/admin-session';

/**
 * Admin sign-in with Nostr — see lib/admin-session.ts.
 *
 * This route is deliberately OUTSIDE the admin gate (lib/admin-route-policy.ts):
 * it is how an operator gets through it. It used to take a bare npub and answer
 * 200 or 403, which proved nothing and made it an oracle for walking a list of
 * npubs. It now takes the SIGNED NIP-98 event the admin page asks for, and only
 * a valid signature from an ADMIN_NPUBS key gets a 200 — and the `sk_admin`
 * cookie every admin action then accepts in place of the bearer secret.
 */
const verifyLimiter = new RateLimiter(20, 60_000);

/** Event ids already used, until their 60-second window has passed: one signature, one session. */
const usedEventIds = new Map<string, number>();
const REPLAY_WINDOW_MS = 2 * 60_000;

function rememberEvent(id: string, nowMs: number): boolean {
  for (const [seen, until] of usedEventIds) if (until <= nowMs) usedEventIds.delete(seen);
  if (usedEventIds.has(id)) return false;
  usedEventIds.set(id, nowMs + REPLAY_WINDOW_MS);
  return true;
}

/**
 * The hosts this server answers as. The Host header is what the proxy routed
 * on, so a client cannot set it to another site and still reach us.
 * X-Forwarded-Host is NOT used: a client sets it freely, and accepting it would
 * let an event signed for another site through. NEXT_PUBLIC_BASE_URL — with
 * the same https://stablekraft.app default the rest of the app uses — covers a
 * proxy that rewrites Host.
 */
function ownHosts(request: NextRequest): string[] {
  const hosts = [request.headers.get('host') || ''];
  try {
    hosts.push(new URL(process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app').host);
  } catch {
    // malformed — the Host header alone
  }
  return hosts.filter(Boolean);
}

/**
 * POST /api/admin/verify  { event: <signed kind 27235 event> }
 * 200 + `sk_admin` cookie for an admin, 401 for a bad event, 403 for a valid
 * signature from a key that is not an admin.
 */
export async function POST(request: NextRequest) {
  try {
    const limit = verifyLimiter.check(clientIp(request.headers));
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { status: 429, headers: rateLimitHeaders(limit) }
      );
    }

    const admins = adminPubkeys(process.env.ADMIN_NPUBS);
    if (admins.size === 0) {
      return NextResponse.json({ success: false, error: 'No admin npubs configured' }, { status: 500 });
    }

    let body: { event?: unknown } | null = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const nowMs = Date.now();
    const result = checkAdminAuthEvent(body?.event, {
      host: ownHosts(request),
      nowS: Math.floor(nowMs / 1000),
      admins,
    });
    if (!result.ok) {
      return result.forbidden
        ? NextResponse.json({ success: false, error: 'Not authorized for admin access' }, { status: 403 })
        : NextResponse.json({ success: false, error: `Sign-in failed: ${result.reason}` }, { status: 401 });
    }
    if (!rememberEvent(String((body!.event as { id: string }).id), nowMs)) {
      return NextResponse.json({ success: false, error: 'Sign-in failed: event already used' }, { status: 401 });
    }

    const response = NextResponse.json({
      success: true,
      authorized: true,
      npub: nip19.npubEncode(result.pubkey),
      pubkey: result.pubkey,
    });
    const secret = process.env.ADMIN_SECRET;
    // No secret means the gate is open (fail-open), so there is nothing to sign with or to pass.
    if (secret) {
      response.cookies.set(ADMIN_COOKIE_NAME, await signAdminSession(result.pubkey, secret, nowMs), {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: ADMIN_SESSION_MAX_AGE_S,
      });
    }
    return response;
  } catch (error) {
    console.error('Admin verification error:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify admin access' }, { status: 500 });
  }
}

/** DELETE /api/admin/verify — sign out of admin: clears the cookie. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return response;
}
