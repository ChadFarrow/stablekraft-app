'use client';

/**
 * fetch() for admin-gated API calls.
 *
 * The admin gate accepts the `sk_admin` cookie that `POST /api/admin/verify`
 * sets after the operator signs in with Nostr (lib/admin-session.ts). The
 * cookie is httpOnly and same-origin, so the browser sends it by itself.
 *
 * This used to attach a bearer ADMIN_SECRET from localStorage and, on a 401,
 * `window.prompt('Admin secret required:')` for it — so an operator signed in
 * with Nostr was still asked for a secret (2026-11-01). It no longer reads,
 * asks for or stores a secret. On a 401 (the cookie expired, or was never set)
 * it asks the admin page to sign in again with Nostr, once, and retries.
 */

let reauthenticate: (() => Promise<boolean>) | null = null;

/**
 * AdminPanel registers its Nostr sign-in here. Returns the unregister function.
 * Pages without it simply get the 401 back.
 */
export function setAdminReauth(fn: () => Promise<boolean>): () => void {
  reauthenticate = fn;
  return () => {
    if (reauthenticate === fn) reauthenticate = null;
  };
}

export async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const doFetch = () => fetch(input, { credentials: 'same-origin', ...init });
  const res = await doFetch();
  if (res.status !== 401 || !reauthenticate) return res;
  const signedIn = await reauthenticate().catch(() => false);
  return signedIn ? doFetch() : res;
}
