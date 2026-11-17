import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ADMIN_COOKIE_NAME, adminPubkeys, authorizeAdmin } from '@/lib/admin-session';

let warnedNoSecret = false;

/**
 * Admin check for admin/destructive endpoints, called from middleware.
 * Resolves to null when authorized, or a 401 response.
 *
 * Authorized by EITHER the bearer ADMIN_SECRET (the GitHub Actions crons, curl)
 * OR the `sk_admin` cookie that `POST /api/admin/verify` sets after the
 * operator signs in with Nostr — see lib/admin-session.ts. ASYNC: the cookie is
 * checked with Web Crypto. A caller that forgets `await` compares a Promise and
 * is silently never authorized.
 *
 * FAIL-OPEN by design when ADMIN_SECRET is unset: a deploy must not lock out
 * the nightly crons or the admin panel before the Railway env var and the
 * GitHub Actions secret are configured. Set both to activate enforcement.
 */
export async function checkAdminAuth(request: NextRequest): Promise<NextResponse | null> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    if (!warnedNoSecret) {
      console.warn(
        '⚠️ ADMIN_SECRET is not set — admin endpoints are UNPROTECTED. ' +
          'Set it in Railway (and as a GitHub Actions secret) to enable auth.'
      );
      warnedNoSecret = true;
    }
    return null;
  }

  const authorized = await authorizeAdmin({
    authorization: request.headers.get('authorization'),
    adminCookie: request.cookies.get(ADMIN_COOKIE_NAME)?.value,
    adminSecret: secret,
    admins: adminPubkeys(process.env.ADMIN_NPUBS),
    nowMs: Date.now(),
  });
  if (authorized) return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
