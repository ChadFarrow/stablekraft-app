#!/usr/bin/env tsx
/**
 * The favorites loop through REAL SIGNERS, in a real browser, with nothing
 * real at the other end: a throwaway key, a local relay and a local database.
 *
 *   npm run e2e:signers
 *
 * WHY THIS EXISTS: `e2e:favorites` drives the merge with a raw secret key, and
 * the browser runs before it stood a NIP-07 object in for the signer. Neither
 * touched a real signer, so the parts a real one changes — the extension's
 * permission prompts, NIP-46 round trips through a relay, NIP-44 over either —
 * were exercised by nobody but the user, on their real list. This script runs
 * both real kinds, end to end, and reads every step off the relay and the rows:
 *
 *   - NIP-07: nos2x, the published Chrome Web Store build, loaded into a
 *     headless Chrome. Its key is pasted into its own options page, and its
 *     permission prompts are answered by clicking "authorize forever".
 *   - NIP-46: `nak bunker`, a real remote signer, on the same throwaway key,
 *     signed in through the login modal's "Bunker URI" card.
 *
 * For each signer: favorite an album and one of its tracks, unfavorite the
 * album, reload, wait — then the page, /favorites, the kind 10333 event and the
 * database must agree. Then switch the list to Private (NIP-44) and do it again
 * on a second album, reading the private half by decrypting it with the key.
 *
 * NOTHING HERE CAN REACH PRODUCTION, and the script checks that rather than
 * assuming it:
 *   - DATABASE_URL is built from `.env` (or E2E_DATABASE_URL) and the script
 *     refuses any host but loopback. It is passed to the server explicitly,
 *     and `@next/env` never overwrites a variable that is already set, so the
 *     Railway URL in `.env.local` is never read. `npm run dev:isolated` on its
 *     own does NOT do this — it isolates the relays only, and its hearts land
 *     in the production database.
 *   - The only relay is a local one. The app sees it through a TLS proxy
 *     (wss://127.0.0.1), because the NIP-46 client accepts only wss://.
 *   - Every browser request to a production host is blocked and counted, and
 *     the count must be zero.
 *
 * Needs: Google Chrome (CHROME_PATH to override), a local Postgres (Homebrew's
 * is started for the run and stopped after if it was not running), `openssl`.
 * nak and nos2x are downloaded ONCE into ~/.cache/stablekraft-e2e, pinned by
 * sha256, and reused after that.
 *
 * Ports: app 3011, relay 7791, its TLS proxy 7792 (E2E_APP_PORT,
 * E2E_RELAY_PORT). E2E_HEADED=1 shows the browser. E2E_ONLY=nip07 or
 * E2E_ONLY=nip46 runs one signer. On a failure the app, relay and nak logs are
 * kept in $TMPDIR/sk-e2e-signers-logs and the path is printed.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import WebSocket from 'ws';
import { PrismaClient } from '@prisma/client';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { nip19, nip44 } from 'nostr-tools';
import { SINGLE_LIST_KIND, LIST_ALT, decodePrivateFavorites } from '../lib/nostr/favorites-single-list';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const APP_PORT = Number(process.env.E2E_APP_PORT || 3011);
const RELAY_PORT = Number(process.env.E2E_RELAY_PORT || 7791);
const TLS_PORT = RELAY_PORT + 1;
const APP = `http://localhost:${APP_PORT}`;
const RELAY_WS = `ws://127.0.0.1:${RELAY_PORT}`;
const RELAY_WSS = `wss://127.0.0.1:${TLS_PORT}`;
const DB_NAME = 'sk_e2e_signers';
const DIST_DIR = '.next-e2e-signers';
const TOOLS = process.env.E2E_TOOLS_DIR || path.join(os.homedir(), '.cache', 'stablekraft-e2e');
const HEADED = process.env.E2E_HEADED === '1';
const ONLY = process.env.E2E_ONLY || '';
if (ONLY && ONLY !== 'nip07' && ONLY !== 'nip46') throw new Error(`E2E_ONLY must be nip07 or nip46, not ${ONLY}`);

const NAK_VERSION = 'v0.22.3';
const NAK_SHA256: Record<string, string> = {
  'darwin-arm64': '76f3dac8a2967aa756312674d69c0edfff6380ac4328ea5e5c36ba45f1ed3e1f',
  'darwin-amd64': '5a7d3f4cd8d64445bed5379de9a21e4247b46aa1c401daee1c858304d95d104a',
  'linux-amd64': '2eb9a16f86c865275983459b2c705d22d5dfbcf527026a279449cbf204d164fe',
};
// The Chrome Web Store build. When the store moves past this version the
// hash stops matching and the script says so — review the new build, then
// update the pin.
const NOS2X = {
  id: 'kpgefcfmnafjgpblomihpgmejjdanjjp',
  version: '2.5.2',
  sha256: 'a96fa0b233ccc067c8ad0f90a08c0a903b79a09f3f95b5bb442e818c7caa3c05',
};
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');

/** Hosts the browser must never reach during the run. */
const PRODUCTION_RE = /(^|\.)stablekraft\.app$|(^|\.)rlwy\.net$|(^|\.)railway\.app$/i;
const PRODUCTION_BLOCK = ['*stablekraft.app*', '*rlwy.net*', '*railway.app*'];

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

let failures = 0;
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  ❌ ${msg}`);
};
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : bad(msg));
const note = (msg: string) => console.log(`  ·  ${msg}`);
const section = (msg: string) => console.log(`\n${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Fatal extends Error {}
const fatal = (msg: string): never => {
  throw new Fatal(msg);
};

// ---------------------------------------------------------------------------
// Processes and cleanup — stop everything this run starts, whatever happens
// ---------------------------------------------------------------------------

const STARTED = Date.now();
const RUN = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-signers-'));
const children: { name: string; proc: ChildProcess; group: boolean }[] = [];
const cleanups: { name: string; fn: () => Promise<void> | void }[] = [];

function start(
  name: string,
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; log: string; group?: boolean },
): ChildProcess {
  const out = fs.openSync(opts.log, 'a');
  const proc = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', out, out],
    detached: !!opts.group,
  });
  fs.closeSync(out);
  children.push({ name, proc, group: !!opts.group });
  return proc;
}

