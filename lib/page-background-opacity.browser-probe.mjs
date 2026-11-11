/**
 * Browser probe: can the stock rocket wallpaper show through an album page's
 * background while the album artwork is still loading?
 *
 * WHY THIS EXISTS AS A COMMITTED FILE: issue #201, "background art switches to
 * stock art" — reported as "when I switch album pages the stock wallpaper shows
 * up right before the album art". The album page's background layer sits at z-1
 * and `app/layout.tsx` paints `/stablekraft-rocket.webp` at z-0. The layer used
 * to carry only
 *
 *     linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(<artwork>)
 *
 * which is 40-60% black over nothing — see-through until the `url()` decodes.
 * The artwork URL is an `enhance=true&minWidth=1920` sharp upscale through
 * /api/proxy-image, so that window is long, and it opens on EVERY navigation
 * because the anti-flicker cache seeds a background URL before the new image is
 * even requested. Nothing about it is visible in a settled screenshot, which is
 * why it shipped and why this probe holds the artwork request open on purpose.
 *
 *   npm run dev -- -p 3007                                  # needs a dev server
 *   node lib/page-background-opacity.browser-probe.mjs
 *
 * HOW IT MEASURES, and why not more simply: the obvious probe — "screenshot the
 * page and look for bright pixels" — does not work. The page is full of white
 * text, so it reports the rocket present whether or not it is. This instead
 * hides the content overlay so only the background layers paint, then screenshots
 * twice: once as-is, once with the rocket layer removed. If the album background
 * is opaque the two are pixel-identical, because nothing behind it can
 * contribute. Any difference IS the rocket showing through. That is colour-blind
 * and layout-blind, so it keeps working if either wallpaper is restyled.
 *
 * puppeteer-core is not a declared dependency — it resolves transitively through
 * lighthouse. `npm i -D puppeteer-core` if that ever stops being true.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3007';
const TARGET = process.env.PROBE_ALBUM || '/album/stay-awhile';
const EXEC =
  process.env.CHROME_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p));

if (!EXEC) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const browser = await puppeteer.launch({
  executablePath: EXEC,
  headless: 'new',
  // No 1.4 GB code-sign copy of Chrome on macOS: a killed probe leaves one (measured 2026-11-11).
  // puppeteer merges this into its own --disable-features list.
  args: ['--no-sandbox', '--disable-features=MacAppCodeSignClone', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Stall every artwork fetch so the "artwork requested but not yet painted"
  // window — the whole bug — stays open long enough to sample.
  let stalled = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/proxy-image') || url.includes('/api/optimized-images')) {
      stalled++;
      return; // never respond, never abort: the request hangs
    }
    req.continue().catch(() => {});
  });

  await page.goto(BASE + TARGET, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 12000)); // let the client album fetch resolve

  const layer = await page.evaluate(() => {
    // The album background is the fixed, z-1 div that covers the viewport. Match
    // on "covers the viewport" rather than `top: 0px`: the artwork branch is
    // deliberately grown past the edges so its blur fade lands off-screen.
    const el = Array.from(document.querySelectorAll('div')).find((d) => {
      const s = getComputedStyle(d);
      if (s.position !== 'fixed' || s.zIndex !== '1') return false;
      const r = d.getBoundingClientRect();
      return r.width >= innerWidth && r.height >= innerHeight;
    });
    const rocket = document.getElementById('background-image');
    return {
      found: !!el,
      backgroundImage: el ? getComputedStyle(el).backgroundImage : null,
      rocketPresent: !!rocket,
      rocketImage: rocket ? getComputedStyle(rocket).backgroundImage : null,
    };
  });

  console.log('\nbackground layer :', layer.backgroundImage);
  console.log('rocket wallpaper :', layer.rocketImage);
  console.log('stalled artwork requests:', stalled, '\n');

  check(layer.found, 'the fixed z-1 background layer is rendered');
  check(layer.rocketPresent, 'the global rocket wallpaper layer exists at z-0');
  check(stalled > 0, 'the artwork request was held open (the bug window is real)');

  const bg = layer.backgroundImage || '';
  if (bg.includes('url(')) {
    // Chrome normalises `to bottom right` to `to right bottom`, so match on the
    // colour stops, which are what actually has to be opaque.
    const BASE_STOPS = 'rgb(17, 24, 39), rgb(31, 41, 55), rgb(17, 24, 39)';
    check(bg.includes(BASE_STOPS), 'the artwork layer carries the opaque base gradient');
    check(
      bg.lastIndexOf(BASE_STOPS) > bg.indexOf('url('),
      'the opaque base is the bottom-most layer, below the artwork'
    );
  } else {
    console.log('NOTE: layer has no url() — this album resolved with no artwork.');
  }

  // Hide the content overlay so only background layers paint. Without this the
  // page's white text dominates any pixel comparison.
  await page.evaluate(() => {
    document.querySelectorAll('body *').forEach((el) => {
      const s = getComputedStyle(el);
      const isBackdrop =
        s.position === 'fixed' && (s.zIndex === '0' || s.zIndex === '1');
      if (!isBackdrop && el.children.length === 0) el.setAttribute('data-probe-hidden', '');
    });
    document.querySelectorAll('[data-probe-hidden]').forEach((el) => {
      el.style.visibility = 'hidden';
    });
  });
  await new Promise((r) => setTimeout(r, 400));
  const withRocket = await page.screenshot({ encoding: 'base64', type: 'png' });

  // Remove the rocket. If the album background is opaque, nothing changes.
  const removed = await page.evaluate(() => {
    const rocket = document.getElementById('background-image');
    if (!rocket) return false;
    rocket.style.display = 'none';
    return true;
  });
  check(removed, 'the rocket layer could be toggled off for the comparison');
  await new Promise((r) => setTimeout(r, 400));
  const withoutRocket = await page.screenshot({ encoding: 'base64', type: 'png' });

  const diff = await page.evaluate(
    async (a, b) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const [x, y] = [await load(a), await load(b)];
      let maxDelta = 0;
      let differing = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(
          Math.abs(x[i] - y[i]),
          Math.abs(x[i + 1] - y[i + 1]),
          Math.abs(x[i + 2] - y[i + 2])
        );
        if (d > 1) differing++;
        maxDelta = Math.max(maxDelta, d);
      }
      return { maxDelta, differing, total: x.length / 4 };
    },
    withRocket,
    withoutRocket
  );

  const pct = ((diff.differing / diff.total) * 100).toFixed(2);
  check(
    diff.differing === 0,
    'removing the rocket changes nothing — the album background is opaque',
    `${diff.differing}/${diff.total} px differ (${pct}%), max channel delta ${diff.maxDelta}`
  );
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
