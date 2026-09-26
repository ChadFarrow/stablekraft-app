---
name: nostr-signer
description: "Use when working on Nostr login or signing: the NIP-46 remote signer (Amber, Primal, bunker:// and nostrconnect:// URIs), NIP-55, NIP-07 browser extensions, nostr-login, the login modal and its cards, NIP-05 read-only login, a signer that hangs or times out for ~120s, a boost or favorite that never signs, reconnecting a stale signer, an unexpected \"Welcome to Nostr!\" dialog, NIP-44 encryption over a remote signer, the post-login flow and deferred-work flags, or the favorites publish queue and relay management."
---

# nostr-signer

Signing in with Nostr and getting events signed and published. Wallet/Lightning concerns live in `lightning-boost`; favorites data model lives in `favorites`.

## Tests for this subsystem

```
npx tsx --test lib/nostr/nwc-backup.test.ts         # NWC backup pure helpers
node lib/nostr/nwc-backup.browser-probe.mjs         # wallet picker + backup flows (needs `npm run dev`)
```

---

## NIP-46 Remote Signer (Amber / Primal / bunker)
Key files: `lib/nostr/nip46-client.ts`, `lib/nostr/signer.ts`, `components/Nostr/hooks/useNip46Connection.ts`, `lib/nostr/signer-nudge.ts`. iOS Safari kills WebSockets after ~30s backgrounded; reconnects on `visibilitychange`. **Primal is the best iOS signer** — auto-signs with Full trust, <1s response. Debug: `localStorage.setItem('nip46_debug', 'true')`.

Invariants (do not revert):
- **Signer nudge** (`withSignerNudge`): toast after 4s, hard-fail at 125s (outside NIP-46 client's 120s timeout so the client's richer error surfaces first). Throttled 8s. `NIP46Signer.signEvent`/`getPublicKey` route through automatically; direct `client.signEvent` callers in `LoginModal` wrap manually.
- **Reconnect ordering** (`ensureSignerAvailable` in `lib/nostr/signer-reconnect.ts`): try `verifyNIP46Connection()` on the live in-memory client *before* `restoreNIP46Connection()` rebuilds from localStorage. In-memory has session state localStorage can't reproduce; Safari ITP may have cleared storage entirely. `nip46-client.ts:authenticate()` also checks `WebSocket.readyState` and force-reconnects dead sockets.
- **Multi-relay bunker URIs**: subscribe *and* publish across all listed `relay=` params, not just the first — survives one-relay blocks (e.g. Firefox blocks `relay.primal.net`). Secretless bunker URIs (Aegis) have 25s fail-fast timeout.
- **Pre-sign ping is boost-scoped** (`BoostButton.tsx` → `pingSigner`, 5s timeout): relay socket alive ≠ signer subscription alive. Do **not** move the ping inside `signEvent` — scoping it to boost keeps the extra round-trip off non-boost callers. Ping failure fails boost fast with a `Reconnect` toast → `reconnectSignerManually()`.
- **`saveNIP46Connection` three-way pubkey fallback** (`signerAppPubkey || signerPubkey || actualSignerAppPubkey`): `LoginModal` invokes save twice during login; without the fallback the second save wipes the value and post-reload `sign_event` gets encrypted with the wrong pubkey → 120s hang on every Primal boost/favorite.
- **`NostrProvider` has its own `visibilitychange` handler** (`contexts/NostrContext.tsx`), in addition to `useNip46Connection`'s modal-scoped one. The provider-scoped handler keeps boost/favorite working on `/favorites`, NowPlaying, etc. while the modal is unmounted. Do **not** delete as "redundant".
- **NIP-44 works over NIP-46 and needs no router changes** (added 2026-07-26 for the NWC backup). `NIP46Client.nip44Encrypt/nip44Decrypt` → `sendRequest('nip44_encrypt'|'nip44_decrypt')`, surfaced as `UnifiedSigner.supportsNip44()`/`nip44Encrypt`/`nip44Decrypt` and confirmed against real Amber. Replies resolve on the **id path** (`pendingRequests.get(content.id)`); the shape-based fallbacks further down only fire when the id does *not* match and are each gated on the pending request's method being `get_public_key` or `sign_event`, so a base64 NIP-44 result can neither be stolen by them nor satisfied by a stray hex reply. A signer that mangles ids fails by timing out, which is correct. **Do not widen those hex heuristics** to "handle" nip44 — add an explicit pending-op type if it ever proves necessary.
- **`supportsNip44()` is capability, not connectivity — but for NIP-46 it's answered by `isAvailable()`**, i.e. "is the client connected". So it reads `false` for seconds after a post-login reload while the client rebuilds. Callers must go through `ensureSignerAvailable()` and retry before concluding a signer can't encrypt (see the NWC Backup section).
- **NIP-55 has no nip44.** It's intent-based and implements only `sign_event`; `supportsNip44()` is `false` and dependent features must hide rather than fail.