function exited(proc: ChildProcess, ms: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

async function stopChild(c: { name: string; proc: ChildProcess; group: boolean }) {
  const kill = (sig: NodeJS.Signals) => {
    try {
      if (c.group && c.proc.pid) process.kill(-c.proc.pid, sig);
      else c.proc.kill(sig);
    } catch {
      /* already gone */
    }
  };
  if (c.proc.exitCode !== null || c.proc.signalCode !== null) return;
  kill('SIGTERM');
  if (!(await exited(c.proc, 10000))) {
    kill('SIGKILL');
    await exited(c.proc, 5000);
  }
}

let cleanedUp = false;

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  const runOne = async (c: (typeof cleanups)[number]) => {
    try {
      await c.fn();
    } catch (err) {
      console.log(`  ⚠️  cleanup "${c.name}" failed: ${(err as Error).message}`);
    }
  };
  // 1. Chrome first, and only through Browser.close: on macOS a signal leaves a
  //    1.4 GB code-sign copy behind.
  for (const c of cleanups.filter((c) => c.name === 'close Chrome')) await runOne(c);
  // 2. Every other process. The dev server must be gone before its database is
  //    dropped (it holds connections) and its build folder deleted (it rewrites it).
  for (const c of [...children].reverse()) await stopChild(c);
  // 3. The rest, newest first: TLS front, Prisma, the database, Postgres, the folders.
  for (const c of [...cleanups].reverse().filter((c) => c.name !== 'close Chrome')) await runOne(c);
  if (failures) {
    const keep = path.join(process.env.TMPDIR || os.tmpdir(), 'sk-e2e-signers-logs');
    fs.rmSync(keep, { recursive: true, force: true });
    fs.mkdirSync(keep, { recursive: true });
    for (const f of fs.readdirSync(RUN).filter((f) => f.endsWith('.log'))) fs.copyFileSync(path.join(RUN, f), path.join(keep, f));
    console.log(`  the logs of this failed run are in ${keep}`);
  }
  fs.rmSync(RUN, { recursive: true, force: true });
}

const tail = (file: string, lines = 30) => {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

async function until<T>(
  fn: () => Promise<T | null | undefined | false> | T | null | undefined | false,
  timeoutMs: number,
  what: string,
  every = 500,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  let lastErr = '';
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      lastErr = (err as Error).message;
    }
    if (Date.now() > end) return fatal(`timed out after ${timeoutMs / 1000}s waiting for ${what}${lastErr ? ` (${lastErr})` : ''}`);
    await sleep(every);
  }
}

const sha256File = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function run(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    ok: r.status === 0,
    out: `${r.stdout || ''}${r.stderr || ''}`.trim(),
    error: r.error,
  };
}

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=\s*"?([^"\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tools: nak and nos2x, downloaded once and pinned
// ---------------------------------------------------------------------------

async function download(url: string, to: string) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fatal(`download failed: HTTP ${res.status} for ${url}`);
  fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

async function ensureNak(): Promise<string> {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const platform = `${process.platform}-${arch}`;
  const want = NAK_SHA256[platform] ?? fatal(`no pinned nak build for ${platform}`);
  const file = path.join(TOOLS, `nak-${NAK_VERSION}-${platform}`);
  if (!fs.existsSync(file) || sha256File(file) !== want) {
    note(`downloading nak ${NAK_VERSION} (${platform}) once into ${TOOLS}`);
    fs.mkdirSync(TOOLS, { recursive: true });
    await download(`https://github.com/fiatjaf/nak/releases/download/${NAK_VERSION}/nak-${NAK_VERSION}-${platform}`, `${file}.part`);
    const got = sha256File(`${file}.part`);
    if (got !== want) {
      fs.rmSync(`${file}.part`, { force: true });
      fatal(`nak sha256 mismatch: got ${got}, pinned ${want}`);
    }
    fs.renameSync(`${file}.part`, file);
    fs.chmodSync(file, 0o755);
  }
  return file;
}

async function ensureNos2x(): Promise<string> {
  const crx = path.join(TOOLS, `nos2x-${NOS2X.version}.crx`);
  const dir = path.join(TOOLS, `nos2x-${NOS2X.version}`);
  if (!fs.existsSync(crx) || sha256File(crx) !== NOS2X.sha256) {
    note(`downloading nos2x ${NOS2X.version} from the Chrome Web Store once into ${TOOLS}`);
    fs.mkdirSync(TOOLS, { recursive: true });
    await download(
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=158.0&acceptformat=crx2,crx3&x=id%3D${NOS2X.id}%26uc`,
      `${crx}.part`,
    );
    const got = sha256File(`${crx}.part`);
    if (got !== NOS2X.sha256) {
      fs.rmSync(`${crx}.part`, { force: true });
      fatal(
        `the nos2x the Web Store serves is not the pinned ${NOS2X.version} build (sha256 ${got}). ` +
          'Review the new version, then update NOS2X in scripts/e2e-signers.ts.',
      );
    }
    fs.renameSync(`${crx}.part`, crx);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    fs.mkdirSync(dir, { recursive: true });
    // A CRX is a zip behind a header; unzip warns about the header and copes.
    run('unzip', ['-oq', crx, '-d', dir]);
    // Chrome refuses an unpacked extension holding a name that starts with "_"
    // (the store's signature folder). Nothing else is changed.
    fs.rmSync(path.join(dir, '_metadata'), { recursive: true, force: true });
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) fatal(`could not unpack ${crx}`);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Database — local only, refused otherwise
// ---------------------------------------------------------------------------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function localDatabaseUrl(): string {
  const base = process.env.E2E_DATABASE_URL || readEnvFile(path.join(ROOT, '.env')).DATABASE_URL;
  if (!base) fatal('no DATABASE_URL in .env and no E2E_DATABASE_URL — point one at a LOCAL Postgres');
  const u = new URL(base);
  if (!LOOPBACK.has(u.hostname)) fatal(`refusing a database on ${u.hostname}: this test writes rows, so it runs on loopback only`);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
}

function pgArgs(url: string) {
  const u = new URL(url);
  const args = ['-h', u.hostname, '-p', u.port || '5432'];
  if (u.username) args.push('-U', decodeURIComponent(u.username));
  return {
    args,
    env: u.password ? { PGPASSWORD: decodeURIComponent(u.password) } : {},
  };
}

async function setUpDatabase(url: string) {
  const { args, env } = pgArgs(url);
  if (!run('pg_isready', args, env).ok) {
    const dataDir =
      process.env.E2E_PGDATA ||
      ['/opt/homebrew/var/postgresql@14', '/opt/homebrew/var/postgresql@16', '/usr/local/var/postgresql@14'].find((d) =>
        fs.existsSync(path.join(d, 'PG_VERSION')),
      );
    if (!dataDir) fatal('no Postgres answers on loopback, and no Homebrew data directory was found (set E2E_PGDATA)');
    note(`starting Postgres from ${dataDir} for this run`);
    const started = run('pg_ctl', ['-D', dataDir, '-l', path.join(RUN, 'postgres.log'), '-w', 'start']);
    if (!started.ok) fatal(`pg_ctl start failed: ${started.out}`);
    cleanups.push({
      name: 'stop Postgres',
      fn: () => void run('pg_ctl', ['-D', dataDir, '-m', 'fast', 'stop']),
    });
  }
  run('dropdb', [...args, '--if-exists', DB_NAME], env);
  const created = run('createdb', [...args, DB_NAME], env);
  if (!created.ok) fatal(`createdb failed: ${created.out}`);
  cleanups.push({
    name: 'drop the test database',
    fn: () => {
      const dropped = run('dropdb', [...args, '--if-exists', DB_NAME], env);
      if (!dropped.ok) throw new Error(dropped.out);
    },
  });
  // `migrate deploy` cannot build an empty database from this repo's history;
  // `db push` builds it from the schema.
  const pushed = run(path.join(ROOT, 'node_modules', '.bin', 'prisma'), ['db', 'push', '--skip-generate'], { DATABASE_URL: url });
  if (!pushed.ok) fatal(`prisma db push failed: ${pushed.out}`);
}

type Album = {
  id: string;
  guid: string;
  title: string;
  tracks: { id: string; guid: string; title: string; audioUrl: string }[];
};

function makeAlbum(letter: string, titles: string[]): Album {
  const id = `sk-e2e-album-${letter.toLowerCase()}`;
  return {
    id,
    guid: crypto.randomUUID(),
    title: `SK E2E Album ${letter}`,
    tracks: titles.map((title, i) => {
      const guid = crypto.randomUUID();
      return {
        id: `${id}-t${i + 1}`,
        guid,
        title,
        audioUrl: `https://example.invalid/${guid}.mp3`,
      };
    }),
  };
}

