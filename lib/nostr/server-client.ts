/**
 * The only way SERVER code may open a `NostrClient`.
 *
 * Six routes open relay sockets from the server — the boost note
 * (`/api/nostr/boost`, the only place a boost note is published at all),
 * `/api/nostr/auth/me` and `/api/nostr/auth/nip05-login` (profile and relay
 * list reads), and `share`, `follow` and `profile/update`. For as long as they
 * existed, none of them brought a WebSocket. `node:20-alpine` runs
 * `node server.js` with no `--experimental-websocket`, and Node 20 exposes the
 * global only behind that flag, so every one of those connects threw inside
 * `RelayManager.connect` — and `NostrClient.connect` swallows per-relay
 * failures. Nothing was logged. A boost note came back `published: false`
 * ("Boost stored but may not have been published"), and `/auth/me` quietly
 * served the database copy of the profile it was written to refresh.
 *
 * It may also have worked intermittently: `installNodeWebSocket()` patches the
 * `nostr-tools/relay` module, so if the bundle shares that module between
 * routes, a Community tab sweep (community-favorites.ts) would have fixed these
 * routes too for the rest of that process — until the next deploy. Either way
 * the outcome depended on something no caller controls.
 *
 * So the install happens here, before every server connect, and a guard in
 * server-client.test.ts fails if a route under `app/api` constructs a client
 * any other way. It is not done inside `RelayManager`, because `relay.ts` is
 * also the browser's relay layer (NIP-46 signing, the favorites publish) and
 * `ws` has no business in that bundle.
 *
 * Reaching no relay is now logged. It is the same question
 * community-favorites.ts had to learn to ask: a connect that reached nobody
 * looks exactly like one that found nothing.
 */

import { NostrClient } from './client';
import { installNodeWebSocket } from './node-websocket';

/**
 * Install `ws`, construct a client for `relays`, and connect.
 *
 * `label` names the caller in the warning when no relay answered. The caller
 * still owns the client: always `disconnect()` it when done.
 */
export async function connectServerNostrClient(relays: string[], label: string): Promise<NostrClient> {
  // Must precede the connect. `nostr-tools/relay` hands each new Relay the
  // WebSocket it captured at module load — undefined on Node 20, undici's on
  // Node 22 — unless `useWebSocketImplementation` has replaced it, which this does.
  await installNodeWebSocket();

  const client = new NostrClient(relays);
  await client.connect();

  const reached = client.getConnectedRelays().length;
  if (reached === 0) {
    console.warn(`[server-nostr] ${label}: reached 0 of ${relays.length} relays`);
  }
  return client;
}
