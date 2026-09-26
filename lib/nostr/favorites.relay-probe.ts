/**
 * npx tsx lib/nostr/favorites.relay-probe.ts [npub|hex]
 *
 * Real-relay smoke check for the kind:10333 favorites read. Complements
 * `relay-read.test.ts`, which scripts LOCAL relays — the two cover different
 * things and neither replaces the other:
 *
 *   - The test file covers what a correct relay will never do on request: hang,
 *     serve another user's event, serve a tampered one, refuse to connect. That
 *     is where both `trustworthy` bugs were found, and it needs fake relays.
 *   - This probe covers what fake relays can't tell you: whether the relays the
 *     app actually ships still work, today, from this machine.
 *
 * The second is the failure that has bitten twice — `relay.nsec.app` returning
 * 502 for months, then `nostr.oxtr.dev` blackholing connections — because
 * nothing prunes a dead default automatically (`filterReachableRelays` only
 * pattern-matches localhost-style URLs). Neither showed up as an error; both
 * just made every read slower until someone measured.
 *
 * READ-ONLY. It never signs and never publishes — there is deliberately no
 * import of the publish path here, so running it against a real key cannot
 * alter that key's list.
 *
 * Not part of `npx tsx --test` runs: it needs the network, and a relay having a
 * bad afternoon should not fail an unrelated test suite. Run it when touching
 * relay code, or when a read seems slow.
 *
 * Exits non-zero if a check fails, so it can gate a deploy if you ever want it to.
 */

import { nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import { installNodeWebSocket } from './node-websocket';
import { getDefaultRelays } from './relay';
import { fetchSingleList, SINGLE_LIST_KIND } from './favorites-single-list';

// Chad's key — the account trialling the sync. Override with an argument.
const DEFAULT_NPUB = 'npub177fz5zkm87jdmf0we2nz7mm7uc2e7l64uzqrv6rvdrsg8qkrg7yqx0aaq7';

const CONNECT_BUDGET_MS = 8_000;

let failures = 0;
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const bad = (msg: string) => {
  failures += 1;
  console.log(`  ❌ ${msg}`);
};

function toPubkey(input: string): string {
  if (input.startsWith('npub1')) return nip19.decode(input).data as string;
  return input.toLowerCase();
}

/** Per-relay: does it connect, and does it send a REAL eose? */
async function healthCheck(relays: string[]) {
  console.log(`\n① Relay health — ${relays.length} defaults from getDefaultRelays()`);
  const pool = new SimplePool();
  // A key with certainly no list, so every relay's honest answer is "nothing".
  const nobody = getPublicKey(generateSecretKey());
  let live = 0;

  for (const url of relays) {
    const started = Date.now();
    try {
      const relay: any = await (pool as any).ensureRelay(url, {
        connectionTimeout: CONNECT_BUDGET_MS,
      });
      const connectedMs = Date.now() - started;
      const eosed = await new Promise<boolean>((resolve) => {
        const sub = relay.subscribe([{ kinds: [SINGLE_LIST_KIND], authors: [nobody] }], {
          // Disable the library's synthetic EOSE: only a real one counts here,
          // for the same reason it doesn't count in `readReplaceableEvent`.
          eoseTimeout: CONNECT_BUDGET_MS * 10,
          oneose() {
            sub.close();
            resolve(true);
          },
        });
        setTimeout(() => {
          try {
            sub.close();
          } catch {
            /* already closed */
          }
          resolve(false);
        }, CONNECT_BUDGET_MS);
      });
      if (eosed) {
        live += 1;
        ok(`${url} — connect ${connectedMs}ms, eose ${Date.now() - started}ms`);
      } else {
        bad(`${url} — connected but sent NO eose in ${CONNECT_BUDGET_MS}ms (hung; reads degrade)`);
      }
    } catch (e: any) {
      bad(`${url} — no connection: ${e?.message || e}`);
    }
  }

  try {
    pool.close(relays);
  } catch {
    /* nothing open */
  }
  if (live === 0) bad('NO default relay answered — every read will be degraded');
  return live;
}

/** A key with no list must read as trustworthy-empty, or a first publish never happens. */
async function emptyRead(relays: string[]) {
  console.log('\n② A key with no list — must be a TRUSTED empty read');
  const started = Date.now();
  const r = await fetchSingleList(getPublicKey(generateSecretKey()), relays);
  const ms = Date.now() - started;

  if (r.exists) bad(`a fresh key somehow has a list (${r.groups.length} groups)`);
  else if (!r.trustworthy) {
    bad(
      `trustworthy=false in ${ms}ms — a genuine empty list reads as a failure, so this app could never make its FIRST publish`
    );
  } else ok(`trustworthy empty in ${ms}ms`);
}

/** The real account: reads, parses, and looks like the format says it should. */
async function realRead(relays: string[], pubkey: string) {
  console.log(`\n③ The live list for ${pubkey.slice(0, 12)}…`);
  const started = Date.now();
  const r = await fetchSingleList(pubkey, relays);
  const ms = Date.now() - started;

  if (!r.trustworthy) {
    bad(`degraded read in ${ms}ms — nothing reachable answered`);
    return;
  }
  if (!r.exists) {
    console.log(`  ℹ️  no list published for this key yet (trusted empty, ${ms}ms)`);
    return;
  }

  const items = r.groups.reduce((n, g) => n + g.itemGuids.length, 0);
  ok(
    `read ${r.groups.length} feed groups and ${items} items in ${ms}ms (updated ${new Date(
      r.updatedAt * 1000
    ).toISOString()})`
  );

  const byMedium = r.groups.reduce<Record<string, number>>((acc, g) => {
    const key = g.medium ?? '(not told)';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(`     groups by medium: ${JSON.stringify(byMedium)}`);

  // `content` — the private half, which this app carries and does not read.
  //
  // Reported because it is the only way to check the carry from outside: read
  // here, toggle a favorite in the app, read again, and the bytes must be
  // identical while `updated` moves. Without this line the tool built for
  // verifying this list could not answer the one question it was blocking on.
  //
  // A prefix, never the whole thing. It is someone's encrypted favorites; the
  // length and the first few characters are enough to compare two reads, and
  // dumping the payload into a terminal that gets pasted into an issue is not.
  if (r.content.length === 0) {
    console.log('     content: empty — no private half on this list');
  } else {
    console.log(
      `     content: ${r.content.length} bytes, starts ${JSON.stringify(r.content.slice(0, 12))}` +
        ' — carried verbatim, never parsed'
    );
  }

  // This app never writes one. Another writer might, and they resolve less well
  // — no parent feed means no /episodes/byguid lookup.
  if (r.orphanItemGuids.length) {
    console.log(
      `     ℹ️  ${r.orphanItemGuids.length} item(s) sit before any feed group, so they carry no parent`
    );
  }
}

async function main() {
  // Must precede the first `new SimplePool()`. On Node 20 there is no
  // `WebSocket` global, and without this every relay below reports
  // `no connection: WebSocket is not defined` — a tool for finding dead relays
  // declaring all of them dead. See lib/nostr/node-websocket.ts.
  await installNodeWebSocket();

  const args = process.argv.slice(2);
  const relayAt = args.indexOf('--relay');
  const arg = args.find((a) => !a.startsWith('--') && args[relayAt + 1] !== a);
  const pubkey = toPubkey(arg || DEFAULT_NPUB);

  // `--relay ws://127.0.0.1:7777` points the probe at the local test relay.
  // `getDefaultRelays()` reads NEXT_PUBLIC_NOSTR_RELAYS only in a browser, so
  // there is otherwise no way to run this against anything but production —
  // and the local relay is where a publish can be tested at all. See
  // scripts/local-relay.mjs.
  const relays = relayAt === -1 ? getDefaultRelays() : [args[relayAt + 1]];

  console.log('Favorites (kind 10333) — read-only smoke check (never publishes)');
  console.log(`relays: ${relays.join(', ')}`);

  await healthCheck(relays);
  await emptyRead(relays);
  await realRead(relays, pubkey);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe threw:', e);
  process.exit(1);
});
