/**
 * Browser probe: can you reach the bottom of the Android battery hint modal?
 *
 * WHY THIS EXISTS AS A COMMITTED FILE: `AndroidBatteryHintModal` was a centred
 * card in a `fixed inset-0` backdrop with no height bound and no scroll of its
 * own. A fixed panel that outgrows the screen is not merely cut off — it is
 * unreachable, because the document cannot scroll a fixed element into view.
 * Reported from a Pixel 4a with Android's Display size turned up: the heading
 * was clipped off the top, the four steps filled the screen, and neither the
 * "Got it" button nor the close X could be reached by any gesture. The card
 * clips at BOTH ends, which is what centring does to an oversized child, so
 * only half the content is missing in the direction you would look for it.
 *
 *   npm run dev                                        # needs a dev server
 *   node lib/android-battery-hint-modal.browser-probe.mjs
 *   PROBE_BASE=http://127.0.0.1:3007 node lib/android-battery-hint-modal.browser-probe.mjs
 *
 * The modal is opened the way AudioContext opens it — by dispatching the
 * `android-battery-hint` CustomEvent — so the probe drives the real component
 * mounted by `app/layout.tsx`, with no audio and no gating to satisfy. It only
 * reads layout.
 *
 * puppeteer-core is not a declared dependency — it resolves transitively through
 * lighthouse. `npm i -D puppeteer-core` if that ever stops being true.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3000';
const EXEC =
  process.env.CHROME_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p)) ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Stand-ins for the native shell's status bar and gesture bar. The card's
// height bound and the backdrop's padding both subtract these, so a probe that
// leaves them at 0 cannot tell a correct fix from one that ignores the insets.
const SAFE_TOP = 24;
const SAFE_BOTTOM = 48;

// isMobile stays false: with mobile emulation on, Chrome shrink-to-fits the
// layout viewport as soon as content overflows horizontally, so
// getBoundingClientRect() stops being in visual-viewport coordinates and every
// edge assertion below compares against the wrong number.
//
// The heights are the VISIBLE viewport, browser toolbar already subtracted —
// that is the number `dvh` resolves to and the one `vh` does not. 320x693 at
// 2.0x is Android Display size and font size both turned up, which is the
// reported device.
const VIEWPORTS = [
  { name: 'pixel4a 393x693', w: 393, h: 693, scale: 1.0 },
  { name: 'pixel4a 393x693 font1.5', w: 393, h: 693, scale: 1.5 },
  { name: 'zoomed 320x693 font1.5', w: 320, h: 693, scale: 1.5 },
  { name: 'zoomed 320x693 font2.0', w: 320, h: 693, scale: 2.0 },
  { name: 'short 360x520 font2.0', w: 360, h: 520, scale: 2.0 },
  { name: 'desktop 1280x900', w: 1280, h: 900, scale: 1.0 },
];

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const results = [];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, isMobile: false, deviceScaleFactor: 1 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });

  // After goto, never evaluateOnNewDocument: navigation replaces the document
  // the style was appended to, and every inset then measures as 0px.
  await page.addStyleTag({
    content:
      `html { --safe-area-inset-top: ${SAFE_TOP}px; --safe-area-inset-bottom: ${SAFE_BOTTOM}px;` +
      (vp.scale !== 1.0 ? ` font-size: ${16 * vp.scale}px;` : '') +
      ' }',
  });

  // Trust nothing until the harness itself is proven: a var that resolves to
  // 0px would make an inset-blind fix look correct.
  const insets = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      top: cs.getPropertyValue('--sk-safe-top').trim(),
      bottom: cs.getPropertyValue('--sk-safe-bottom').trim(),
    };
  });
  if (!insets.top.startsWith(String(SAFE_TOP)) || !insets.bottom.startsWith(String(SAFE_BOTTOM))) {
    throw new Error(`harness broken: --sk-safe-* resolved to ${insets.top}/${insets.bottom}`);
  }

  // This is exactly how AudioContext opens it.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('android-battery-hint')));
  await page.waitForSelector('button[aria-label="Close"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 300));

  const measured = await page.evaluate(() => {
    const close = document.querySelector('button[aria-label="Close"]');
    const card = close.closest('div[class*="rounded-xl"]');
    const backdrop = card.parentElement;
    const heading = card.querySelector('h2');
    const got = [...card.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('Got it')
    );
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) };
    };

    // The close X is measured unscrolled: it is the top of the card, and the
    // question about it is whether the heading runs underneath it.
    const atTop = { card: box(card), heading: box(heading), close: box(close) };

    // What a user does when the card is taller than the screen. If the card
    // cannot scroll, scrollTop stays 0 and the button stays off screen.
    card.scrollTop = card.scrollHeight;
    const scrolled = { scrollTop: Math.round(card.scrollTop), got: box(got) };

    // Is the button the thing actually under the finger, or is something
    // painting over it?
    const cx = (scrolled.got.left + scrolled.got.right) / 2;
    const cy = (scrolled.got.top + scrolled.got.bottom) / 2;
    const hit = document.elementFromPoint(cx, cy);

    card.scrollTop = 0;

    return {
      ...atTop,
      ...scrolled,
      cardScrollH: Math.round(card.scrollHeight),
      cardClientH: Math.round(card.clientHeight),
      overflows: card.scrollHeight > card.clientHeight + 1,
      gotHit: hit ? (got.contains(hit) || hit === got) : false,
      backdropPadTop: Math.round(parseFloat(getComputedStyle(backdrop).paddingTop)),
      backdropPadBottom: Math.round(parseFloat(getComputedStyle(backdrop).paddingBottom)),
      innerH: window.innerHeight,
      innerW: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
    };
  });

  results.push({ vp: vp.name, ...measured });
  await page.close();
}

await browser.close();

let failed = false;
for (const r of results) {
  const checks = [];
  const check = (ok, msg) => {
    checks.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
    if (!ok) failed = true;
  };

  console.log(
    `\n${r.vp}  card=${r.card.h}px in ${r.innerH}px  content=${r.cardScrollH}px ` +
      `${r.overflows ? '(scrolls)' : '(fits)'}`
  );

  // Both ends, because a centred oversized card clips at both.
  check(r.card.top >= SAFE_TOP - 1, `card clears the status bar (top ${r.card.top} >= ${SAFE_TOP})`);
  check(
    r.card.bottom <= r.innerH - SAFE_BOTTOM + 1,
    `card clears the gesture bar (bottom ${r.card.bottom} <= ${r.innerH - SAFE_BOTTOM})`
  );
  check(r.heading.top >= SAFE_TOP - 1, `heading is on screen unscrolled (top ${r.heading.top})`);

  // The actual report: the button at the bottom could not be reached.
  check(
    !r.overflows || r.scrollTop > 0,
    `an oversized card scrolls (scrollTop ${r.scrollTop} of ${r.cardScrollH - r.cardClientH})`
  );
  check(
    r.got.top >= SAFE_TOP - 1 && r.got.bottom <= r.innerH - SAFE_BOTTOM + 1,
    `"Got it" is fully on screen once scrolled (${r.got.top}–${r.got.bottom})`
  );
  check(r.gotHit, `"Got it" is what a tap at its centre hits`);
  check(r.got.h >= 44, `"Got it" keeps a 44px touch target (${r.got.h})`);

  // The close X is in normal flow beside the heading, not absolutely placed
  // over it: at a 2.0x font scale an overlaid X sits on top of the first line
  // of a heading that has no room to avoid it.
  check(
    r.close.top >= SAFE_TOP - 1 && r.close.bottom <= r.innerH - SAFE_BOTTOM + 1,
    `the close X is on screen unscrolled (${r.close.top}–${r.close.bottom})`
  );
  check(
    r.heading.right <= r.close.left + 1,
    `the heading does not run under the close X (${r.heading.right} <= ${r.close.left})`
  );

  check(r.card.left >= 0 && r.card.right <= r.innerW, `card inside the left/right edges`);
  check(r.docScrollW <= r.innerW, `no horizontal page overflow (${r.docScrollW} <= ${r.innerW})`);
  check(
    r.backdropPadTop >= SAFE_TOP && r.backdropPadBottom >= SAFE_BOTTOM,
    `backdrop padding carries the insets (${r.backdropPadTop}/${r.backdropPadBottom})`
  );

  for (const c of checks) console.log('  ' + c);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
