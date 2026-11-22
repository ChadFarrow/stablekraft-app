/**
 * npm run e2e:block
 *
 * Browser test for <podcast:block> (lib/feeds/podcast-block.ts). Everything is on
 * loopback: a throwaway Postgres database, a local feed server whose block tags the
 * test changes between steps, `next dev` on 3001 with DATABASE_URL pointed at that
 * database, and headless Chrome. Nothing touches production, no podping is sent,
 * and nothing goes to Podcast Index. The one outside read is HeyCitizen's public
 * test feed (it declares a bare `no`); the step is skipped when that host is down.
 *
 * Steps: refuse a new blocked feed (bare yes, our slug) and add an open one and a
 * google-only one; a refresh that adds a bare yes hides the album everywhere; a
 * manual Hide Feed survives the feed lifting its block; Restore brings it back; the
 * admin reparse (Step 5c) path writes the field too.
 *
 * Needs: a local Postgres (Homebrew's is started and stopped if none answers; set
 * E2E_PGDATA for another data directory), `.env` with a LOOPBACK DATABASE_URL (its
 * user is reused, the database name is swapped), Google Chrome (CHROME_PATH), and
 * ports 3001 and 8765 free. Stop any `npm run dev` first: it shares `.next`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-e2e-block-'));
const require = createRequire(path.join(ROOT, 'package.json'));
const puppeteer = require('puppeteer-core');

const DB = 'sk_block_e2e';
// The local user from .env (Prisma CLI's file), the database name swapped; never production.
const DB_URL = (() => {
  const base = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL="?([^"\n]+)"?/m)[1];
  const u = new URL(base);
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  u.pathname = `/${DB}`;
  return u.toString();
})();
const PGUSER = decodeURIComponent(new URL(DB_URL).username);
const PGDATA =
  process.env.E2E_PGDATA ||
  ['/opt/homebrew/var/postgresql@14', '/opt/homebrew/var/postgresql@16', '/usr/local/var/postgresql@14'].find((d) =>
    fs.existsSync(path.join(d, 'PG_VERSION'))
  );
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const APP = 'http://127.0.0.1:3001';
const FEEDS = 'http://127.0.0.1:8765';
const ADMIN = crypto.randomBytes(24).toString('hex');
// The session id in the profile path lets the leftover checks know whose Chrome it is.
const PROFILE = path.join(os.tmpdir(), `chrome-${process.env.CLAUDE_CODE_SESSION_ID || 'e2e'}-block`);
const HEYCITIZEN = 'https://files.heycitizen.xyz/Songs/Albums/TestAlbum/test.xml';

const cleanups = [];
let failures = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => { failures++; console.log(`  ✖ ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => run('psql', ['-h', 'localhost', '-U', PGUSER, '-d', DB, '-At', '-c', sql]).out.trim();

// --- feeds the test controls --------------------------------------------------
let albumBlocks = ''; // the block tags of /album.xml, changed between steps
const feedXml = (title, blocks, guid) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${title}</title>
    <itunes:author>Block Tester</itunes:author>
    <description>podcast:block e2e</description>
    <podcast:guid>${guid}</podcast:guid>
    <podcast:medium>music</podcast:medium>
    <item>
      <title>${title} Song One</title>
      <guid isPermaLink="false">${guid}-1</guid>
      <enclosure url="${FEEDS}/song.mp3" length="1000" type="audio/mpeg"/>
      <itunes:duration>00:03:00</itunes:duration>
    </item>
${blocks}
  </channel>
</rss>`;
const FEED_DEFS = {
  '/album.xml': () => feedXml('Blockflip Album', albumBlocks, '11111111-1111-4111-8111-111111111111'),
  '/blocked.xml': () => feedXml('Bareyes Album', '<podcast:block>yes</podcast:block>', '22222222-2222-4222-8222-222222222222'),
  '/named.xml': () => feedXml('Namedslug Album', '<podcast:block id="stablekraft">yes</podcast:block>', '33333333-3333-4333-8333-333333333333'),
  '/google.xml': () => feedXml('Googleonly Album', '<podcast:block id="google">yes</podcast:block>', '44444444-4444-4444-8444-444444444444'),
};

async function main() {
  // --- database ---------------------------------------------------------------
  if (!run('pg_isready', ['-h', 'localhost', '-p', '5432']).ok) {
    if (!PGDATA) throw new Error('no Postgres answers on loopback, and no Homebrew data directory was found (set E2E_PGDATA)');
    const s = run('pg_ctl', ['-D', PGDATA, '-l', path.join(SCRATCH, 'pg.log'), '-w', 'start']);
    if (!s.ok) throw new Error(`pg_ctl start: ${s.out}`);
    cleanups.push(['stop Postgres', () => run('pg_ctl', ['-D', PGDATA, '-m', 'fast', 'stop'])]);
  }
  run('dropdb', ['-h', 'localhost', '-U', PGUSER, '--if-exists', DB]);
  const created = run('createdb', ['-h', 'localhost', '-U', PGUSER, DB]);
  if (!created.ok) throw new Error(`createdb failed: ${created.out}`);
  cleanups.push(['drop database', () => run('dropdb', ['-h', 'localhost', '-U', PGUSER, '--if-exists', DB])]);
  const pushed = run(path.join(ROOT, 'node_modules/.bin/prisma'), ['db', 'push', '--skip-generate'], { DATABASE_URL: DB_URL });
  if (!pushed.ok) throw new Error(`db push: ${pushed.out}`);
  // Search uses trigram similarity; `db push` does not create extensions.
  psql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  check(psql(`select count(*) from pg_extension where extname='pg_trgm'`) === '1', 'pg_trgm present for search');
  check(psql(`select column_default from information_schema.columns where table_name='Feed' and column_name='blocked'`) === 'false', 'Feed.blocked exists, default false');

  // --- feed server ------------------------------------------------------------
  const server = http.createServer((req, res) => {
    const def = FEED_DEFS[req.url];
    if (!def) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
    res.end(def());
  });
  await new Promise((r) => server.listen(8765, '127.0.0.1', r));
  cleanups.push(['stop feed server', () => server.close()]);

  // --- app ----------------------------------------------------------------------
  const log = fs.openSync(path.join(SCRATCH, 'next.log'), 'w');
  const next = spawn(path.join(ROOT, 'node_modules/.bin/next'), ['dev', '-p', '3001', '-H', '127.0.0.1'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      ADMIN_SECRET: ADMIN,
      NEXT_PUBLIC_NOSTR_RELAYS: 'ws://127.0.0.1:7777',
    },
  });
  cleanups.push(['stop next dev', () => { try { process.kill(-next.pid, 'SIGTERM'); } catch {} }]);
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${APP}/api/version`); if (r.ok) break; } catch {}
    await sleep(1000);
  }

  const api = async (method, p, body, admin = false) => {
    const r = await fetch(`${APP}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
  const row = (url) => psql(`select id||'|'||blocked||'|'||"markedDead" from "Feed" where "originalUrl"='${url}'`);

  console.log('\n1. Adding feeds (POST /api/feeds)');
  let r = await api('POST', '/api/feeds', { originalUrl: `${FEEDS}/blocked.xml`, type: 'album' });
  check(r.status === 403 && r.json?.blocked === true, `bare yes → 403 blocked (got ${r.status})`);
  check(row(`${FEEDS}/blocked.xml`) === '', 'bare yes → no Feed row minted');
  r = await api('POST', '/api/feeds', { originalUrl: `${FEEDS}/named.xml`, type: 'album' });
  check(r.status === 403, `id="stablekraft" yes → 403 (got ${r.status})`);
  r = await api('POST', '/api/feeds', { originalUrl: `${FEEDS}/google.xml`, type: 'album' });
  check(r.status === 201, `id="google" yes → added (got ${r.status})`);
  check(/\|false\|false$/.test(row(`${FEEDS}/google.xml`)), 'google-only block → blocked=false');
  r = await api('POST', '/api/feeds', { originalUrl: `${FEEDS}/album.xml`, type: 'album' });
  check(r.status === 201, `no block → added (got ${r.status})`);
  const albumId = row(`${FEEDS}/album.xml`).split('|')[0];
  const heyCitizenUp = await fetch(HEYCITIZEN, { signal: AbortSignal.timeout(10000) }).then((x) => x.ok, () => false);
  if (heyCitizenUp) {
    r = await api('POST', '/api/feeds', { originalUrl: HEYCITIZEN, type: 'album' });
    check(r.status === 201, `HeyCitizen real feed (bare no) → added (got ${r.status}${r.json?.error ? ': ' + r.json.error : ''})`);
    check(/\|false\|false$/.test(row(HEYCITIZEN)), 'HeyCitizen → blocked=false');
  } else {
    console.log('  - HeyCitizen feed unreachable: its step is skipped');
  }

  // --- browser --------------------------------------------------------------------
  fs.rmSync(PROFILE, { recursive: true, force: true });
  // On macOS a chrome_crashpad_handler outlives Browser.close, reparented to launchd
  // (seen 2026-11-21). Note the ones running before the launch, and after the close
  // stop only a NEW orphan — never one that belongs to a Chrome someone else runs.
  const crashpads = () =>
    run('ps', ['-axo', 'pid=,ppid=,command=']).out.split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((m) => m && m[3].includes('chrome_crashpad_handler'))
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]) }));
  const crashpadsBefore = new Set(crashpads().map((c) => c.pid));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    // MacAppCodeSignClone: without it each start clones Chrome.app (1.4 GB) into the temp folder.
    args: ['--disable-features=MacAppCodeSignClone', `--user-data-dir=${PROFILE}`, '--no-first-run'],
  });
  cleanups.push(['close Chrome', async () => {
    await browser.close();
    fs.rmSync(PROFILE, { recursive: true, force: true });
    await sleep(1000);
    for (const c of crashpads()) {
      if (c.ppid === 1 && !crashpadsBefore.has(c.pid)) { try { process.kill(c.pid); } catch {} }
    }
  }]);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // A fresh visit each time: the home page keeps the catalog in client storage and
  // renders it before its own refetch lands, so clear ALL of it, then wait for the
  // catalog response itself before reading the grid.
  const cdp = await page.target().createCDPSession();
  let lastCatalogBody = '';
  const apiGridHas = async (title) => {
    const r = await fetch(`${APP}/api/albums-fast?limit=50&offset=0&tier=all&filter=all`);
    return (await r.text()).includes(title);
  };
  const homeText = async () => {
    await cdp.send('Storage.clearDataForOrigin', { origin: APP, storageTypes: 'all' });
    // The catalog response carries a max-age, so Chrome's HTTP cache would hand back
    // the previous step's body; that is the same for every hide, not this change.
    await cdp.send('Network.clearBrowserCache');
    const catalog = page.waitForResponse((res) => res.url().includes('/api/albums-fast') && res.status() === 200, { timeout: 120000 });
    await page.goto(`${APP}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const res = await catalog;
    lastCatalogBody = await res.text().catch(() => '');
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 60000 }).catch(() => {});
    await sleep(1500);
    return page.evaluate(() => document.body.innerText);
  };
  const albumPage = async (id) => {
    const resp = await page.goto(`${APP}/album/${id}`, { waitUntil: 'networkidle2', timeout: 120000 });
    await sleep(1500);
    return { status: resp?.status(), text: await page.evaluate(() => document.body.innerText) };
  };
  const searchHas = async (q, title) => {
    const s = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
    return JSON.stringify(s.json || {}).includes(title);
  };
  const trackSearchHas = async (q, title) => {
    const s = await api('GET', `/api/tracks/search?q=${encodeURIComponent(q)}`);
    return JSON.stringify(s.json || {}).includes(title);
  };
  const refresh = async () => api('POST', '/api/feeds/refresh-by-url', { originalUrl: `${FEEDS}/album.xml` }, true);

  console.log('\n2. Before any block: the album shows');
  let home = await homeText();
  check(home.includes('Blockflip Album'), 'home grid shows Blockflip Album');
  check(home.includes('Googleonly Album'), 'home grid shows Googleonly Album (blocks only google)');
  if (heyCitizenUp) check(home.includes("HeyCitizen's Test Album"), "home grid shows HeyCitizen's Test Album");
  check(!home.includes('Bareyes Album') && !home.includes('Namedslug Album'), 'refused feeds are nowhere on the grid');
  let ap = await albumPage(albumId);
  check(ap.text.includes('Blockflip Album Song One'), `album page /album/${albumId} lists its track`);
  check(await searchHas('Blockflip', 'Blockflip Album'), 'search finds Blockflip Album');

  console.log('\n3. The feed adds a bare yes; a podping refresh hides it');
  albumBlocks = '<podcast:block>yes</podcast:block>';
  r = await refresh();
  check(r.status === 200, `refresh-by-url → 200 (got ${r.status})`);
  check(row(`${FEEDS}/album.xml`) === `${albumId}|true|false`, 'Feed.blocked=true, markedDead untouched');
  check(!(await apiGridHas('Blockflip Album')), 'albums-fast API no longer lists Blockflip Album');
  home = await homeText();
  console.log(`    (browser got albums-fast with Blockflip: ${lastCatalogBody.includes('Blockflip Album')})`);
  check(!home.includes('Blockflip Album'), 'home grid no longer shows Blockflip Album');
  check(home.includes('Googleonly Album'), 'the other albums still show');
  ap = await albumPage(albumId);
  check(!ap.text.includes('Blockflip Album Song One'), `album page no longer shows the album (status ${ap.status})`);
  check(!(await searchHas('Blockflip', 'Blockflip Album')), 'search no longer finds it');
  check(!(await trackSearchHas('Blockflip', 'Blockflip Album Song One')), 'track search no longer finds its track');

  console.log('\n4. Chad hides it by hand while blocked; the feed then lifts its block');
  r = await api('POST', '/api/admin/feeds/mark-dead', { id: albumId, dead: true }, true);
  check(r.status === 200, `mark-dead (Hide Feed) → 200 (got ${r.status})`);
  albumBlocks = '<podcast:block>yes</podcast:block>\n    <podcast:block id="stablekraft">no</podcast:block>';
  r = await refresh();
  check(r.status === 200, `refresh-by-url → 200 (got ${r.status})`);
  check(row(`${FEEDS}/album.xml`) === `${albumId}|false|true`, 'Feed.blocked=false and markedDead STILL true (the manual hide stays)');
  home = await homeText();
  check(!home.includes('Blockflip Album'), 'still hidden on the grid: the manual hide wins');

  console.log('\n5. Chad restores it: it comes back');
  r = await api('POST', '/api/admin/feeds/mark-dead', { id: albumId, dead: false }, true);
  check(r.status === 200, `restore → 200 (got ${r.status})`);
  check(await apiGridHas('Blockflip Album'), 'albums-fast API lists Blockflip Album again');
  home = await homeText();
  console.log(`    (browser got albums-fast with Blockflip: ${lastCatalogBody.includes('Blockflip Album')})`);
  check(home.includes('Blockflip Album'), 'home grid shows Blockflip Album again');
  ap = await albumPage(albumId);
  check(ap.text.includes('Blockflip Album Song One'), 'album page shows it again');

  console.log('\n6. The block goes away entirely (no tag): it stays visible');
  albumBlocks = '';
  r = await refresh();
  check(row(`${FEEDS}/album.xml`) === `${albumId}|false|false`, 'no tag → blocked=false');

  // The nightly paths write the field too; a reparse of the blocked state through the admin route:
  console.log('\n7. Admin reparse route (the nightly Step 5c path) also hides it');
  albumBlocks = '<podcast:block id="stablekraft">yes</podcast:block>';
  r = await api('POST', `/api/admin/feeds/${encodeURIComponent(albumId)}/reparse`, {}, true);
  check(r.status === 200, `admin reparse → 200 (got ${r.status})`);
  check(row(`${FEEDS}/album.xml`) === `${albumId}|true|false`, 'admin reparse → blocked=true');

  const nextLog = fs.readFileSync(path.join(SCRATCH, 'next.log'), 'utf8');
  check(/podcast:block: .* now blocked \(hidden\)/.test(nextLog), 'server log names the flip');
  const crashes = nextLog.match(/uncaughtException|Unhandled Runtime Error|PrismaClientValidationError/g);
  check(!crashes, `no uncaught errors in the server log${crashes ? ': ' + crashes.join(', ') : ''}`);
}

try {
  await main();
} catch (e) {
  failures++;
  console.error('FATAL', e);
} finally {
  for (const [name, fn] of cleanups.reverse()) {
    try { await fn(); } catch (e) { console.error(`cleanup ${name} failed:`, e.message); }
  }
  if (failures) console.log(`\nLogs kept in ${SCRATCH}`);
  else fs.rmSync(SCRATCH, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}