async function seedCatalog(prisma: PrismaClient, albums: Album[]) {
  for (const a of albums) {
    await prisma.feed.create({
      data: {
        id: a.id,
        guid: a.guid,
        title: a.title,
        artist: 'SK E2E Artist',
        originalUrl: `https://example.invalid/${a.id}.xml`,
        type: 'album',
        medium: 'music',
        status: 'active',
        updatedAt: new Date(),
      },
    });
    for (const [i, t] of a.tracks.entries()) {
      await prisma.track.create({
        data: {
          id: t.id,
          guid: t.guid,
          title: t.title,
          audioUrl: t.audioUrl,
          feedId: a.id,
          trackOrder: i + 1,
          duration: 180,
          updatedAt: new Date(),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Relay: the repo's local relay, plus a TLS front for the NIP-46 client
// ---------------------------------------------------------------------------

function startTlsProxy(): Promise<void> {
  const key = path.join(RUN, 'relay.key');
  const cert = path.join(RUN, 'relay.crt');
  const made = run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
  ]);
  if (!made.ok) fatal(`openssl could not make a certificate: ${made.out}`);
  const sockets = new Set<net.Socket>();
  const server = tls.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (client) => {
    const upstream = net.connect(RELAY_PORT, '127.0.0.1');
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', drop).on('close', drop);
    upstream.on('error', drop).on('close', drop);
  });
  cleanups.push({
    name: 'stop the TLS proxy',
    fn: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(TLS_PORT, '127.0.0.1', () => resolve());
  });
}

function relayRequest(filter: Record<string, unknown>): Promise<Event[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS);
    const events: Event[] = [];
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('no EOSE from the local relay within 5s'));
    }, 5000);
    ws.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
    ws.on('open', () => ws.send(JSON.stringify(['REQ', 'e2e', filter])));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] === 'EVENT') events.push(msg[2]);
      if (msg[0] === 'EOSE') {
        clearTimeout(t);
        ws.close();
        resolve(events);
      }
    });
  });
}

function relayPublish(event: Event): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS);
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('no OK from the local relay within 5s'));
    }, 5000);
    ws.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] !== 'OK') return;
      clearTimeout(t);
      ws.close();
      msg[2] ? resolve() : reject(new Error(`relay refused: ${msg[3]}`));
    });
  });
}

// ---------------------------------------------------------------------------
// The list, as this test reads it
// ---------------------------------------------------------------------------

type ListView = {
  event: Event;
  /** `i` tags in the public tags. */
  pub: string[][];
  /** `i` tags in the decrypted private half; null when content would not decrypt. */
  priv: string[][] | null;
  privTags: string[][] | null;
  visibility: string | null;
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const has = (list: string[][] | null, tag: string[]) => !!list?.some((t) => same(t, tag));
const feedTag = (guid: string) => ['i', `podcast:guid:${guid}`];
const itemTag = (feedGuid: string, itemGuid: string) => ['i', `podcast:guid:${feedGuid}`, `podcast:item:guid:${itemGuid}`];
const entriesFor = (list: string[][] | null, itemGuid: string) =>
  (list ?? []).filter((t) => t[t.length - 1] === `podcast:item:guid:${itemGuid}`);

/** The medium in force at `tag`, under the running-medium rule. */
function mediumOf(tags: string[][], tag: string[]): string | null {
  let medium: string | null = null;
  for (const t of tags) {
    if (t[0] === 'medium') medium = t[1];
    if (same(t, tag)) return medium;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chrome over a CDP pipe — `--load-extension` is gone from branded Chrome, and
// `Extensions.loadUnpacked` answers only on a pipe
// ---------------------------------------------------------------------------

type CdpMessage = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
  sessionId?: string;
};

class Browser {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  private handlers: ((m: CdpMessage) => void)[] = [];
  private constructor(
    private proc: ChildProcess,
    readonly profile: string,
  ) {
    let buf = '';
    (proc.stdio[4] as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const m: CdpMessage = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id)!;
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
          else p.resolve(m.result);
        } else for (const h of this.handlers) h(m);
      }
    });
  }

  static async launch(): Promise<Browser> {
    const id = process.env.CLAUDE_CODE_SESSION_ID ? `${process.env.CLAUDE_CODE_SESSION_ID}-signers` : `e2e-signers-${process.pid}`;
    const profile = path.join(process.env.TMPDIR || os.tmpdir(), `chrome-${id}`);
    const args = [
      ...(HEADED ? [] : ['--headless=new']),
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      // Without it, each start on macOS clones the app bundle into $TMPDIR (1.4 GB).
      '--disable-features=MacAppCodeSignClone',
      `--user-data-dir=${profile}`,
      // The relay's TLS front has a certificate made for this run.
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--window-size=1280,900',
      'about:blank',
    ];
    const proc = spawn(CHROME, args, {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    children.push({ name: 'Chrome', proc, group: false });
    const browser = new Browser(proc, profile);
    cleanups.push({ name: 'close Chrome', fn: () => browser.close() });
    await until(() => browser.send('Browser.getVersion'), 20000, 'Chrome to answer on the pipe');
    return browser;
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = ++this.nextId;
    const msg: CdpMessage & { method: string; params: unknown } = {
      id,
      method,
      params,
    };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      (this.proc.stdio[3] as NodeJS.WritableStream).write(JSON.stringify(msg) + '\0');
    });
  }

  on(fn: (m: CdpMessage) => void) {
    this.handlers.push(fn);
  }

  /** Browser.close (which also removes any app-bundle clone), wait, then delete the profile. */
  async close() {
    if (this.proc.exitCode === null && this.proc.signalCode === null) {
      await Promise.race([this.send('Browser.close').catch(() => {}), sleep(5000)]);
      if (!(await exited(this.proc, 15000))) {
        this.proc.kill('SIGKILL');
        await exited(this.proc, 5000);
      }
    }
    fs.rmSync(this.profile, { recursive: true, force: true });
  }
}

