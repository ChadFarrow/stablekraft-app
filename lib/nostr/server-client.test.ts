/**
 * npx tsx --test lib/nostr/server-client.test.ts
 *
 * The server's relay sockets must bring their own WebSocket. Six routes built a
 * `NostrClient` directly and none of them did, so on `node:20-alpine` — no
 * WebSocket global without `--experimental-websocket` — every boost note, every
 * `/auth/me` profile refresh and every NIP-05 login relay read failed, silently,
 * because `NostrClient.connect` swallows per-relay errors. See server-client.ts.
 *
 * DELIBERATELY no `installNodeWebSocket()` in a `before` hook, unlike every
 * other relay test here. Installing it up front is what those files need and
 * exactly what would hide this bug: the factory has to do it on its own.
 *
 * What each assertion catches:
 * - Node 20 (or `NODE_OPTIONS=--no-experimental-websocket`) without the install:
 *   nothing connects.
 * - Node >= 22 without the install: undici's WebSocket connects, and the
 *   `instanceof` check fails. Undici recurses on a failed connect with
 *   nostr-tools >= 2.25.2 (see node-websocket.ts), so that is a real failure
 *   too, just a later one.
 *
 * Hermetic: an in-process relay on an ephemeral port, no external network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

import { connectServerNostrClient } from './server-client';
import { installNodeWebSocket } from './node-websocket';
import { RelayManager } from './relay';

// --- a minimal relay -------------------------------------------------------

const servers: any[] = [];

/** Answers REQ with EOSE and EVENT with OK. Returns its ws:// URL. */
async function startRelay(options: { handshakeDelayMs?: number } = {}): Promise<{ url: string; wss: any }> {
  const { handshakeDelayMs } = options;
  const wss = new (WebSocket as any).Server({
    port: 0,
    ...(handshakeDelayMs
      ? { verifyClient: (_info: unknown, done: (ok: boolean) => void) => setTimeout(() => done(true), handshakeDelayMs) }
      : {}),
  });
  servers.push(wss);
  wss.on('connection', (socket: any) => {
    socket.on('message', (raw: any) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg[0] === 'REQ') socket.send(JSON.stringify(['EOSE', msg[1]]));
      if (msg[0] === 'EVENT') socket.send(JSON.stringify(['OK', msg[1].id, true, '']));
    });
  });
  await new Promise<void>((resolve) => wss.on('listening', resolve));
  return { url: `ws://127.0.0.1:${wss.address().port}`, wss };
}

/** A port nothing is listening on. */
async function closedPortUrl(): Promise<string> {
  const wss = new (WebSocket as any).Server({ port: 0 });
  await new Promise<void>((resolve) => wss.on('listening', resolve));
  const { port } = wss.address();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  return `ws://127.0.0.1:${port}`;
}

after(() => {
  // `close()` alone leaves ESTABLISHED sockets open, which keeps the runner
  // alive long after the last assertion. Terminate the clients too.
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

/**
 * `RelayManager.connect` refuses loopback URLs unless the build is pointed at
 * them, and `getDefaultRelays` reads the override only when `window` exists.
 * Same shape as relay-isolation.test.ts's helper.
 */
async function withLocalRelays<T>(urls: string[], fn: () => Promise<T>): Promise<T> {
  const had = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) (globalThis as any).window = {};
  process.env.NEXT_PUBLIC_NOSTR_RELAYS = urls.join(',');
  try {
    return await fn();
  } finally {
    if (had === undefined) delete process.env.NEXT_PUBLIC_NOSTR_RELAYS;
    else process.env.NEXT_PUBLIC_NOSTR_RELAYS = had;
    if (!hadWindow) delete (globalThis as any).window;
  }
}

/** Collect console.warn lines while `fn` runs. */
async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = original;
  }
}

// --- the factory -----------------------------------------------------------

test('connects on its own, over ws, and a publish is accepted', async () => {
  const { url } = await startRelay();
  await withLocalRelays([url], async () => {
    const { result: client, warnings } = await captureWarnings(() => connectServerNostrClient([url], 'test'));
    try {
      assert.deepEqual(client.getConnectedRelays(), [url], 'the server reached no relay');

      const socket = (client as any).relayManager.getRelay(url)?.ws;
      assert.ok(
        socket instanceof (WebSocket as any),
        'connected on something other than `ws` — on Node >= 22 that is undici, which recurses on a failed connect'
      );
      assert.deepEqual(warnings, []);

      const event = finalizeEvent(
        { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'server-client test' },
        generateSecretKey()
      );
      const results = await client.publish(event, { relays: [url], waitForRelay: true });
      assert.equal(results.length, 1);
      assert.equal(results[0].status, 'fulfilled');
    } finally {
      await client.disconnect();
    }
  });
});

test('reaching no relay does not throw, and says so', async () => {
  const dead = await closedPortUrl();
  await withLocalRelays([dead], async () => {
    const { result: client, warnings } = await captureWarnings(() =>
      connectServerNostrClient([dead], 'dead-relay-case')
    );
    try {
      assert.deepEqual(client.getConnectedRelays(), []);
      assert.ok(
        warnings.some((w) => w.includes('[server-nostr] dead-relay-case: reached 0 of 1 relays')),
        `expected the no-relay warning, got ${JSON.stringify(warnings)}`
      );
    } finally {
      await client.disconnect();
    }
  });
});

// --- RelayManager: a connect that loses the timeout race -------------------

test('a relay that connects after the timeout is closed, not leaked', async () => {
  await installNodeWebSocket();
  const { url, wss } = await startRelay({ handshakeDelayMs: 300 });

  // Resolves when the server sees the late socket close again.
  const closedByClient = new Promise<void>((resolve) => {
    wss.on('connection', (socket: any) => socket.on('close', () => resolve()));
  });

  await withLocalRelays([url], async () => {
    const manager = new RelayManager();
    await assert.rejects(manager.connect(url, { timeout: 50 }), /Connection timeout/);
    assert.deepEqual(manager.getConnectedRelays(), []);
  });

  const outcome = await Promise.race([
    closedByClient.then(() => 'closed'),
    new Promise<string>((resolve) => setTimeout(() => resolve('still open'), 3000)),
  ]);
  assert.equal(outcome, 'closed', 'the late connection stayed open with nothing holding it');
});

// --- the guard -------------------------------------------------------------

/**
 * The bug was six routes each opening relays their own way. A route that
 * constructs a client directly skips the WebSocket install and fails the same
 * silent way on the next one.
 */
test('app/api opens relays only through connectServerNostrClient', () => {
  const root = new URL('../../', import.meta.url);
  const files = readdirSync(new URL('app/api/', root), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => `app/api/${f}`);
  assert.ok(files.length > 100, `expected the API routes, found ${files.length} files`);

  for (const file of files) {
    const source = readFileSync(new URL(file, root), 'utf8');
    assert.doesNotMatch(
      source,
      /\bnew\s+(NostrClient|RelayManager|SimplePool)\s*\(|\bcreateNostrClient\s*\(|\bRelay\.connect\s*\(/,
      `${file} opens a relay directly — use connectServerNostrClient, or it runs on undici's WebSocket (or none)`
    );
  }
});
