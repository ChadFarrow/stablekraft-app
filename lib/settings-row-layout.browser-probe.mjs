/**
 * Browser probe: does a Settings row leave its label enough width on a phone?
 *
 * WHY THIS EXISTS AS A COMMITTED FILE: `SettingsRow` put the label and the
 * control on one line at *every* width, and the control is `flex-shrink-0` —
 * so a wide control took what it needed and the label column absorbed the whole
 * loss. Reported from a phone against "Favorites on Nostr", whose three options
 * are ~262px wide: measured at 393px viewport the description column was **61px
 * and 19 lines**, one word per line down the side of an otherwise empty row,
 * and the option group itself hung 15px past the right edge of the screen.
 * Nothing about it is visible at desktop sizes, which is why it shipped.
 *
 * The fix is `flex-wrap` plus a `basis-56` floor on the label, so this probe
 * asserts BOTH halves of it: the label keeps its width on a phone, and a row
 * whose control still fits (the NIP-38 toggle) is left alone.
 *
 *   npm run dev                                       # needs the dev server on :3000
 *   node lib/settings-row-layout.browser-probe.mjs
 *
 * It seeds the allowlisted pubkey into localStorage so the real
 * `FavoritesPrivacyControl` renders — the control is behind
 * `sharedFavoritesEnabledFor`, and a logged-out /settings does not show the row
 * this bug was reported against. Nothing is published: the probe only reads
 * layout, and it never touches a signer.
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

// npub177fz5zkm87jdmf0we2nz7mm7uc2e7l64uzqrv6rvdrsg8qkrg7yqx0aaq7, the one
// entry in SHARED_FAVORITES_ALLOWLIST. Update both together, or this probe
// silently measures a page with no Favorites-on-Nostr row on it.
const PUBKEY = 'f7922a0adb3fa4dda5eecaa62f6f7ee6159f7f55e08036686c68e08382c34788';

// isMobile stays false everywhere: with mobile emulation on, Chrome
// shrink-to-fits the layout viewport as soon as content overflows horizontally,
// so getBoundingClientRect() stops being in visual-viewport coordinates and the
// overflow assertion below measures against the wrong number — the bug this
// probe exists for would report as fixed.
//
// `toggleInline` is the "don't restyle what already fit" half of the assertion.
// It is deliberately not asserted at 320px: 14rem of label plus a 44px control
// plus the gap wants 284px and the card offers 254, so the toggle wraps there
// too. That is the floor doing its job, not the bug coming back — a 320px
// viewport is Android Display size turned up, where every row is stacked.
const VIEWPORTS = [
  { name: 'pixel4a 393', w: 393, h: 851, scale: 1.0, phone: true, toggleInline: true },
  { name: 'small 360', w: 360, h: 780, scale: 1.0, phone: true, toggleInline: true },
  { name: 'zoomed 320', w: 320, h: 693, scale: 1.0, phone: true, toggleInline: null },
  { name: 'zoomed 320 font1.5', w: 320, h: 693, scale: 1.5, phone: true, toggleInline: null },
  { name: 'tablet 768', w: 768, h: 1024, scale: 1.0, phone: false, toggleInline: true },
  { name: 'desktop 1280', w: 1280, h: 900, scale: 1.0, phone: false, toggleInline: true },
];

const GROUP = '[role="radiogroup"][aria-label="Favorites on Nostr"]';

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: 'new',
  // No 1.4 GB code-sign copy of Chrome on macOS: a killed probe leaves one (measured 2026-11-11).
  // puppeteer merges this into its own --disable-features list.
  args: ['--no-sandbox', '--disable-features=MacAppCodeSignClone', '--disable-dev-shm-usage'],
});

const results = [];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, isMobile: false, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    // The session probe in NostrContext would log the seeded user straight back
    // out — it has no cookie — and the row under test would never render.
    if (req.url().includes('/api/nostr/auth/session')) return req.abort();
    req.continue();
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((pubkey) => {
    localStorage.setItem(
      'nostr_user',
      JSON.stringify({ id: 'probe-user', nostrPubkey: pubkey, nostrNpub: 'npub1probe', relays: [] })
    );
    localStorage.setItem('nostr_login_type', 'extension');
  }, PUBKEY);

  await page.goto(BASE + '/settings', { waitUntil: 'networkidle2' });
  if (vp.scale !== 1.0) {
    // After goto, never evaluateOnNewDocument — navigation replaces the
    // document the style was appended to.
    await page.addStyleTag({ content: `html { font-size: ${16 * vp.scale}px; }` });
  }
  await page.waitForSelector(GROUP, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 400));

  const measured = await page.evaluate((groupSel) => {
    const group = document.querySelector(groupSel);
    const controlCol = group.parentElement;
    const row = controlCol.parentElement;
    const labelCol = row.firstElementChild;
    const desc = labelCol.children[1];
    const section = row.closest('.rounded-lg').getBoundingClientRect();
    const g = group.getBoundingClientRect();
    const l = labelCol.getBoundingClientRect();
    const d = desc.getBoundingClientRect();

    // How many lines the description actually wraps into — the symptom was 19.
    const range = document.createRange();
    range.selectNodeContents(desc);

    // The NIP-38 toggle is the control that still FITS beside its label. It has
    // to keep sitting there, or the fix has quietly restyled every row.
    const toggleRow = [...document.querySelectorAll('.flex.flex-wrap.items-start')].find((r) =>
      r.textContent.startsWith('Auto-publish status to Nostr')
    );
    const tl = toggleRow?.firstElementChild.getBoundingClientRect();
    const tc = toggleRow?.lastElementChild.getBoundingClientRect();

    return {
      descW: Math.round(d.width),
      descLines: range.getClientRects().length,
      labelColW: Math.round(l.width),
      groupW: Math.round(g.width),
      groupLeft: Math.round(g.left),
      groupRight: Math.round(g.right),
      sectionLeft: Math.round(section.left),
      sectionRight: Math.round(section.right),
      wrapped: g.top >= l.bottom - 1,
      buttonHeights: [...group.querySelectorAll('button')].map((b) =>
        Math.round(b.getBoundingClientRect().height)
      ),
      toggleInline: tl && tc ? tc.top < tl.bottom - 1 : null,
      docScrollW: document.documentElement.scrollWidth,
      viewportW: window.innerWidth,
      overflowing: [...document.querySelectorAll('main *, body > div *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 4)
        .map((el) => `<${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 28)}"`),
    };
  }, GROUP);

  results.push({ vp: vp.name, phone: vp.phone, expectToggle: vp.toggleInline, ...measured });
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
    `\n${r.vp}  label=${r.labelColW}px desc=${r.descW}px/${r.descLines} lines  ` +
      `options=${r.groupW}px ${r.wrapped ? '(own line)' : '(beside label)'}`
  );
  if (r.overflowing.length) console.log('  overflowing:', r.overflowing.join(' | '));

  // 61px was the bug. 200px is roughly "a sentence, not a column of words".
  check(r.descW >= 200, `description column >= 200px (got ${r.descW})`);
  check(r.descLines <= 8, `description wraps <= 8 lines (got ${r.descLines})`);
  check(
    r.docScrollW <= r.viewportW,
    `no horizontal page overflow (${r.docScrollW} <= ${r.viewportW})`
  );
  check(r.groupLeft >= r.sectionLeft - 1, `options inside the card's left edge`);
  check(r.groupRight <= r.sectionRight + 1, `options inside the card's right edge`);
  check(
    r.phone ? r.buttonHeights.every((h) => h >= 44) : true,
    `44px touch targets on a phone (${r.buttonHeights.join('/')})`
  );
  // A narrow control must NOT be moved by this: the row shape is still
  // label-left / control-right wherever both fit.
  if (r.expectToggle === null) {
    console.log(`  note the NIP-38 toggle is ${r.toggleInline ? 'beside' : 'below'} its label here`);
  } else {
    check(r.toggleInline === true, `the NIP-38 toggle still sits beside its label`);
  }

  for (const c of checks) console.log('  ' + c);
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
