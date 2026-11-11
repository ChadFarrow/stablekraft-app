/**
 * Browser probe for the wallet picker + NWC backup flows.
 *
 * The pure helpers are covered by `nwc-backup.test.ts` (node:test + tsx). Everything
 * that matters here, though, is browser behaviour: relay publishes, signer
 * capability detection, and which rows the UI decides to render. This drives the
 * real components so those can be asserted too.
 *
 * WHY THIS EXISTS AS A COMMITTED FILE: the worst bug in this feature — signing the
 * backup event and publishing it to *zero* relays while reporting success — passed
 * an earlier test that had stubbed WebSocket out entirely. The stub made the
 * assertion vacuous, and it read as a pass. The fake relay below therefore
 * ACCEPTS AND RECORDS events, so "did it publish?" is a real question with a real
 * answer. Do not replace it with a dead-socket stub.
 *
 * Run:
 *   npm run dev                     # in another shell — needs a live dev server
 *   node lib/nostr/nwc-backup.browser-probe.mjs
 *
 * Requires puppeteer-core, which resolves transitively via lighthouse. If that
 * ever disappears: npm i -D puppeteer-core
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const { finalizeEvent, generateSecretKey, getPublicKey } = require('nostr-tools/pure');

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.env.PROBE_ORIGIN || 'http://localhost:3000';

const NWC =
  'nostr+walletconnect://' + 'b'.repeat(64) + '?relay=wss%3A%2F%2Fr.example&secret=' + 'c'.repeat(64);

// A genuinely signed event, so nostr-tools' verifyEvent accepts it when the fake
// relay serves it back.
const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);
// The stub "cipher" below is deliberately NOT identity. An identity stub makes
// "was the plaintext published?" unanswerable — the ciphertext would contain the
// URI legitimately — and that is exactly the class of vacuous assertion this file
// exists to avoid. enc:<base64> is reversible by the stub and distinguishable
// from the raw string.
const stubEncrypt = (t) => 'enc:' + Buffer.from(t, 'utf8').toString('base64');
const BACKUP_EVENT = finalizeEvent(
  {
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'stablekraft:wallet:nwc']],
    content: stubEncrypt(JSON.stringify({ uri: NWC })),
  },
  sk
);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

/**
 * @param {object} opts
 * @param {boolean} opts.hasWallet     seed bc:config with an NWC connection
 * @param {boolean} opts.serveBackup   fake relay answers REQ with a backup event
 * @param {boolean} opts.acceptEvents  fake relay ACKs published events
 * @param {boolean} opts.nip44         expose window.nostr.nip44
 * @param {boolean} opts.pendingFlag   arm the post-login offer flag
 * @param {boolean} [opts.manuallyDisconnected] seed the manual-disconnect flag
 * @param {'extension'|'nip46'} opts.loginType
 */
function seedScript(opts) {
  const bcConfig = opts.hasWallet
    ? { connectorName: 'NWC', connectorType: 'nwc.generic', nwcUrl: NWC }
    : null;
  return `
    const PUBKEY = ${JSON.stringify(PUBKEY)};
    const BACKUP = ${JSON.stringify(BACKUP_EVENT)};
    localStorage.clear();
    localStorage.setItem('nostr_user', JSON.stringify({
      id: 'probe-user', nostrPubkey: PUBKEY, nostrNpub: 'npub1probe',
      displayName: 'Probe', avatar: null, relays: [], loginType: ${JSON.stringify(opts.loginType)},
    }));
    localStorage.setItem('nostr_login_type', ${JSON.stringify(opts.loginType)});
    ${bcConfig ? `localStorage.setItem('bc:config', JSON.stringify(${JSON.stringify(bcConfig)}));` : ''}
    ${opts.pendingFlag ? `localStorage.setItem('nostr_pending_nwc_backup_offer', PUBKEY);` : ''}
    ${opts.manuallyDisconnected ? `localStorage.setItem('wallet_manually_disconnected', 'true');` : ''}

    window.__published = [];
    window.__relaysHit = new Set();

    // Fake relay that speaks enough of the protocol to be meaningful: it answers
    // REQ (optionally with the backup) and ACKs EVENT so publishes are observable.
    class FakeWS {
      constructor(url) {
        this.url = url; this.readyState = 0;
        setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 5);
      }
      send(raw) {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg[0] === 'REQ') {
          const [, subId, filter = {}] = msg;
          if (${opts.serveBackup ? 'true' : 'false'} && (filter.kinds || []).includes(30078)) {
            this.onmessage && this.onmessage({ data: JSON.stringify(['EVENT', subId, BACKUP]) });
          }
          this.onmessage && this.onmessage({ data: JSON.stringify(['EOSE', subId]) });
        } else if (msg[0] === 'EVENT') {
          if (${opts.acceptEvents ? 'true' : 'false'}) {
            window.__published.push(msg[1]);
            window.__relaysHit.add(this.url);
            this.onmessage && this.onmessage({ data: JSON.stringify(['OK', msg[1].id, true, '']) });
          }
        }
      }
      close() { this.readyState = 3; this.onclose && this.onclose({}); }
      addEventListener() {} removeEventListener() {}
    }
    FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
    window.WebSocket = FakeWS;

    window.nostr = {
      getPublicKey: async () => PUBKEY,
      signEvent: async (e) => ({ ...e, id: 'd'.repeat(64), sig: 's'.repeat(128), pubkey: PUBKEY }),
      ${opts.nip44
        ? `nip44: {
             encrypt: async (_p, t) => 'enc:' + btoa(unescape(encodeURIComponent(t))),
             decrypt: async (_p, c) => decodeURIComponent(escape(atob(String(c).replace(/^enc:/, '')))),
           },`
        : ''}
    };
    window.webln = {
      enable: async () => {}, getInfo: async () => ({ node: { alias: 'probe' }, methods: ['keysend'] }),
      getBalance: async () => ({ balance: 1 }), keysend: async () => ({ preimage: 'p' }),
    };
  `;
}