---

## Nostr Login Modal (`components/Nostr/LoginModal.tsx`)
**Card-menu UI** — no tabs. Cards: Browser Extension (shown only if `window.nostr` detected), Bunker URI (paste `bunker://` / `nostrconnect://`), NIP-05 Address (read-only), Amber (Android), Primal (QR code). `view` state: `'menu' | 'bunker' | 'primal' | 'amber' | 'nip05'`. `nostr-login` is mounted with `noBanner: true` so `<nl-auth>` never shows; `NostrLoginInit.tsx` still mounts for session-restore of legacy nostr-login users.

**`noBanner` suppresses the passive banner, NOT nostr-login's login dialog.** It also installs a `window.nostr` shim, and calling any method on it while it has no signer opens its own *"Welcome to Nostr!"* modal to go and get one — appearing mid-flow in an unrelated feature, looking like our UI. This bit once: `window.nostr.nip44` was present on a NIP-46 session, so code preferred it over the app's own connected signer, and the shim hijacked the call. **Presence of `window.nostr` is not evidence of a usable signer** — gate on `nostr_login_type === 'extension'` before trusting it, and use `UnifiedSigner` otherwise (see the Encrypted NWC Backup section).

- **Extension path is fast-path**: `handleExtensionLogin` calls `window.nostr.signEvent(eventTemplate)` **directly**, not through `UnifiedSigner`. Keep this direct path.
- **Bunker URI path**: `handlePastedUriConnect` uses a fresh `NIP46Client` + `signer.setNIP46Signer(client)` — bypasses nostr-login entirely. Most reliable iOS PWA path.
- **NIP-05 path is read-only and public-data-only** (`handleNip05Login`, since #148; narrowed during the security audit that replaced the forgeable `x-nostr-user-id` header with a signed session cookie). POSTs `{ identifier }` (`name@domain.com`) to `/api/nostr/auth/nip05-login`, which resolves the pubkey via `/.well-known/nostr.json` **on a domain the caller names** and loads the kind-0 profile — no key-ownership proof, no signer. Because that lookup proves nothing about who is asking, the route issues **no session cookie and performs no DB writes**: the account's stored favorites are never touched and are **not accessible** from a nip05 session; only this browser's anonymous `sessionId`-scoped favorites show. It signs in via `saveUserData(user, 'nip05')` + reload and **deliberately skips `markFavoritesSyncPending`** (publishing to Nostr needs a signer, and there's nothing server-side to sync from). `UnifiedSigner` has a dedicated `nip05` branch (`signer.ts:363-375`): uses a NIP-07 extension if one is present, else stays read-only — signed actions (boost, publish) fail with the normal "connect a signer" prompt. `NostrContext` gates signer-reconnect to `nip46`/`nsecbunker`, so a `nip05` session triggers no signer machinery on reload/visibilitychange; its session-probe effect also skips a `loginType === 'nip05'` user outright, since that session has no cookie to probe and a 401 there is expected, not stale. Former accepted tradeoff — anyone could read-only "log in" as any identifier to *impersonate* the account (display name, avatar) — **was revisited**: once the forgeable header was closed, letting that impersonation also read the account's real DB favorites would have made this the one remaining way to read someone else's data, so the login was cut back to public profile data only.
- **nostr-login is lazy-init**: `NostrLoginInit.tsx` exports `ensureNostrLoginInitialized()` (called on demand) and `<NostrLoginAutoInit />` (mounts in `layout.tsx`, only runs `init()` if user is logged in AND `window.nostr` is absent). Extension and logged-out users pay zero cost. Do **not** reintroduce eager init.

---

## Post-Login Flow (`lib/nostr/auth-utils.ts`)
Login flows save user data, set `localStorage['nostr_pending_favorites_sync'] = user.id`, close the modal, and reload — no delay. `NostrContext`'s mount effect picks up the flag, runs `syncFavoritesToNostr`, clears it. When adding new login paths, call `markFavoritesSyncPending(userId)` instead of firing sync inline.

**There are now two deferred-work flags on this path**, both set by `completeLogin()` *and* by `LoginModal`'s NIP-46 branch (`handleNip46ConnectedWithClient`) — a new login path must set both or it silently loses the behaviour:
- `nostr_pending_favorites_sync` → `markFavoritesSyncPending(user.id)`, consumed by `NostrContext`.
- `nostr_pending_nwc_backup_offer` → `markNwcBackupOfferPending(user.nostrPubkey)`, consumed by `BitcoinConnectProvider` (auto-restore or offer-to-save; see the NWC Backup section). Keyed by **pubkey**, not user id, because everything downstream is pubkey-scoped. The NIP-05 read-only path deliberately sets *neither* — it has no signer.

Wallet-backup localStorage keys, for reference when debugging: `nostr_pending_nwc_backup_offer` (pubkey awaiting a post-login offer/restore — **kept** on transient failure so the next load retries, consumed only on a real answer), `sk_nwc_backup_declined` (JSON array of pubkeys that answered "Not now", so login stops asking — never cleared, so someone who declines, later saves, then removes a backup won't be re-offered), and `bc:config` (bitcoin-connect's own connection, whose `nwcUrl` is what gets backed up).

**Profile backfill**: the login route (`app/api/nostr/auth/login/route.ts`) returns `displayName`/`avatar`/`bio`/`lightningAddress` as null to skip a ~21s relay round-trip (login completes in ~20ms). `NostrContext` auto-calls `refreshUser()` on mount whenever `user.displayName` is falsy, fetching kind-0 in the background. Do **not** reintroduce synchronous profile lookup — 1000× perf delta was the point. Login route also only updates `nostrNpub` on returning users so a fresh login can't wipe previously-fetched profile fields.

---

## Nostr Publish Queue & Relay Management
Favoriting saves to DB immediately, queues Nostr publish (500ms debounce). **Always call `disconnectAll()`** after publishing or WebSocket connections leak. Key files: `lib/nostr/publish-queue.ts`, `lib/nostr/relay.ts`.

- **`getDefaultRelays()` no longer includes `wss://relay.nsec.app`** (dropped 2026-07-26). It sat first in the list, labelled "more reliable", while returning **502** — costing ~0.5–1.4s on every relay operation. `filterReachableRelays()` only pattern-matches localhost-style URLs, so nothing prunes a dead host automatically; check a relay before adding one. The same URL was also removed from `nip46-client`'s backup-relay list and from the help text that told users to point their bunker at it.
- **Which `WebSocket` nostr-tools gets is a real decision** (`lib/nostr/node-websocket.ts`). Browsers use their
  own. Under Node, `installNodeWebSocket()` installs `ws` — always, even on Node >= 21 where a global already
  exists — because undici re-fires `error` from inside `close()` on a socket that already failed, and
  `nostr-tools` >= 2.25.2 calls `this.ws?.close?.()` from its own `onerror` (its fix for leaked sockets,
  nbd-wtf/nostr-tools#550). The two recurse until `RangeError: Maximum call stack size exceeded`. **Production
  runs Node 22, so the global IS undici's there — every server relay socket must come through
  `installNodeWebSocket()`**: `community-favorites.ts` calls it, and every route's `NostrClient` comes from
  `connectServerNostrClient()` (`lib/nostr/server-client.ts`), which a guard test enforces for `app/api`.
- **`ws` needs a no-op `'error'` listener, and there are FOUR module copies to patch.** `ws` reports a `close()`
  landing on a still-CONNECTING socket by *emitting* an error, and an `'error'` with no listener is rethrown as an
  `uncaughtException` — which is exactly what nostr-tools' connect timeout triggers, so the helper wraps `ws` in a
  `SafeWebSocket` subclass that adds one. And `nostr-tools/pool` and `nostr-tools/relay` each keep their own
  `_WebSocket`, under each of the CJS and ESM conditions. The barrel **inlines a third copy** that no
  `useWebSocketImplementation` can reach, which is why `RelayManager` imports `Relay` from `nostr-tools/relay`
  rather than `nostr-tools`. Patching one and assuming the rest followed has been the bug twice.
- **NIP-01 tag validation**: `createFavoriteEventTemplate` (in `lib/nostr/favorites.ts`) throws if `itemId` is falsy so we never publish events with `["d", null]` tags — strict relays (nsec.app) reject them. Validate all required tag values at build time, not publish time.
- **Dead-socket filtering** (`RelayManager.publish`): write relays filtered by `relay.connected !== false` before publishing. Each `relay.publish()` wrapped in `Promise.resolve().then(...)` so sync throws flow through `Promise.allSettled`.
- **Stale-signer recovery** (`flushQueue`): routes through `ensureSignerAvailable()` from `signer-reconnect.ts` (same wrapper `BoostButton.tsx` uses). Do **not** revert to the manual `isAvailable() + NIP-55-only` branch — it silently dropped favorites on stale singleton signers.
- **Failure toasts** (`flushQueue`): signer failure, zero-relay connectivity, and per-item sign/publish errors emit `toast.error`/`toast.warning` instead of silent `resolve(null)`. Sign-failure toast has `Reconnect` action → `reconnectSignerManually()`. Do **not** remove — publish queue is the only place user-initiated Nostr writes can fail invisibly.
