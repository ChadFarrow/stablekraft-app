/**
 * npx tsx --test lib/nostr/relay-read.test.ts
 *
 * The integration half of the trusted replaceable-event read — the part that
 * decides whether a read is `trustworthy`, which is the flag anything reading
 * user data off relays rests on.
 *
 * Ported from the kind:30078 favorites reader when that format was retired. The
 * format changed; none of these failures did, because they are properties of
 * relays rather than of the event.
 *
 * Why this can't be done against real relays: the failure modes worth testing
 * are all misbehaviour. A relay that serves someone else's event, a relay that
 * accepts the connection and then says nothing, two relays disagreeing about
 * which revision is current — a correct relay will never do any of these on
 * request. So we run our own, scripted, on localhost.
 *
 * Hermetic: no docker, no external network, ephemeral ports. Slower than the
 * pure tests (a few seconds — some cases must wait out a timeout by
 * construction), which is why it is a separate file.
 *
 * NODE VERSION: `nostr-tools` needs a `WebSocket`, and neither of the Nodes this
 * repo has run gives it a usable one. Node 20 (the target until 2026-09) has no
 * global without a flag: every case that needs a relay to ANSWER fails, while
 * every degraded-read case still passes, because a failed connection looks
 * exactly like the degradation they assert. Node 22 (`.nvmrc`, `node:22-alpine`)
 * has undici's, which recurses on a failed connect. `installNodeWebSocket()`
 * supplies `ws` for both. Reproduce the Node 20 case with
 * `NODE_OPTIONS=--no-experimental-websocket`.
 *
 * ---------------------------------------------------------------------------
 * The stakes, restated: `trustworthy` is what stands between a relay wobble and
 * acting on a list we never actually read. A false positive here means an empty
 * read is believed — and for favorites that means republishing without any
 * entry another app contributed, or reconciling a library away. No error, no
 * undo.
 * ---------------------------------------------------------------------------
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Filter } from 'nostr-tools';

import { installNodeWebSocket } from './node-websocket';
import { readReplaceableEvent } from './relay-read';
import { SINGLE_LIST_KIND, LIST_ALT } from './favorites-single-list';
import { showId } from './pc20-identifiers';

// See NODE VERSION above. On Node 20 this is the difference between this file
// testing the read and testing nothing at all; on Node >= 21 it keeps us off
// undici's WebSocket, which recurses on a failed connect.
before(async () => {
  await installNodeWebSocket();
});

// --- keys ------------------------------------------------------------------

const mySk = generateSecretKey();
const myPubkey = getPublicKey(mySk);
const theirSk = generateSecretKey(); // a different, equally valid Nostr user
const theirPubkey = getPublicKey(theirSk);

const A = showId('9b024349-ccf0-5f69-a609-6b82873eab3c');
const B = showId('c31ad2f6-1b7e-5b34-a2a4-6b06d5b0b4e2');

const filter: Filter = { kinds: [SINGLE_LIST_KIND], authors: [myPubkey], limit: 1 };

/** A properly signed favorites event. */
function makeEvent(sk: Uint8Array, createdAt: number, ids: string[]) {
  return finalizeEvent(
    {
      kind: SINGLE_LIST_KIND,
      created_at: createdAt,
      content: '',
      tags: [['alt', LIST_ALT], ...ids.map((id) => ['i', id])],
    },
    sk
  );
}

/** The identifiers on the event that was read, for the assertions below. */
const idsOf = (event: any) =>
  (event?.tags ?? []).filter((t: string[]) => t[0] === 'i').map((t: string[]) => t[1]);

const read = (relays: string[], timeoutMs?: number) =>
  readReplaceableEvent({ pubkey: myPubkey, relays, filter, timeoutMs });

// --- the scriptable relay --------------------------------------------------

type Behavior =
  | { mode: 'serve'; events: any[] } // send these, then EOSE
  | { mode: 'eose' } // answer, but with nothing — a genuinely empty read
  | { mode: 'silent' }; // accept the socket and never speak again

const servers: any[] = [];

/** Start a relay on an ephemeral port. Returns its ws:// URL. */
async function startRelay(behavior: Behavior): Promise<string> {
  const wss = new (WebSocket as any).Server({ port: 0 });
  servers.push(wss);
  wss.on('connection', (socket: any) => {
    socket.on('message', (raw: any) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg[0] !== 'REQ') return;
      const subId = msg[1];
      if (behavior.mode === 'silent') return; // the whole point of this one
      if (behavior.mode === 'serve') {
        // Deliberately NOT filtered server-side. A relay is free to send
        // whatever it likes; whether the client accepts it is what's on trial.
        for (const e of behavior.events) socket.send(JSON.stringify(['EVENT', subId, e]));
      }
      socket.send(JSON.stringify(['EOSE', subId]));
    });
  });
  await new Promise<void>((resolve) => wss.on('listening', resolve));
  return `ws://127.0.0.1:${wss.address().port}`;
}

after(() => {
  // `close()` stops the listener but leaves ESTABLISHED sockets open, and an
  // open socket keeps the event loop alive — the file then sits for ~100s after
  // the last assertion before the runner exits. Terminate the clients, don't
  // just stop listening.
  for (const s of servers) {
    try {
      for (const client of s.clients) {
        try {
          client.terminate();
        } catch {
          /* already gone */
        }
      }
      s.close();
    } catch {
      /* already down */
    }
  }
});

// --- the read, end to end --------------------------------------------------

test('a relay serving the event is read and trusted', async () => {
  const url = await startRelay({ mode: 'serve', events: [makeEvent(mySk, 1000, [A, B])] });
  const r = await read([url], 3000);

  assert.equal(r.trustworthy, true);
  assert.notEqual(r.event, null);
  assert.deepEqual(idsOf(r.event), [A, B]);
  assert.equal(r.event!.created_at, 1000);
});

