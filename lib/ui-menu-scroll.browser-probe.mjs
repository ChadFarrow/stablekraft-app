/**
 * Browser probe: is the UserMenu dropdown — and the Nostr LoginModal it opens —
 * fully reachable on a small phone with the UI zoomed in?
 *
 * WHY THIS EXISTS AS A COMMITTED FILE: both surfaces were `position: fixed` with
 * no height bound, so anything past the bottom of the screen was not merely
 * off-screen but *unreachable* — the document can't scroll a fixed element into
 * view and neither element could scroll internally. The last row of the dropdown
 * is "Sign in with Nostr", so on a Pixel 4a with Android's Display size turned up
 * and a wallet connected, logging in was impossible. Nothing about that is
 * visible at desktop sizes or at a 1.0 font scale, which is why it shipped.
 *
 *   npm run dev                                      # needs the dev server on :3000
 *   node lib/ui-menu-scroll.browser-probe.mjs
 *   WALLET_ROWS=0 node lib/ui-menu-scroll.browser-probe.mjs   # logged-out menu only
 *
 * puppeteer-core is not a declared dependency — it resolves transitively through
 * lighthouse. `npm i -D puppeteer-core` if that ever stops being true.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3000';
// Same default as nwc-backup.browser-probe.mjs (the maintainer is on macOS), with
// a Linux fallback so this also runs in a container. Override with CHROME_PATH.
const EXEC =
  process.env.CHROME_PATH ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
   '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
   '/usr/bin/chromium'].find(p => existsSync(p)) ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Pixel 4a is 393x851 at default density. "UI zoomed in" = Android Display size
// turned up, which shrinks the CSS viewport; Font size scales the root em on top.
const VIEWPORTS = [
  { name: 'pixel4a-default', w: 393, h: 851, scale: 1.0 },
  { name: 'pixel4a-zoomed', w: 320, h: 693, scale: 1.0 },
  { name: 'pixel4a-zoomed+font1.5', w: 320, h: 693, scale: 1.5 },
  { name: 'pixel4a-zoomed+font2.0', w: 320, h: 693, scale: 2.0 },
];

const SAFE_TOP = '24px';
const SAFE_BOTTOM = '48px';

const results = [];
const fail = (name, msg) => results.push({ ok: false, name, msg });
const pass = (name, msg) => results.push({ ok: true, name, msg });

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: 'new',
  // No 1.4 GB code-sign copy of Chrome on macOS: a killed probe leaves one (measured 2026-11-11).
  // puppeteer merges this into its own --disable-features list.
  args: ['--no-sandbox', '--disable-features=MacAppCodeSignClone', '--disable-dev-shm-usage'],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  // isMobile:false deliberately. With mobile emulation on, Chrome shrink-to-fits
  // the layout viewport when content overflows, so getBoundingClientRect stops
  // being in visual-viewport coordinates and every edge assertion measures
  // against the wrong number.
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1, isMobile: false, hasTouch: true });
  await page.goto(`${BASE}/about`, { waitUntil: 'networkidle2', timeout: 90_000 });

  // Insets + font scale injected AFTER goto — evaluateOnNewDocument appends to a
  // document navigation then replaces, which silently measures as inset-free.
  await page.addStyleTag({
    content: `:root{--safe-area-inset-top:${SAFE_TOP};--safe-area-inset-bottom:${SAFE_BOTTOM};}
              html{font-size:${16 * vp.scale}px !important;}`,
  });

  const harnessOk = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      top: cs.getPropertyValue('--sk-safe-top').trim(),
      bottom: cs.getPropertyValue('--sk-safe-bottom').trim(),
      fontSize: cs.fontSize,
    };
  });
  if (!/[1-9]/.test(harnessOk.top) || !/[1-9]/.test(harnessOk.bottom)) {
    fail(`${vp.name} harness`, `insets not applied: ${JSON.stringify(harnessOk)}`);
    await page.close();
    continue;
  }
  pass(`${vp.name} harness`, `insets ${harnessOk.top}/${harnessOk.bottom}, root ${harnessOk.fontSize}`);

  // ---- 1. UserMenu dropdown -------------------------------------------------
  await page.waitForSelector('button[title="User Menu"]', { timeout: 30_000 });
  const trigger = await page.evaluate(() => {
    const b = document.querySelector('button[title="User Menu"]');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const onTop = !!hit && (b === hit || b.contains(hit) || hit.contains(b));
    b.click();
    return { box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, onTop };
  });
  const tN = `${vp.name} UserMenu trigger`;
  if (trigger.onTop && trigger.box.top >= 0 && trigger.box.right <= vp.w + 0.5) {
    pass(tN, `hit-testable at ${JSON.stringify(trigger.box)}`);
  } else {
    fail(tN, `not reachable: ${JSON.stringify(trigger)}`);
  }
  await page.waitForFunction(
    () => !!Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Sign in with Nostr')),
    { timeout: 15_000 }
  );

  // The reported screenshot has a wallet CONNECTED, which swaps the single
  // "Connect Lightning Wallet" row for WalletInfoDisplay + Switch Wallet + NWC
  // Backup + Disconnect. A real NWC connection needs a live relay, so stand in
  // for its geometry by cloning existing rows (they scale with the root font
  // size the same way the real ones do). WALLET_ROWS=0 measures the logged-out
  // menu as-is.
  const extraRows = Number(process.env.WALLET_ROWS ?? 4);
  if (extraRows > 0) {
    await page.evaluate((n) => {
      const signIn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Sign in with Nostr'));
      let root = signIn;
      while (root && getComputedStyle(root).position !== 'fixed') root = root.parentElement;
      const connect = Array.from(root.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Connect Lightning Wallet'));
      const host = connect.parentElement;
      // Balance block: WalletInfoDisplay's name + balance + Fund button.
      const balance = document.createElement('div');
      balance.style.height = '7.5rem';
      balance.setAttribute('data-probe-wallet', 'balance');
      host.insertBefore(balance, connect);
      for (let i = 0; i < n; i++) {
        const row = connect.cloneNode(true);
        row.setAttribute('data-probe-wallet', 'row');
        host.insertBefore(row, connect);
      }
    }, extraRows);
  }

  const menu = await page.evaluate((vh) => {
    const signIn = Array.from(document.querySelectorAll('button')).find(b =>
      b.textContent?.includes('Sign in with Nostr'));
    // The dropdown is the nearest fixed ancestor of the sign-in row.
    let el = signIn;
    while (el && getComputedStyle(el).position !== 'fixed') el = el.parentElement;
    const r = el.getBoundingClientRect();
    const before = { scrollTop: el.scrollTop, signInTop: signIn.getBoundingClientRect().top };
    el.scrollTop = el.scrollHeight; // try to reach the bottom
    const s = signIn.getBoundingClientRect();
    return {
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      overflowY: getComputedStyle(el).overflowY,
      scrollable: el.scrollHeight > el.clientHeight,
      scrolled: el.scrollTop !== before.scrollTop,
      signInAfterScroll: { top: s.top, bottom: s.bottom, height: s.height },
      vh,
    };
  }, vp.h);

  const n = `${vp.name} UserMenu`;
  if (menu.box.top < 0 || menu.box.left < 0 || menu.box.right > vp.w + 0.5) {
    fail(n, `dropdown off-screen horizontally/top: ${JSON.stringify(menu.box)}`);
  } else if (menu.box.bottom > vp.h + 0.5) {
    fail(n, `dropdown bottom ${menu.box.bottom.toFixed(0)} exceeds viewport ${vp.h}`);
  } else {
    pass(n, `bounded: bottom ${menu.box.bottom.toFixed(0)} <= ${vp.h}, overflowY=${menu.overflowY}, scrollable=${menu.scrollable}`);
  }

  const sN = `${vp.name} UserMenu sign-in reachable`;
  const s = menu.signInAfterScroll;
  if (s.top >= 0 && s.bottom <= vp.h + 0.5 && s.height >= 44) {
    pass(sN, `fully visible after scroll (${s.top.toFixed(0)}–${s.bottom.toFixed(0)}), height ${s.height.toFixed(0)}px`);
  } else if (s.top >= 0 && s.bottom <= vp.h + 0.5) {
    pass(sN, `visible after scroll (${s.top.toFixed(0)}–${s.bottom.toFixed(0)}) but only ${s.height.toFixed(0)}px tall`);
  } else {
    fail(sN, `still unreachable after scrolling to end: ${JSON.stringify(s)} (scrollable=${menu.scrollable})`);
  }

  // ---- 2. LoginModal --------------------------------------------------------
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Sign in with Nostr'))?.click();
  });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('h2')).some(h => h.textContent?.trim() === 'Sign in with Nostr'),
    { timeout: 30_000 }
  );

  const modal = await page.evaluate(() => {
    const h2 = Array.from(document.querySelectorAll('h2')).find(h => h.textContent?.trim() === 'Sign in with Nostr');
    const card = h2.closest('div.overflow-y-auto') || h2.parentElement.parentElement;
    const r = card.getBoundingClientRect();
    const beforeTop = card.scrollTop;
    card.scrollTop = card.scrollHeight;
    const last = card.lastElementChild?.getBoundingClientRect() ?? null;
    return {
      box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
      overflowY: getComputedStyle(card).overflowY,
      scrollable: card.scrollHeight > card.clientHeight,
      reachedEnd: card.scrollTop + card.clientHeight >= card.scrollHeight - 1,
      scrolledBy: card.scrollTop - beforeTop,
      lastChildBottom: last ? last.bottom : null,
    };
  });

  const mN = `${vp.name} LoginModal`;
  if (modal.box.top < -0.5 || modal.box.bottom > vp.h + 0.5) {
    fail(mN, `card clipped by viewport: ${JSON.stringify(modal.box)} (vh ${vp.h})`);
  } else if (modal.box.left < -0.5 || modal.box.right > vp.w + 0.5) {
    fail(mN, `card clipped horizontally: ${JSON.stringify(modal.box)} (vw ${vp.w})`);
  } else if (modal.scrollable && !modal.reachedEnd) {
    fail(mN, `card cannot scroll to its end`);
  } else {
    pass(mN, `within viewport (${modal.box.top.toFixed(0)}–${modal.box.bottom.toFixed(0)} of ${vp.h}), overflowY=${modal.overflowY}, scrollable=${modal.scrollable}, scrolledBy=${modal.scrolledBy.toFixed(0)}`);
  }

  await page.close();
}

await browser.close();

let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.msg}`);
}
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