async function openPage(browser, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument(new Function(seedScript(opts)));
  await page.goto(ORIGIN, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('button[title="User Menu"]', { timeout: 30000 });
  return page;
}

const clickByText = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes(t));
    if (b) { b.click(); return true; }
    return false;
  }, text);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  // No 1.4 GB code-sign copy of Chrome on macOS: a killed probe leaves one (measured 2026-11-11).
  // puppeteer merges this into its own --disable-features list.
  args: ['--no-sandbox', '--disable-features=MacAppCodeSignClone'],
});

try {
  // ── 1. The save actually reaches relays ────────────────────────────────
  {
    console.log('\n=== save publishes to relays ===');
    const page = await openPage(browser, {
      hasWallet: true, serveBackup: false, acceptEvents: true, nip44: true,
      pendingFlag: false, loginType: 'extension',
    });
    await wait(4000);
    await page.click('button[title="User Menu"]');
    await wait(6000);
    await clickByText(page, 'NWC Backup');
    await wait(1200);
    await clickByText(page, 'Save to Nostr');
    await wait(8000);
    const s = await page.evaluate(() => ({
      published: window.__published.map((e) => ({ kind: e.kind, content: e.content })),
      relays: window.__relaysHit.size,
    }));
    check('backup event reached at least one relay', s.published.some((e) => e.kind === 30078));
    check('reached more than one relay', s.relays > 1, `${s.relays} relays`);
    check(
      'no plaintext connection string was transmitted',
      !s.published.some((e) => String(e.content).includes('nostr+walletconnect://'))
    );
    check(
      'published content is the encrypt output',
      s.published.some((e) => String(e.content).startsWith('enc:'))
    );
    await page.close();
  }

  // ── 2. A save that reaches nothing must not claim success ──────────────
  {
    console.log('\n=== save with every relay refusing ===');
    const page = await openPage(browser, {
      hasWallet: true, serveBackup: false, acceptEvents: false, nip44: true,
      pendingFlag: false, loginType: 'extension',
    });
    await wait(4000);
    await page.click('button[title="User Menu"]');
    await wait(6000);
    await clickByText(page, 'NWC Backup');
    await wait(1200);
    await clickByText(page, 'Save to Nostr');
    await wait(10000);
    const s = await page.evaluate(() => ({
      published: window.__published.length,
      dialogOpen: !!document.querySelector('[role="dialog"][aria-label="Connect a Lightning wallet"]'),
      text: document.querySelector('[role="dialog"]')?.innerText || '',
    }));
    check('nothing was published', s.published === 0);
    check('modal stays open rather than reporting success', s.dialogOpen);
    check('an error is shown', /could not|couldn|relay/i.test(s.text));
    await page.close();
  }

  // ── 3. Auto-restore on sign-in when this device has no wallet ──────────
  {
    console.log('\n=== auto-restore after sign-in ===');
    const page = await openPage(browser, {
      hasWallet: false, serveBackup: true, acceptEvents: true, nip44: true,
      pendingFlag: true, loginType: 'extension',
    });
    await wait(16000);
    const s = await page.evaluate(() => ({ bc: localStorage.getItem('bc:config') }));
    check('wallet restored from the backup', !!s.bc && s.bc.includes('nostr+walletconnect'));
    await page.close();
  }

  // ── 4. A deliberate disconnect is not undone when no backup exists ─────
  //      (regression: the manual-disconnect flag used to be cleared before the
  //      existence check, silently reconnecting an extension wallet.)
  {
    console.log('\n=== no backup: manual disconnect survives sign-in ===');
    // Seeded in the page-init script, not set afterwards: evaluateOnNewDocument
    // re-runs localStorage.clear() on every navigation, so a post-load write
    // followed by a reload silently vanished.
    const page = await openPage(browser, {
      hasWallet: false, serveBackup: false, acceptEvents: true, nip44: true,
      pendingFlag: true, manuallyDisconnected: true, loginType: 'extension',
    });
    await wait(16000);
    const s = await page.evaluate(() => ({
      flag: localStorage.getItem('wallet_manually_disconnected'),
      bc: localStorage.getItem('bc:config'),
    }));
    check('manual-disconnect flag untouched', s.flag === 'true', `flag=${s.flag}`);
    check('no wallet silently connected', !s.bc);
    await page.close();
  }

  // ── 5. A signer that cannot encrypt hides the feature ──────────────────
  {
    console.log('\n=== signer without nip44 ===');
    const page = await openPage(browser, {
      hasWallet: true, serveBackup: true, acceptEvents: true, nip44: false,
      pendingFlag: false, loginType: 'extension',
    });
    await wait(4000);
    await page.click('button[title="User Menu"]');
    await wait(6000);
    const s = await page.evaluate(() => ({ text: document.body.innerText }));
    check('NWC Backup row is hidden', !s.text.includes('NWC Backup'));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\n✅ ALL PROBES PASS' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
