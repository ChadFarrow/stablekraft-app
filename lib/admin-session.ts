/**
 * Admin sign-in with Nostr alone.
 *
 * WHY THIS EXISTS: the admin page has always made the operator sign a NIP-98
 * event (kind 27235) — and then sent the server only the npub. The server could
 * not trust a bare npub (it is public), so every admin action also needed the
 * bearer ADMIN_SECRET, which the page asked for in a `window.prompt` and kept in
 * localStorage. An operator who had signed in with Nostr was still asked for a
 * secret (2026-11-01).
 *
 * Now the page sends the SIGNED event to `POST /api/admin/verify`.
 * `checkAdminAuthEvent` proves it: kind 27235, fresh, signed, made for this
 * host and this route, by a key in ADMIN_NPUBS. The route then sets `sk_admin`,
 * an HMAC-signed, httpOnly, SameSite=Strict cookie that names the pubkey, and
 * `authorizeAdmin` accepts it wherever the bearer secret is accepted. The bearer
 * path is unchanged: the GitHub Actions crons still send it.
 *
 * NOT the user session (`sk_session`, lib/auth/session.ts): a NIP-05 login mints
 * one without any key-ownership proof, and it lives 90 days. Admin authority
 * needs a fresh signature and a short life, so it gets its own cookie.
 *
 * Edge-safe on purpose — middleware.ts imports it: Web Crypto only, no Buffer,
 * no node:crypto, and only the pure parts of nostr-tools.
 */
import { verifyEvent } from 'nostr-tools/pure';
import { decode } from 'nostr-tools/nip19';

export const ADMIN_COOKIE_NAME = 'sk_admin';
/** 12 hours. The admin page signs a new event on every visit anyway. */
export const ADMIN_SESSION_MAX_AGE_S = 12 * 60 * 60;
export const ADMIN_VERIFY_PATH = '/api/admin/verify';

const VERSION = 'v1';
const NIP98_KIND = 27235;
/** NIP-98 suggests a 60-second window. Both ways, for a phone's clock skew. */
const MAX_SKEW_S = 60;
const HEX64 = /^[0-9a-f]{64}$/;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Domain-separated: this HMAC can never be mistaken for any other use of the secret. */
function signedMessage(pubkey: string, expS: number): Uint8Array<ArrayBuffer> {
  // Copied into an ArrayBuffer-backed array: Web Crypto's BufferSource type refuses
  // the ArrayBufferLike one TextEncoder is typed to return.
  return new Uint8Array(encoder.encode(`${ADMIN_COOKIE_NAME}.${VERSION}.${pubkey}.${expS}`));
}

/** `v1.<pubkey hex>.<expiry, unix seconds>.<HMAC-SHA256, base64url>` */
export async function signAdminSession(pubkey: string, secret: string, nowMs: number): Promise<string> {
  const expS = Math.floor(nowMs / 1000) + ADMIN_SESSION_MAX_AGE_S;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), signedMessage(pubkey, expS));
  return `${VERSION}.${pubkey}.${expS}.${toBase64Url(sig)}`;
}

/** The pubkey the token was minted for, or null — never throws. */
export async function verifyAdminSession(
  token: string | null | undefined,
  secret: string,
  nowMs: number
): Promise<string | null> {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, pubkey, expText, sigText] = parts;
  if (version !== VERSION || !HEX64.test(pubkey) || !/^\d{1,12}$/.test(expText)) return null;
  const expS = Number(expText);
  if (expS * 1000 <= nowMs) return null;
  const sig = fromBase64Url(sigText);
  if (!sig) return null;
  try {
    // crypto.subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, signedMessage(pubkey, expS));
    return ok ? pubkey : null;
  } catch {
    return null;
  }
}

