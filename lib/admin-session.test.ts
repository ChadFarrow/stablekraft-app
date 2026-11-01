import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import {
  signAdminSession,
  verifyAdminSession,
  adminPubkeys,
  checkAdminAuthEvent,
  authorizeAdmin,
  ADMIN_SESSION_MAX_AGE_S,
} from './admin-session';

const SECRET = 'test-admin-secret-0123456789abcdef';
const NOW = Date.parse('2026-11-01T12:00:00Z');
const sk = generateSecretKey();
const pk = getPublicKey(sk);
const npub = nip19.npubEncode(pk);
const otherSk = generateSecretKey();
const otherPk = getPublicKey(otherSk);

// ---------- the admin cookie ----------

test('a signed admin session verifies to its pubkey', async () => {
  const token = await signAdminSession(pk, SECRET, NOW);
  assert.equal(await verifyAdminSession(token, SECRET, NOW), pk);
  assert.equal(await verifyAdminSession(token, SECRET, NOW + (ADMIN_SESSION_MAX_AGE_S - 1) * 1000), pk);
});

test('an admin session expires', async () => {
  const token = await signAdminSession(pk, SECRET, NOW);
  assert.equal(await verifyAdminSession(token, SECRET, NOW + ADMIN_SESSION_MAX_AGE_S * 1000 + 1000), null);
});

test('an admin session signed with another secret is refused', async () => {
  const token = await signAdminSession(pk, 'some-other-secret', NOW);
  assert.equal(await verifyAdminSession(token, SECRET, NOW), null);
});