/** Page-side helpers: find controls the way a person reads them. */
const PAGE_HELPERS = `(() => {
  const vis = (el) => !!(el && (el.offsetParent || (el.getClientRects && el.getClientRects().length)));
  const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').replace(/\\s+/g, ' ').trim();
  const all = (sel) => [...document.querySelectorAll(sel || 'button,a,[role=button],[role=radio],[role=tab]')].filter(vis);
  window.__sk = {
    label,
    labels: (sel) => all(sel).map(label).filter(Boolean).slice(0, 80),
    find: (src, flags, sel) => { const re = new RegExp(src, flags || ''); return all(sel).find((e) => re.test(label(e))) || null; },
    click: (src, flags, sel) => { const e = window.__sk.find(src, flags, sel); if (!e) return false; e.click(); return true; },
    text: () => (document.body ? document.body.innerText : ''),
    // Each visible heart, with the track title it belongs to, or 'album'.
    hearts: (titles) => all('button')
      .filter((b) => /^(Add to|Remove from) favorites$/.test(b.getAttribute('aria-label') || ''))
      .map((b) => {
        let n = b, owner = 'album';
        while (n && n !== document.body) {
          const t = n.textContent || '';
          const hits = titles.filter((x) => t.includes(x));
          if (hits.length === 1) { owner = hits[0]; break; }
          if (hits.length > 1) break;
          n = n.parentElement;
        }
        return { owner, on: (b.getAttribute('aria-label') || '').startsWith('Remove'), el: b };
      }),
  };
})();`;

type Page = Awaited<ReturnType<typeof openPage>>;
const productionHits: string[] = [];

async function openPage(browser: Browser, browserContextId?: string) {
  const { targetId } = await browser.send('Target.createTarget', {
    url: 'about:blank',
    ...(browserContextId ? { browserContextId } : {}),
  });
  const { sessionId } = await browser.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const s = (method: string, params?: Record<string, unknown>) => browser.send(method, params, sessionId);
  const consoleLines: string[] = [];
  browser.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Network.requestWillBeSent') {
      try {
        if (PRODUCTION_RE.test(new URL(m.params.request.url).hostname)) productionHits.push(m.params.request.url);
      } catch {
        /* data: and the like */
      }
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a: any) => a.value ?? a.description ?? '').join(' ');
      const wanted = m.params.type === 'error' || m.params.type === 'warning' || /favorites|Favorites|NIP-46/.test(text);
      if (!wanted) return;
      consoleLines.push(`${((Date.now() - STARTED) / 1000).toFixed(1)}s ${m.params.type}: ${text}`.slice(0, 300));
      if (consoleLines.length > 60) consoleLines.shift();
    }
  });
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  await s('Network.setBlockedURLs', { urls: PRODUCTION_BLOCK }).catch(() =>
    s('Network.setBlockedURLs', {
      urlPatterns: PRODUCTION_BLOCK.map((urlPattern) => ({
        urlPattern,
        block: true,
      })),
    }).catch(() => note('this Chrome refuses Network.setBlockedURLs; production requests are still counted')),
  );
  await s('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS });

  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await s('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value as T;
  };
  const waitFor = <T = any>(expression: string, timeoutMs: number, what: string) =>
    until<T>(() => evaluate<T>(expression), timeoutMs, what);
  const goto = async (url: string) => {
    await s('Page.navigate', { url });
    await waitFor(
      `document.readyState === 'complete' && !!window.__sk && location.href.startsWith(${JSON.stringify(url.split('?')[0])})`,
      180000,
      `${url} to load`,
    );
  };
  return {
    targetId,
    sessionId,
    s,
    evaluate,
    waitFor,
    goto,
    consoleLines,
    close: () => browser.send('Target.closeTarget', { targetId }),
  };
}

// ---------------------------------------------------------------------------
// nos2x: key set through its own options page; prompts answered as a person would
// ---------------------------------------------------------------------------

async function setUpNos2x(browser: Browser, dir: string, nsec: string): Promise<{ extId: string; prompts: string[] }> {
  const { id: extId } = await browser.send('Extensions.loadUnpacked', {
    path: dir,
  });
  const options = await openPage(browser);
  await options.goto(`chrome-extension://${extId}/options.html`);
  await options.waitFor(`!!document.querySelector('input')`, 20000, 'the nos2x options page');
  await options.evaluate(`document.querySelector('input').focus()`);
  await options.s('Input.insertText', { text: nsec });
  await options.waitFor(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'save' && !b.disabled)`,
    10000,
    'the nos2x save button',
  );
  await options.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'save').click()`);
  const stored = await options.waitFor<string>(
    `chrome.storage.local.get('private_key').then((r) => r.private_key || '')`,
    10000,
    'nos2x to store the key',
  );
  await options.close();

  const prompts: string[] = [];
  const seen = new Set<string>();
  const answer = async (targetId: string, url: string) => {
    if (seen.has(targetId)) return;
    seen.add(targetId);
    const type = new URL(url).searchParams.get('type') || '?';
    const { sessionId } = await browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    // "authorize forever" for a key or crypto request; for a signature nos2x
    // offers "authorize kind N forever" instead, scoped to that event kind.
    for (let i = 0; i < 60; i++) {
      const r = await browser
        .send(
          'Runtime.evaluate',
          {
            expression: `(() => { const b = [...document.querySelectorAll('button')].find((b) => /^authorize (kind \\d+ )?forever$/.test(b.textContent.trim())); if (!b) return null; const label = b.textContent.trim(); b.click(); return label; })()`,
            returnByValue: true,
          },
          sessionId,
        )
        .catch(() => null);
      const label: string | null = r?.result?.value ?? null;
      if (label) {
        const kind = label.match(/kind (\d+)/)?.[1];
        prompts.push(kind ? `${type} (kind ${kind})` : type);
        return;
      }
      await sleep(250);
    }
    bad(`a nos2x prompt (${type}) showed no "authorize … forever" button`);
  };
  browser.on((m) => {
    if (m.method !== 'Target.targetCreated' && m.method !== 'Target.targetInfoChanged') return;
    const t = m.params.targetInfo;
    if (t.type === 'page' && t.url.startsWith(`chrome-extension://${extId}/prompt.html`)) void answer(t.targetId, t.url);
  });
  await browser.send('Target.setDiscoverTargets', { discover: true });
  if (!stored) fatal('nos2x did not store the key');
  return { extId, prompts };
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