/** ADMIN_NPUBS — comma-separated npubs or hex keys — as a set of hex pubkeys. Junk is skipped. */
export function adminPubkeys(list: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (list ?? '').split(',')) {
    const value = raw.trim();
    if (!value) continue;
    if (HEX64.test(value.toLowerCase())) {
      out.add(value.toLowerCase());
      continue;
    }
    try {
      const decoded = decode(value);
      if (decoded.type === 'npub' && typeof decoded.data === 'string') out.add(decoded.data);
    } catch {
      // not an npub — skipped, as the old verify route skipped it
    }
  }
  return out;
}

export type AdminEventCheck =
  | { ok: true; pubkey: string }
  | { ok: false; reason: string; forbidden?: boolean };

/**
 * Proves the NIP-98 event the admin page signs. `hosts` are the hosts this
 * server answers as; the `u` tag must name one of them and ADMIN_VERIFY_PATH,
 * which binds the signature to this site and this route — an event signed for
 * another service, or another route here, cannot mint an admin session.
 */
export function checkAdminAuthEvent(
  input: unknown,
  ctx: { host: string | string[]; nowS: number; admins: Set<string> }
): AdminEventCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, reason: 'no event' };
  const raw = input as Record<string, unknown>;
  // A clean copy: nostr-tools caches a verified flag on the event object under a
  // symbol, and only these seven fields are the event.
  const event = {
    id: raw.id,
    pubkey: raw.pubkey,
    created_at: raw.created_at,
    kind: raw.kind,
    tags: raw.tags,
    content: raw.content,
    sig: raw.sig,
  };

  if (event.kind !== NIP98_KIND) return { ok: false, reason: 'not a NIP-98 event' };
  if (typeof event.created_at !== 'number' || Math.abs(ctx.nowS - event.created_at) > MAX_SKEW_S) {
    return { ok: false, reason: 'event is not fresh' };
  }
  if (!Array.isArray(event.tags) || !event.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) {
    return { ok: false, reason: 'malformed tags' };
  }
  const tags = event.tags as string[][];
  const tag = (name: string) => tags.find((t) => t[0] === name)?.[1];

  let url: URL;
  try {
    url = new URL(tag('u') ?? '');
  } catch {
    return { ok: false, reason: 'no valid u tag' };
  }
  const hosts = (Array.isArray(ctx.host) ? ctx.host : [ctx.host]).map((h) => h.toLowerCase()).filter(Boolean);
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !hosts.includes(url.host.toLowerCase()) ||
    url.pathname !== ADMIN_VERIFY_PATH
  ) {
    return { ok: false, reason: 'u tag is not this route' };
  }
  if (tag('method')?.toUpperCase() !== 'POST') return { ok: false, reason: 'method tag is not POST' };

  if (
    typeof event.id !== 'string' ||
    typeof event.pubkey !== 'string' ||
    typeof event.sig !== 'string' ||
    typeof event.content !== 'string'
  ) {
    return { ok: false, reason: 'malformed event' };
  }
  let valid = false;
  try {
    valid = verifyEvent(event as Parameters<typeof verifyEvent>[0]);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad signature' };

  if (!ctx.admins.has(event.pubkey)) return { ok: false, reason: 'not an admin', forbidden: true };
  return { ok: true, pubkey: event.pubkey };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The admin gate: the bearer ADMIN_SECRET (the crons) OR a valid `sk_admin`
 * cookie whose pubkey is in ADMIN_NPUBS NOW — removing an npub ends its
 * sessions at once. A wrong bearer does not shut out a valid cookie: a browser
 * may still send an old secret it stored before this existed.
 *
 * With no ADMIN_SECRET the gate is open, exactly as before (auth-and-security:
 * a deploy must not lock out the crons before the secret is configured).
 */
export async function authorizeAdmin(o: {
  authorization?: string | null;
  adminCookie?: string | null;
  adminSecret: string | undefined;
  admins: Set<string>;
  nowMs: number;
}): Promise<boolean> {
  if (!o.adminSecret) return true;
  const auth = o.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (bearer && safeEqual(bearer, o.adminSecret)) return true;
  const pubkey = await verifyAdminSession(o.adminCookie, o.adminSecret, o.nowMs);
  return !!pubkey && o.admins.has(pubkey);
}
