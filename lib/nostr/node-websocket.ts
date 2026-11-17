/**
 * Give `nostr-tools` a WebSocket when Node doesn't have one.
 *
 * NODE-ONLY. Nothing in `app/`, `components/` or `contexts/` may import this —
 * browsers have always had `WebSocket`, and pulling `ws` into the client bundle
 * would be pure dead weight. Its callers are the relay harnesses
 * (`relay-read.test.ts`, `relay-isolation.test.ts`, `favorites.relay-probe.ts`,
 * `scripts/e2e-favorites.ts`) and the two places the SERVER opens relay
 * sockets: `community-favorites.ts` (the Community tab sweep) and
 * `server-client.ts` (every `NostrClient` a route builds — the boost note,
 * `/auth/me`, NIP-05 login and the rest). Those two are why `ws` is a
 * production dependency and not a devDependency.
 *
 * WHY IT EXISTS
 * `globalThis.WebSocket` only landed as a default in **Node 21**. This repo
 * targeted **Node 20** until 2026-09, where it sits behind
 * `--experimental-websocket`; it now targets Node 22 (below for why that is no
 * reason to drop this). `nostr-tools` reads the global once, at module load:
 *
 *     var _WebSocket;
 *     try { _WebSocket = WebSocket; } catch {}      // lib/esm/pool.js
 *
 * so on Node 20 every relay connection fails with `WebSocket is not defined`.
 * That is invisible from the symptom: the relay test's seven "a relay answers"
 * cases fail while its degraded-read cases still pass (a failed connection is
 * indistinguishable from the degradation they assert), and the probe declares
 * every default relay dead — the exact inversion of what it exists to detect.
 * CI caught the first; the second had never been run on Node 20.
 *
 * WHY THREE LINES AND NOT ONE
 * This repo is CommonJS, so under `tsx` a **static** `import … from
 * 'nostr-tools/pool'` resolves the package's `require` condition (the CJS build)
 * while a **dynamic** `await import('nostr-tools/pool')` resolves its `import`
 * condition (the ESM build). Those are two separate module instances with two
 * separate `_WebSocket` variables, and our two callers use one each:
 * `fetchSharedFavorites` dynamic-imports the pool (ESM), while the probe builds
 * its own `SimplePool` from a static import (CJS). Patching one leaves the other
 * silently broken — measured, when this was written as the obvious one-liner.
 * So: set the global for any copy not yet loaded, then inject into every copy.
 *
 * And it is not two copies but four. `nostr-tools/relay` keeps its OWN
 * `_WebSocket`, separate from `nostr-tools/pool` -- `RelayManager` reaches it
 * through `Relay.connect`, while the reads go through the pool -- so each of the
 * two modules needs patching under each of the two conditions.
 *
 * WHY IT RUNS ON NODE >= 21 TOO, WHERE `WebSocket` ALREADY EXISTS
 * It used to return early whenever a global `WebSocket` was defined, which on
 * Node >= 21 left `nostr-tools` on **undici's** WebSocket. Undici re-fires
 * `error` from inside `close()` on a socket that already failed to connect, and
 * `nostr-tools` >= 2.25.2 calls `this.ws?.close?.()` from its own `onerror`
 * (the fix for its leaked-socket bug, nbd-wtf/nostr-tools#550). The two
 * together recurse until `RangeError: Maximum call stack size exceeded`, so on
 * Node 22 three relay tests failed while CI, then pinned to Node 20 by
 * `.nvmrc`, stayed green. Browsers are not affected: `close()` on an
 * already-failed socket is a no-op there, so the upstream fix does what it says.
 *
 * Installing `ws` unconditionally under Node makes a local run match CI and
 * production (`node:22-alpine`), and keeps the undici quirk out of the picture.
 * Production could only move to Node 22 once every server socket came through
 * here — see server-client.ts.
 * It does reach the production SERVER bundle, through the two callers above —
 * which is why `next.config.js` lists `ws` in `serverExternalPackages` — and
 * never the client bundle.
 */

// Static — reaches the CJS instance, whose `_WebSocket` was already captured
// (as undefined) when this module was imported. Aliased away from its `use…`
// name because eslint's `react-hooks/rules-of-hooks` reads any `useFoo()` call
// as a React hook and errors on it — an error, not a warning, so it fails
// `next lint` in CI.
import { useWebSocketImplementation as setCjsPoolWebSocket } from 'nostr-tools/pool';
import { useWebSocketImplementation as setCjsRelayWebSocket } from 'nostr-tools/relay';

let installed = false;

/**
 * No-op in a browser. Safe to call more than once; call it before constructing
 * a `SimplePool` or reading from a relay.
 */
export async function installNodeWebSocket(): Promise<void> {
  if (installed) return;
  // Browsers keep their own WebSocket. Under Node we always install `ws`, even
  // on Node >= 21 where a global already exists -- see the header.
  if (typeof process === 'undefined' || !process.versions?.node) return;

  const { default: WS } = await import('ws');

  // `ws` reports a close() that lands on a socket still in CONNECTING by
  // EMITTING an error, and an 'error' with no listener is rethrown -- so it
  // surfaces as `uncaughtException: WebSocket was closed before the connection
  // was established`. nostr-tools does exactly that from its connect timeout
  // (`this.ws?.close?.()`, added in 2.25.2) after clearing its own handler, so
  // every relay that timed out crashed out of the request. Measured against the
  // standalone build: two uncaught exceptions per sweep before this listener.
  //
  // A permanent no-op listener only stops the rethrow. nostr-tools still gets
  // its own `onerror`, and a relay that failed still reports `connected: false`,
  // so the connectivity check in community-favorites.ts is unaffected.
  class SafeWebSocket extends WS {
    constructor(...args: ConstructorParameters<typeof WS>) {
      super(...args);
      this.on('error', () => {});
    }
  }

  (globalThis as any).WebSocket = SafeWebSocket; // for any copy loaded from here on
  setCjsPoolWebSocket(SafeWebSocket); // the CJS pool (the probe's own SimplePool)
  setCjsRelayWebSocket(SafeWebSocket); // the CJS relay (RelayManager's `Relay.connect`)
  const esmPool = await import('nostr-tools/pool');
  esmPool.useWebSocketImplementation(SafeWebSocket); // the ESM pool (fetchSharedFavorites')
  const esmRelay = await import('nostr-tools/relay');
  esmRelay.useWebSocketImplementation(SafeWebSocket); // the ESM relay

  installed = true;
}