type Ctx = {
  prisma: PrismaClient;
  sk: Uint8Array;
  pk: string;
  convo: Uint8Array;
  albums: [Album, Album];
  foreign: string[][];
  /** What to print when the list does not arrive: the page console, the signer's log. */
  diag?: () => Promise<string>;
  /** Heart taps whose own publish reached the relay, per signer. */
  taps: { total: number; lost: string[] };
};

async function readList(ctx: Ctx): Promise<ListView | null> {
  const events = await relayRequest({
    kinds: [SINGLE_LIST_KIND],
    authors: [ctx.pk],
  });
  const event = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!event) return null;
  let privTags: string[][] | null = [];
  if (event.content) {
    try {
      privTags = decodePrivateFavorites(nip44.decrypt(event.content, ctx.convo));
    } catch {
      privTags = null;
    }
  }
  return {
    event,
    pub: event.tags.filter((t) => t[0] === 'i'),
    privTags,
    priv: privTags ? privTags.filter((t) => t[0] === 'i') : null,
    visibility: event.tags.find((t) => t[0] === 'visibility')?.[1] ?? null,
  };
}

/** The list once it satisfies `pred`, or null after `timeoutMs`. Reports nothing. */
async function pollList(ctx: Ctx, pred: (v: ListView) => boolean, timeoutMs: number): Promise<ListView | null> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await readList(ctx).catch(() => null);
    if (v && pred(v)) return v;
    if (Date.now() > end) return null;
    await sleep(750);
  }
}

async function waitList(ctx: Ctx, pred: (v: ListView) => boolean, what: string, timeoutMs = 60000): Promise<ListView> {
  const end = Date.now() + timeoutMs;
  let last: ListView | null = null;
  for (;;) {
    last = await readList(ctx).catch(() => last);
    if (last && pred(last)) return last;
    if (Date.now() > end) {
      bad(`the list never showed ${what} within ${timeoutMs / 1000}s`);
      if (last) note(`last event ${last.event.id.slice(0, 12)}…: public ${JSON.stringify(last.pub)} private ${JSON.stringify(last.priv)}`);
      if (ctx.diag) console.log((await ctx.diag()).replace(/^/gm, '     | '));
      return last ?? fatal('no list event at all on the local relay');
    }
    await sleep(750);
  }
}

async function rows(ctx: Ctx) {
  const user = await ctx.prisma.user.findUnique({
    where: { nostrPubkey: ctx.pk },
  });
  if (!user)
    return {
      user: null as null | { id: string },
      albums: [] as string[],
      tracks: [] as string[],
    };
  const albums = await ctx.prisma.favoriteAlbum.findMany({
    where: { userId: user.id },
    select: { feedId: true },
  });
  const tracks = await ctx.prisma.favoriteTrack.findMany({
    where: { userId: user.id },
    select: { trackId: true },
  });
  return {
    user,
    albums: albums.map((r) => r.feedId),
    tracks: tracks.map((r) => r.trackId),
  };
}

const isAlbum = (a: Album) => (id: string) => id === a.id || id === a.guid;
const isTrack = (t: Album['tracks'][number]) => (id: string) => id === t.id || id === t.guid || id === t.audioUrl;

async function checkRows(ctx: Ctx, want: { albums: Album[]; tracks: Album['tracks'][number][] }, label: string) {
  const r = await rows(ctx);
  const albumsOk = r.albums.length === want.albums.length && want.albums.every((a) => r.albums.some(isAlbum(a)));
  const tracksOk = r.tracks.length === want.tracks.length && want.tracks.every((t) => r.tracks.some(isTrack(t)));
  check(
    !!r.user && albumsOk && tracksOk,
    `database ${label}: ${r.albums.length} album favorite(s), ${r.tracks.length} track favorite(s)` +
      (albumsOk && tracksOk ? '' : ` — expected ${want.albums.length} and ${want.tracks.length}`),
  );
}

function checkForeign(ctx: Ctx, v: ListView, half: 'public' | 'private') {
  const list = half === 'public' ? v.pub : v.priv;
  const missing = ctx.foreign.filter((t) => !has(list, t));
  check(
    missing.length === 0,
    `the other app's ${ctx.foreign.length} entries are still on the list (${half} half)${missing.length ? ` — missing ${JSON.stringify(missing)}` : ''}`,
  );
  if (half === 'public') {
    const m = mediumOf(v.event.tags, ctx.foreign[0]);
    check(m === 'podcast', `the other app's feed is still under medium "podcast" (${m})`);
  }
}

async function heartsOf(p: Page, album: Album) {
  const titles = JSON.stringify(album.tracks.map((t) => t.title));
  return p.evaluate<{ owner: string; on: boolean }[]>(`__sk.hearts(${titles}).map(({ owner, on }) => ({ owner, on }))`);
}

async function tapHeart(p: Page, album: Album, owner: string) {
  const titles = JSON.stringify(album.tracks.map((t) => t.title));
  const r = await p.evaluate<string>(
    `(() => { const h = __sk.hearts(${titles}).filter((x) => x.owner === ${JSON.stringify(owner)}); if (h.length !== 1) return 'found ' + h.length; h[0].el.click(); return 'ok'; })()`,
  );
  if (r !== 'ok')
    fatal(`the ${owner === 'album' ? 'album' : `"${owner}"`} heart: ${r} (hearts: ${JSON.stringify(await heartsOf(p, album))})`);
}

async function waitHeart(p: Page, album: Album, owner: string, on: boolean, timeoutMs = 20000) {
  const titles = JSON.stringify(album.tracks.map((t) => t.title));
  return until(
    () => p.evaluate<boolean>(`__sk.hearts(${titles}).some((x) => x.owner === ${JSON.stringify(owner)} && x.on === ${on})`),
    timeoutMs,
    `the ${owner === 'album' ? 'album' : `"${owner}"`} heart to turn ${on ? 'on' : 'off'}`,
  );
}