test('a relay that answers with nothing is an EMPTY read, and is trusted', async () => {
  // The distinction the whole feature rests on. This must be trustworthy:true
  // with no event — believing it is how a real clear-all propagates.
  const url = await startRelay({ mode: 'eose' });
  const r = await read([url], 3000);

  assert.equal(r.trustworthy, true);
  assert.equal(r.event, null);
});

test('a relay that says NOTHING is not an empty read — it is a degraded one', async () => {
  // Same observable shape as the test above and the opposite meaning. Acting on
  // this one is what wipes data. Our own timeout must win here, so it is set
  // below the pool's internal EOSE timer.
  const url = await startRelay({ mode: 'silent' });
  const r = await read([url], 1000);

  assert.equal(r.trustworthy, false);
  assert.equal(r.event, null);
});

test("an event signed by someone ELSE is never accepted as the user's", async () => {
  // A validly-signed event from a real, different key — not a forgery. The
  // relay is simply answering with the wrong person's list.
  const url = await startRelay({ mode: 'serve', events: [makeEvent(theirSk, 5000, [A, B])] });
  const r = await read([url], 3000);

  assert.notEqual(myPubkey, theirPubkey);
  assert.equal(r.event, null, "another user's event must not be read as ours");
  assert.equal(r.trustworthy, true, 'the relay did answer — this is an empty read, not a failed one');
});

test("a foreign event does not displace the user's, however new it claims to be", async () => {
  // The integration form of the intake-order rule. The foreign event has a
  // created_at 4000s newer; if the author check ran on the winner instead of at
  // intake, the genuine event would be discarded along with it.
  const url = await startRelay({
    mode: 'serve',
    events: [makeEvent(mySk, 1000, [A]), makeEvent(theirSk, 5000, [B])],
  });
  const r = await read([url], 3000);

  assert.notEqual(r.event, null);
  assert.equal(r.event!.created_at, 1000, 'the genuine event survives');
  assert.deepEqual(idsOf(r.event), [A]);
});

test('a tampered event is rejected — the signature no longer covers it', async () => {
  const forged: any = makeEvent(mySk, 1000, [A]);
  forged.tags.push(['i', B]); // same id, same sig, different content
  const url = await startRelay({ mode: 'serve', events: [forged] });
  const r = await read([url], 3000);

  assert.equal(r.event, null, 'a mutated event must not be read');
});

test('the newest revision wins across relays, not the first to answer', async () => {
  // A relay that is merely BEHIND — serving a real but stale revision — is
  // indistinguishable from a current one by reachability alone. Taking the
  // first answer means acting on an old list and republishing it.
  const stale = await startRelay({ mode: 'serve', events: [makeEvent(mySk, 1000, [A])] });
  const fresh = await startRelay({ mode: 'serve', events: [makeEvent(mySk, 2000, [A, B])] });
  const r = await read([stale, fresh], 3000);

  assert.equal(r.event!.created_at, 2000);
  assert.deepEqual(idsOf(r.event), [A, B]);
});

test('one live relay is enough — a silent one alongside it does not lose the event', async () => {
  const silent = await startRelay({ mode: 'silent' });
  const live = await startRelay({ mode: 'serve', events: [makeEvent(mySk, 1000, [A])] });
  const r = await read([silent, live], 3000);

  assert.notEqual(r.event, null, 'an event in hand is its own proof the query worked');
  assert.equal(r.trustworthy, true);
});

test('no relays at all is a degraded read, not an empty one', async () => {
  const r = await read([], 1000);
  assert.equal(r.trustworthy, false);
});

// --- the two regressions this harness was written to find -------------------
//
// Both reported `trustworthy: true` on a read that never happened, which is the
// single failure the flag exists to prevent. Neither was reachable from the pure
// tests, and neither is something a correct relay will do on request.

test('a hung relay is degraded at the PRODUCTION timeout, not just a short one', async () => {
  // The regression: nostr-tools synthesizes an EOSE on a timer
  // (`AbstractRelay.baseEoseTimeout`, 4400ms) when a relay never sends one, and
  // the pool counts it as a real answer. That is UNDER this module's 5s default,
  // so the fake EOSE always won and a silent relay read as trustworthy.
  //
  // Note the deliberately absent timeout — this must be exercised at the real
  // default. The short-timeout version of this test passed throughout, because
  // our own timer beat the synthetic EOSE and hid the bug.
  const url = await startRelay({ mode: 'silent' });
  const r = await read([url]);

  assert.equal(r.trustworthy, false, 'a relay that never answered must never read as empty');
});

test('being offline is a degraded read, not a cleared library', async () => {
  // The worse half, and the likelier one. A failed connection also counted
  // toward the aggregate EOSE, so with nothing reachable every relay
  // "answered" at once: measured trustworthy in ~19ms with no network.
  const refused = ['ws://127.0.0.1:9', 'ws://127.0.0.1:10', 'ws://127.0.0.1:11'];
  const r = await read(refused, 2000);

  assert.equal(r.trustworthy, false);
  assert.equal(r.event, null);
});

test('a dead relay in the list does not block a good read from the others', async () => {
  // The other side of that fix, and the reason the bar is "every relay we could
  // REACH" rather than "every relay in the list". A default list can ship with a
  // dead entry, so counting unreachable relays against the read would leave the
  // feature permanently degraded.
  const live = await startRelay({ mode: 'eose' });
  const r = await read(['ws://127.0.0.1:9', live], 2000);

  assert.equal(r.trustworthy, true, 'the reachable relay answered — that is a real empty read');
  assert.equal(r.event, null);
});