test('a tampered admin session is refused: pubkey, expiry, signature', async () => {
  const token = await signAdminSession(pk, SECRET, NOW);
  const [v, p, exp, sig] = token.split('.');
  assert.equal(await verifyAdminSession([v, otherPk, exp, sig].join('.'), SECRET, NOW), null, 'swapped pubkey');
  assert.equal(await verifyAdminSession([v, p, String(Number(exp) + 86400), sig].join('.'), SECRET, NOW), null, 'extended expiry');
  assert.equal(await verifyAdminSession([v, p, exp, sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA')].join('.'), SECRET, NOW), null, 'altered signature');
});

test('garbage is refused, never thrown', async () => {
  for (const t of [undefined, null, '', 'x', 'v1.a.b', 'v2.' + pk + '.1.abc', 'v1..1.abc', 'v1.' + pk + '.notanumber.abc']) {
    assert.equal(await verifyAdminSession(t as any, SECRET, NOW), null, String(t));
  }
});

// ---------- ADMIN_NPUBS ----------

test('ADMIN_NPUBS takes npubs or hex keys, comma-separated, and skips junk', () => {
  const set = adminPubkeys(` ${npub} , ${otherPk.toUpperCase()}, not-a-key, ,npub1invalid`);
  assert.deepEqual([...set].sort(), [pk, otherPk].sort());
  assert.equal(adminPubkeys(undefined).size, 0);
  assert.equal(adminPubkeys('').size, 0);
});

// ---------- the NIP-98 event the admin page signs ----------

const HOST = 'stablekraft.app';
const URL_ = `https://${HOST}/api/admin/verify`;
const nowS = Math.floor(NOW / 1000);
function authEvent(over: { kind?: number; created_at?: number; tags?: string[][]; key?: Uint8Array } = {}) {
  return finalizeEvent(
    {
      kind: over.kind ?? 27235,
      created_at: over.created_at ?? nowS,
      tags: over.tags ?? [['u', URL_], ['method', 'POST']],
      content: '',
    },
    over.key ?? sk
  );
}
const admins = new Set([pk]);
const check = (event: unknown) => checkAdminAuthEvent(event, { host: HOST, nowS, admins });

test('a fresh, signed NIP-98 event from an admin for this URL passes', () => {
  assert.deepEqual(check(authEvent()), { ok: true, pubkey: pk });
});

test('the wrong kind is refused', () => {
  assert.equal(check(authEvent({ kind: 1 })).ok, false);
});

test('an event older or newer than 60 s is refused', () => {
  assert.equal(check(authEvent({ created_at: nowS - 61 })).ok, false);
  assert.equal(check(authEvent({ created_at: nowS + 61 })).ok, false);
  assert.equal(check(authEvent({ created_at: nowS - 59 })).ok, true);
});

// The u tag binds the signature to this site and this route: a NIP-98 event
// signed for another service, or for another route here, must not mint a session.
test('an event signed for another host or another path is refused', () => {
  assert.equal(check(authEvent({ tags: [['u', 'https://evil.example/api/admin/verify'], ['method', 'POST']] })).ok, false);
  assert.equal(check(authEvent({ tags: [['u', `https://${HOST}.evil.example/api/admin/verify`], ['method', 'POST']] })).ok, false);
  assert.equal(check(authEvent({ tags: [['u', `https://${HOST}/api/feeds`], ['method', 'POST']] })).ok, false);
  assert.equal(check(authEvent({ tags: [['method', 'POST']] })).ok, false, 'no u tag');
  assert.equal(check(authEvent({ tags: [['u', 'not a url'], ['method', 'POST']] })).ok, false);
});

test('the wrong method is refused', () => {
  assert.equal(check(authEvent({ tags: [['u', URL_], ['method', 'GET']] })).ok, false);
  assert.equal(check(authEvent({ tags: [['u', URL_]] })).ok, false, 'no method tag');
});

test('a bad signature is refused', () => {
  const e = authEvent();
  assert.equal(check({ ...e, sig: e.sig.replace(/^./, e.sig[0] === 'a' ? 'b' : 'a') }).ok, false);
  assert.equal(check({ ...e, pubkey: otherPk }).ok, false, 'pubkey swapped after signing');
});

test('a valid event from a key that is not an admin is refused as forbidden', () => {
  const r = check(authEvent({ key: otherSk }));
  assert.equal(r.ok, false);
  assert.equal((r as any).forbidden, true);
});

test('a non-object is refused, never thrown', () => {
  for (const e of [undefined, null, 'x', 42, [], {}]) assert.equal(check(e).ok, false);
});

// ---------- the gate ----------

const env = { adminSecret: SECRET, admins, nowMs: NOW };

test('the gate opens for the bearer secret, as the crons send it', async () => {
  assert.equal(await authorizeAdmin({ ...env, authorization: `Bearer ${SECRET}` }), true);
});

test('the gate opens for a valid admin cookie and no secret', async () => {
  const cookie = await signAdminSession(pk, SECRET, NOW);
  assert.equal(await authorizeAdmin({ ...env, adminCookie: cookie }), true);
});

// A browser that still holds an old secret in localStorage sends it alongside
// the cookie; the wrong bearer must not override a valid cookie.
test('a wrong bearer does not shut out a valid cookie', async () => {
  const cookie = await signAdminSession(pk, SECRET, NOW);
  assert.equal(await authorizeAdmin({ ...env, authorization: 'Bearer stale', adminCookie: cookie }), true);
});

test('the gate stays shut with neither, a wrong secret, or an expired cookie', async () => {
  assert.equal(await authorizeAdmin({ ...env }), false);
  assert.equal(await authorizeAdmin({ ...env, authorization: 'Bearer wrong' }), false);
  assert.equal(await authorizeAdmin({ ...env, authorization: SECRET }), false, 'no Bearer prefix');
  const old = await signAdminSession(pk, SECRET, NOW - (ADMIN_SESSION_MAX_AGE_S + 60) * 1000);
  assert.equal(await authorizeAdmin({ ...env, adminCookie: old }), false);
});

// Removing an npub from ADMIN_NPUBS must end its sessions at once, not when
// the cookie expires.
test('a cookie for a pubkey no longer in ADMIN_NPUBS is refused', async () => {
  const cookie = await signAdminSession(pk, SECRET, NOW);
  assert.equal(await authorizeAdmin({ ...env, admins: new Set([otherPk]), adminCookie: cookie }), false);
});

// Unchanged from before: with ADMIN_SECRET unset the gate is open, so a deploy
// cannot lock out the crons before the secret exists (auth-and-security skill).
test('with no ADMIN_SECRET the gate stays fail-open', async () => {
  assert.equal(await authorizeAdmin({ adminSecret: undefined, admins, nowMs: NOW }), true);
});

// ---------- wiring, by source scan ----------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

// checkAdminAuth became async. A caller without `await` compares a Promise,
// which is never null, so the admin is silently never authorized — and
// `tsc` does not always say so.
test('every checkAdminAuth call is awaited', () => {
  const files = [...sourceFiles(join(process.cwd(), 'app')), join(process.cwd(), 'middleware.ts')];
  const callers = files.filter((f) => /checkAdminAuth\(/.test(readFileSync(f, 'utf8')));
  assert.ok(callers.length >= 2, `found ${callers.length} callers — the scan lost its anchor`);
  for (const f of callers) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (/checkAdminAuth\(/.test(line) && !/^\s*(\*|\/\/)/.test(line) && !/export async function checkAdminAuth/.test(line)) {
        assert.match(line, /await checkAdminAuth\(/, `${f}: ${line.trim()}`);
      }
    }
  }
});

test('adminFetch never asks for or stores the admin secret', () => {
  const source = readFileSync(join(process.cwd(), 'lib/admin-fetch.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /window\.prompt|localStorage|Authorization/);
});

test('the admin page sends the signed event, bound to the verify route, not a bare npub', () => {
  const source = readFileSync(join(process.cwd(), 'components/AdminPanel.tsx'), 'utf8');
  assert.match(source, /body: JSON\.stringify\(\{ event: signedEvent \}\)/);
  assert.match(source, /\['u', `\$\{window\.location\.origin\}\/api\/admin\/verify`\], \['method', 'POST'\]/);
  assert.doesNotMatch(source, /JSON\.stringify\(\{ npub, pubkey \}\)/);
});