async function openAlbum(p: Page, album: Album) {
  await p.goto(`${APP}/album/${album.id}`);
  await p.waitFor(
    `__sk.text().includes(${JSON.stringify(album.title)}) && __sk.hearts(${JSON.stringify(album.tracks.map((t) => t.title))}).length >= ${album.tracks.length + 1}`,
    180000,
    `the album page of ${album.title}`,
  );
  // The hearts render before the session is read; a tap before then is a guest favorite.
  await p.waitFor(`!!__sk.find('^User Menu$')`, 60000, 'the User Menu');
  await sleep(1500);
}

/** The album-and-one-track cycle, read off the page, the relay and the rows. */
/**
 * After a heart tap: the list as the tap's own publish leaves it.
 *
 * A tap that does not publish within 30s is counted (the signer's summary
 * fails on it) and the page is reloaded, because every page load syncs the
 * list — so the #257 checks still run on what the merge produces. Under NIP-46
 * that is the path a real user is on today: the client's own per-method rate
 * limit THROWS when the per-item kind 30001 publish and the list publish ask
 * for a signature within ~500ms of each other, which one tap does.
 */
async function afterTap(ctx: Ctx, p: Page, album: Album, pred: (v: ListView) => boolean, what: string): Promise<ListView> {
  ctx.taps.total++;
  const quick = await pollList(ctx, pred, 30000);
  if (quick) return quick;
  ctx.taps.lost.push(what);
  note(`the heart tap did not publish ${what} within 30s`);
  if (ctx.diag) console.log((await ctx.diag()).replace(/^/gm, '     | '));
  for (let i = 1; i <= 3; i++) {
    note(`reload ${i} of 3, which syncs the list on load`);
    await openAlbum(p, album);
    const v = await pollList(ctx, pred, 30000);
    if (v) return v;
  }
  return waitList(ctx, pred, what, 5000);
}

async function albumCycle(ctx: Ctx, p: Page, album: Album, half: 'public' | 'private', keptTracks: Album['tracks'][number][]) {
  const track = album.tracks[0];
  const list = (v: ListView) => (half === 'public' ? v.pub : v.priv);
  const other = (v: ListView) => (half === 'public' ? v.priv : v.pub);

  await openAlbum(p, album);
  const before = await heartsOf(p, album);
  check(before.filter((h) => h.on).length === 0, `${album.title}: every heart starts empty (${before.length} hearts)`);

  await tapHeart(p, album, 'album');
  await waitHeart(p, album, 'album', true);
  await tapHeart(p, album, track.title);
  await waitHeart(p, album, track.title, true);
  let v = await afterTap(
    ctx,
    p,
    album,
    (x) => has(list(x), feedTag(album.guid)) && has(list(x), itemTag(album.guid, track.guid)),
    `the album and "${track.title}" in the ${half} half`,
  );
  check(has(list(v), feedTag(album.guid)), `favorited: the album's feed entry is on the list (${half} half)`);
  check(has(list(v), itemTag(album.guid, track.guid)), `favorited: "${track.title}" is on the list and names the album's feed`);
  if (half === 'public') check(mediumOf(v.event.tags, feedTag(album.guid)) === 'music', 'favorited: the album sits under medium "music"');
  check((other(v) ?? []).length === 0, `favorited: nothing is in the ${half === 'public' ? 'private' : 'public'} half`);
  checkForeign(ctx, v, half);
  await checkRows(ctx, { albums: [album], tracks: [...keptTracks, track] }, 'after the two hearts');

  // The case #257 exists for: give up the album, keep its track.
  await tapHeart(p, album, 'album');
  await waitHeart(p, album, 'album', false);
  v = await afterTap(
    ctx,
    p,
    album,
    (x) => !has(list(x), feedTag(album.guid)) && has(list(x), itemTag(album.guid, track.guid)),
    `the album's feed entry gone with "${track.title}" kept`,
  );
  check(!has(list(v), feedTag(album.guid)), "unfavorited: the album's feed entry is GONE from the event");
  const entries = entriesFor(list(v), track.guid);
  check(
    entries.length === 1 && same(entries[0], itemTag(album.guid, track.guid)),
    `unfavorited: "${track.title}" is still there, once, and still names the album's feed (${JSON.stringify(entries)})`,
  );
  for (const kept of keptTracks) {
    const e = entriesFor(list(v), kept.guid);
    check(e.length === 1 && e[0].length === 3, `unfavorited: the earlier track "${kept.title}" is unchanged (${JSON.stringify(e)})`);
  }
  check((other(v) ?? []).length === 0, `unfavorited: nothing is in the ${half === 'public' ? 'private' : 'public'} half`);
  checkForeign(ctx, v, half);
  await checkRows(ctx, { albums: [], tracks: [...keptTracks, track] }, 'after the album heart went off');

  // Reload and wait: the reconcile must not bring the album back, and an
  // unchanged list must not be published again.
  const id = v.event.id;
  await openAlbum(p, album);
  await sleep(12000);
  const after = await heartsOf(p, album);
  check(
    after.some((h) => h.owner === 'album' && !h.on) &&
      after.some((h) => h.owner === track.title && h.on) &&
      after.filter((h) => h.on).length === 1,
    `after a reload: the album heart is empty and only "${track.title}" is filled`,
  );
  const v2 = await readList(ctx);
  check(
    v2?.event.id === id,
    `after a reload: no republish (event ${id.slice(0, 12)}… ${v2?.event.id === id ? 'unchanged' : `became ${v2?.event.id.slice(0, 12)}…`})`,
  );
  await checkRows(ctx, { albums: [], tracks: [...keptTracks, track] }, 'after the reload');

  // /favorites: the album is not listed, the tracks are.
  await p.goto(`${APP}/favorites`);
  await p.waitFor(`!!__sk.find('^Tracks')`, 120000, 'the /favorites tabs');
  await sleep(3000);
  const albumsTab = await p.evaluate<string>('__sk.text()');
  check(!albumsTab.includes(album.title), `/favorites: ${album.title} is not under Albums`);
  await p.evaluate(`__sk.click('^Tracks')`);
  const want = [...keptTracks, track].map((t) => t.title);
  const tracksTab = await until(
    async () => {
      const text = await p.evaluate<string>('__sk.text()');
      return want.every((t) => text.includes(t)) ? text : null;
    },
    30000,
    `/favorites to list ${JSON.stringify(want)}`,
  ).catch((err) => {
    bad((err as Error).message);
    return '';
  });
  if (tracksTab) ok(`/favorites: Tracks lists ${want.map((t) => `"${t}"`).join(' and ')}`);
  return v2 ?? v;
}

