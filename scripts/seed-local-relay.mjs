#!/usr/bin/env node
/**
 * Copy a real kind:10333 favorites event into the local relay.
 *
 * READ-ONLY against the real relays. It fetches and forwards; it never signs,
 * never publishes to anything but 127.0.0.1, and never deletes. The event is
 * relayed byte-for-byte, signature included, so the local copy is genuinely the
 * one in production rather than a re-rendering of it.
 *
 * WHY: a synthetic two-entry list proves nothing about this subsystem. The real
 * one is 196 feed groups and 227 items, carries entries this app cannot model,
 * and is the only fixture where the merge, the positional placement and the
 * `k`-tag layout are all under load at once. Testing the private half against a
 * toy list is how the interesting cases get missed.
 *
 * Usage:
 *   npm run seed:relay -- npub1…            # or a hex pubkey
 *   npm run seed:relay -- npub1… --content 'AkQB…'   # force a private half
 *
 * `--content` replaces `event.content` before forwarding, which is how you get
 * a non-empty private half to test the carry against while no app writes one
 * yet. The signature no longer matches after that — this relay does not verify,
 * and a signature that fails elsewhere is a feature: the doctored event must
 * never leave 127.0.0.1.
 */

import WebSocket from 'ws';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';

// Node 20 has no WebSocket global and Node 22's is undici's; nostr-tools captures
// it at module load. See lib/nostr/node-websocket.ts for the full story.
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;
useWebSocketImplementation(WebSocket);

const SINGLE_LIST_KIND = 10333;
const LOCAL = `ws://127.0.0.1:${process.env.PORT || 7777}`;

// The app's own defaults, minus nothing. Kept in step with lib/nostr/relay.ts.
const SOURCE_RELAYS = [
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://theforest.nostr1.com',
  'wss://relay.damus.io',
];

function toPubkey(value) {
  if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  const decoded = nip19.decode(value);
  if (decoded.type === 'npub') return decoded.data;
  if (decoded.type === 'nprofile') return decoded.data.pubkey;
  throw new Error(`not an npub or hex pubkey: ${value}`);
}

async function main() {
  const args = process.argv.slice(2);
  const npub = args.find((a) => !a.startsWith('--'));
  if (!npub) {
    console.error('usage: npm run seed:relay -- <npub|hex> [--content <ciphertext>]');
    process.exit(1);
  }
  const contentAt = args.indexOf('--content');
  const forcedContent = contentAt === -1 ? null : args[contentAt + 1];
  const pubkey = toPubkey(npub);

  console.log(`reading kind:${SINGLE_LIST_KIND} for ${pubkey.slice(0, 12)}… from ${SOURCE_RELAYS.length} relays`);
  const pool = new SimplePool();
  let event;
  try {
    event = await pool.get(SOURCE_RELAYS, { kinds: [SINGLE_LIST_KIND], authors: [pubkey] });
  } finally {
    try {
      pool.close(SOURCE_RELAYS);
    } catch {
      /* nothing open */
    }
  }

  if (!event) {
    console.error('no kind:10333 event found for that key on any default relay');
    process.exit(1);
  }

  const entries = event.tags.filter((t) => t[0] === 'i').length;
  console.log(
    `found: ${event.tags.length} tags, ${entries} entries, content ${event.content.length} bytes, ` +
      `created_at ${new Date(event.created_at * 1000).toISOString()}`
  );

  if (forcedContent !== null) {
    // Deliberate doctoring, and it invalidates the signature. Stated out loud
    // because an event that fails verification elsewhere should be traceable
    // back to this line rather than looking like relay corruption.
    event = { ...event, content: forcedContent };
    console.log(`content overridden to ${forcedContent.length} bytes — signature is now INVALID by design`);
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(LOCAL);
    const fail = (why) => {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail(`no OK from ${LOCAL} within 5s`), 5000);

    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('error', (err) => {
      clearTimeout(timer);
      fail(`cannot reach ${LOCAL} — is \`npm run relay\` running? (${err.message})`);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] !== 'OK') return;
      clearTimeout(timer);
      if (!msg[2]) return fail(`local relay refused the event: ${msg[3]}`);
      console.log(`seeded into ${LOCAL}`);
      ws.close();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