async function switchToPrivate(ctx: Ctx, p: Page, keptTracks: Album['tracks'][number][]) {
  await p.goto(`${APP}/settings`);
  await p.waitFor(`!!__sk.find('^Private$', '', '[role=radio],button')`, 120000, 'the Private choice in Settings');
  await sleep(1500);
  await p.evaluate(`__sk.click('^Private$', '', '[role=radio],button')`);
  const v = await waitList(
    ctx,
    (x) => x.visibility === 'private' && x.pub.length === 0 && !!x.priv && x.priv.length > 0,
    'the whole list moved into the private half',
    120000,
  );
  check(v.visibility === 'private', 'Private: the event states visibility "private"');
  check(v.pub.length === 0, `Private: no \`i\` tag is left in the public tags (${v.pub.length})`);
  check(!!v.event.content && v.priv !== null, `Private: content is ${v.event.content.length} bytes of NIP-44 that decrypts with the key`);
  checkForeign(ctx, v, 'private');
  for (const t of keptTracks) {
    const e = entriesFor(v.priv, t.guid);
    check(e.length === 1 && e[0].length === 3, `Private: "${t.title}" moved into the private half with its feed (${JSON.stringify(e)})`);
  }
  check(!/podcast:item:guid|podcast:guid/.test(JSON.stringify(v.event.tags)), 'Private: no guid at all is left readable in the tags');
}

async function signIn(p: Page, how: 'extension' | 'bunker', ctx: Ctx, bunkerUri?: string) {
  await p.goto(`${APP}/`);
  await p.waitFor(`!!__sk.find('^User Menu$')`, 180000, 'the User Menu');
  await sleep(1500);
  await p.evaluate(`__sk.click('^User Menu$')`);
  await p.waitFor(`!!__sk.find('Sign in with Nostr', 'i')`, 15000, '"Sign in with Nostr"');
  await p.evaluate(`__sk.click('Sign in with Nostr', 'i')`);
  if (how === 'extension') {
    await p.waitFor(`!!__sk.find('Browser Extension')`, 15000, 'the Browser Extension card');
    await p.evaluate(`__sk.click('Browser Extension')`);
  } else {
    await p.waitFor(`!!__sk.find('Bunker URI')`, 15000, 'the Bunker URI card');
    await p.evaluate(`__sk.click('Bunker URI')`);
    await p.waitFor(
      `!!document.querySelector('textarea[placeholder^="bunker://"],input[placeholder^="bunker://"]')`,
      15000,
      'the bunker URI field',
    );
    await p.evaluate(`document.querySelector('textarea[placeholder^="bunker://"],input[placeholder^="bunker://"]').focus()`);
    await p.s('Input.insertText', { text: bunkerUri });
    await sleep(300);
    const clicked = await p.evaluate<boolean>(`__sk.click('^Connect', 'i')`);
    if (!clicked) fatal(`no Connect button beside the bunker field (buttons: ${JSON.stringify(await p.evaluate('__sk.labels()'))})`);
  }
  const me = await until(
    () =>
      p.evaluate<string | null>(
        `fetch('/api/nostr/auth/me', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((j) => j && (j.user?.nostrPubkey || j.nostrPubkey) || null).catch(() => null)`,
      ),
    120000,
    'the server session after sign-in',
  );
  check(me === ctx.pk, `signed in through the real modal; the server session is the throwaway key (${me?.slice(0, 12)}…)`);
}

async function runSigner(ctx: Ctx, name: string, p: Page, how: 'extension' | 'bunker', bunkerUri?: string) {
  // On a failure: the page's favorites lines, this device's published record (what the merge
  // believes WE put on the list), and the signer's own log.
  ctx.diag = async () => {
    const record = await p
      .evaluate<string>(`localStorage.getItem('sk_single_list_published:${ctx.pk}') || '(none)'`)
      .catch((err) => `(unreadable: ${(err as Error).message})`);
    const claims = ctx.albums.map((a) => `${a.title} ${record.includes(a.guid) ? 'CLAIMED' : 'not claimed'}`).join(', ');
    return (
      `page console (favorites lines, last 25):\n${p.consoleLines.slice(-25).join('\n')}\n` +
      `published record: ${claims}\n${record.slice(0, 700)}` +
      (how === 'bunker' ? `\nnak log (last lines):\n${tail(path.join(RUN, 'nak.log'), 15)}` : '')
    );
  };
  section(`${name}: sign in`);
  await signIn(p, how, ctx, bunkerUri);
  const start = await readList(ctx);
  check(!!start && ctx.foreign.every((t) => has(start.pub, t)), "the other app's list is there after sign-in");

  section(`${name}: public — favorite ${ctx.albums[0].title} and a track, then unfavorite the album`);
  await albumCycle(ctx, p, ctx.albums[0], 'public', []);

  section(`${name}: switch to Private (NIP-44)`);
  await switchToPrivate(ctx, p, [ctx.albums[0].tracks[0]]);

  section(`${name}: private — the same cycle on ${ctx.albums[1].title}`);
  await albumCycle(ctx, p, ctx.albums[1], 'private', [ctx.albums[0].tracks[0]]);

  section(`${name}: heart taps`);
  const { total, lost } = ctx.taps;
  check(
    lost.length === 0,
    `${total - lost.length} of ${total} heart taps published the list by themselves` +
      (lost.length ? ` — the page had to be reloaded for: ${lost.join('; ')}` : ''),
  );
  ctx.taps = { total: 0, lost: [] };
}

/** Back to the starting line: no favorite rows, and the other app's list as the newest event. */
async function reset(ctx: Ctx) {
  const user = await ctx.prisma.user.findUnique({
    where: { nostrPubkey: ctx.pk },
  });
  if (user) {
    await ctx.prisma.favoriteAlbum.deleteMany({ where: { userId: user.id } });
    await ctx.prisma.favoriteTrack.deleteMany({ where: { userId: user.id } });
  }
  const current = await readList(ctx);
  await seedList(ctx, Math.max(Math.floor(Date.now() / 1000), (current?.event.created_at ?? 0) + 1));
}

async function seedList(ctx: Ctx, createdAt: number) {
  const event = finalizeEvent(
    {
      kind: SINGLE_LIST_KIND,
      created_at: createdAt,
      content: '',
      tags: [['alt', LIST_ALT], ['medium', 'podcast'], ...ctx.foreign, ['k', 'podcast:guid']],
    },
    ctx.sk,
  );
  await relayPublish(event);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'scripts', 'e2e-signers.ts'))) fatal('run this from the repo root: npm run e2e:signers');
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'next'))) fatal('node_modules is missing — run `npm ci` first');
  if (!fs.existsSync(CHROME)) fatal(`no Chrome at ${CHROME} (set CHROME_PATH)`);
  for (const port of [APP_PORT, RELAY_PORT, TLS_PORT]) if (!(await portFree(port))) fatal(`port ${port} is in use`);

  const tsconfig = fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8');
  cleanups.push({
    name: 'restore tsconfig.json and remove the build folder',
    fn: () => {
      // `next dev` adds its dist folder's types to tsconfig.json; put it back.
      if (fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8') !== tsconfig)
        fs.writeFileSync(path.join(ROOT, 'tsconfig.json'), tsconfig);
      fs.rmSync(path.join(ROOT, DIST_DIR), { recursive: true, force: true });
    },
  });

  section('Setup');
  const [nak, nos2xDir] = [await ensureNak(), await ensureNos2x()];
  ok(`nak ${NAK_VERSION} and nos2x ${NOS2X.version}, both matching their pinned sha256`);

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const skHex = Buffer.from(sk).toString('hex');
  note(`throwaway key ${nip19.npubEncode(pk).slice(0, 20)}…`);

  const dbUrl = localDatabaseUrl();
  await setUpDatabase(dbUrl);
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  cleanups.push({ name: 'disconnect Prisma', fn: () => prisma.$disconnect() });
  const albums: [Album, Album] = [
    makeAlbum('A', ['Aurora Line', 'Amber Coast', 'Atlas Road']),
    makeAlbum('B', ['Birch Hollow', 'Basalt Rain', 'Bell Tower']),
  ];
  await seedCatalog(prisma, albums);
  ok(`local database ${new URL(dbUrl).host}/${DB_NAME}: two albums of three tracks`);

  start('local relay', 'node', [path.join(ROOT, 'scripts', 'local-relay.mjs')], {
    env: { PORT: String(RELAY_PORT) },
    log: path.join(RUN, 'relay.log'),
  });
  await until(() => relayRequest({ kinds: [0], limit: 1 }).then(() => true), 15000, 'the local relay');
  await startTlsProxy();
  ok(`local relay ${RELAY_WS}, and ${RELAY_WSS} in front of it`);

  const ctx: Ctx = {
    taps: { total: 0, lost: [] },
    prisma,
    sk,
    pk,
    convo: nip44.getConversationKey(sk, pk),
    albums,
    // Another app's entries: a podcast feed, and a kind this app does not model.
    foreign: [
      ['i', `podcast:guid:${crypto.randomUUID()}`],
      ['i', `podcast:publisher:guid:${crypto.randomUUID()}`],
    ],
  };
  await seedList(ctx, Math.floor(Date.now() / 1000) - 600);
  ok("another app's list seeded under the throwaway key");

  const appLog = path.join(RUN, 'app.log');
  start('next dev', path.join(ROOT, 'node_modules', '.bin', 'next'), ['dev', '-p', String(APP_PORT)], {
    env: {
      DATABASE_URL: dbUrl,
      NEXT_DIST_DIR: DIST_DIR,
      NEXT_PUBLIC_NOSTR_RELAYS: RELAY_WSS,
      NEXT_PUBLIC_SHARED_FAVORITES_PUBKEYS: pk,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_SECRET: crypto.randomBytes(24).toString('hex'),
      // Server routes reach the same relay through the TLS front.
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    log: appLog,
    group: true,
  });
  cleanups.push({
    name: 'show the app log on failure',
    fn: () => void (failures && console.log(`\n--- app log (last lines) ---\n${tail(appLog)}`)),
  });
  await until(() => fetch(`${APP}/api/version`).then((r) => r.ok), 180000, `the app on ${APP}`, 1000);
  ok(`app on ${APP} (next dev, DATABASE_URL on loopback, relays ${RELAY_WSS} only)`);

  const browser = await Browser.launch();
  const { prompts } = await setUpNos2x(browser, nos2xDir, nip19.nsecEncode(sk));
  ok(`Chrome ${(await browser.send('Browser.getVersion')).product}, nos2x loaded with the throwaway key through its options page`);

  // ---------------------------------------------------------------- NIP-07
  if (ONLY !== 'nip46') {
    const p7 = await openPage(browser);
    await runSigner(ctx, 'NIP-07 (nos2x)', p7, 'extension');
    const kinds = [...new Set(prompts)];
    // nos2x 2.5.2 hands out the public key without asking; everything else asks once.
    check(
      [`signEvent (kind ${SINGLE_LIST_KIND})`, 'nip44.encrypt', 'nip44.decrypt'].every((k) => kinds.includes(k)),
      `nos2x asked, and was answered, for: ${kinds.join(', ')}`,
    );
    await p7.close();
  }

  // ---------------------------------------------------------------- NIP-46
  if (ONLY !== 'nip07') {
    section('NIP-46 (nak bunker): start from the same line');
    await reset(ctx);
    const secret = crypto.randomBytes(16).toString('hex');
    const nakLog = path.join(RUN, 'nak.log');
    start('nak bunker', nak, ['bunker', '-s', secret, RELAY_WS], {
      env: { NOSTR_SECRET_KEY: skHex },
      log: nakLog,
    });
    const announced = await until(() => tail(nakLog, 50).match(/bunker:\/\/([0-9a-f]{64})/)?.[1], 20000, 'nak to print its bunker URI');
    check(announced === pk, 'nak bunker serves the throwaway key');
    const bunkerUri = `bunker://${pk}?relay=${encodeURIComponent(RELAY_WSS)}&secret=${secret}`;
    // A fresh browser context: no nos2x, no window.nostr, no stored session or published record.
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const p46 = await openPage(browser, browserContextId);
    await p46.goto(`${APP}/api/version`);
    check(
      (await p46.evaluate<boolean>('typeof window.nostr === "undefined"')) === true,
      'no NIP-07 provider in this context, so nothing but the bunker can sign',
    );
    await runSigner(ctx, 'NIP-46 (nak bunker)', p46, 'bunker', bunkerUri);
    const nakText = tail(nakLog, 400);
    for (const method of ['connect', 'sign_event', 'nip44_encrypt', 'nip44_decrypt']) {
      check(nakText.includes(method), `nak handled ${method}`);
    }
    await p46.close();
  }

  section('Isolation');
  check(
    productionHits.length === 0,
    `the browser sent ${productionHits.length} request(s) to a production host${productionHits.length ? `: ${productionHits.slice(0, 3).join(', ')}` : ''}`,
  );
  const user = await prisma.user.findUnique({ where: { nostrPubkey: pk } });
  check(!!user, `the server wrote its rows to the local database (${DB_NAME} holds the throwaway user)`);
}

main()
  .catch((err) => {
    failures++;
    console.log(`\n  ❌ ${err instanceof Fatal ? err.message : (err as Error).stack}`);
  })
  .finally(async () => {
    section('Cleanup');
    await cleanup();
    console.log('  stopped every process this run started, and removed its database, profile and build folder');
    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });

process.on('SIGINT', () => {
  failures++;
  console.log('\ninterrupted');
  void cleanup().then(() => process.exit(130));
});
