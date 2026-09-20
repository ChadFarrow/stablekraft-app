/**
 * Data Saver — a manual, user-controlled low-bandwidth mode.
 *
 * WHY A SWITCH AND NOT A DEFAULT: every reduction in here is a trade, and each
 * thing being traded away was added on purpose. `unoptimized` on the grid card
 * fixed real blurriness (271a6ba8); the Android blob prefetch fixed real
 * locked-screen gaps. None of them is waste — they are only expensive. So the
 * person paying for the bytes decides, and with the switch OFF this module
 * returns each caller's own baseline unchanged. "OFF is identical to today" is
 * the contract, and `data-saver.test.ts` is what holds it.
 *
 * WHY NOT `navigator.connection.saveData`: deliberately not consulted. Offline
 * mode ignores `navigator.onLine` for the same reason — see the comment in
 * `contexts/DownloadsContext.tsx`. A mode that turns itself on is a mode whose
 * behaviour nobody can reproduce from the UI.
 *
 * WHY THIS FILE HAS NO REACT: `lib/audio-prefetch.ts` is not a component and
 * still has to ask. `useDataSaver` (hooks/useDataSaver.ts) is the React face of
 * the same flag; this is the whole of the logic.
 */

import { ALLOWED_IMAGE_DOMAINS } from './cdn-utils';

/** localStorage key. `'1'` is on; anything else, including absent, is off. */
export const DATA_SAVER_KEY = 'sk_data_saver';

/**
 * Dispatched on `window` after a write, so components already on screen react
 * to the toggle. `storage` alone is not enough: it does not fire in the tab
 * that made the change.
 */
export const DATA_SAVER_EVENT = 'sk:data-saver-change';

/** Quality handed to the Next optimizer in Data Saver. Must be one of
 *  `images.qualities` in next.config.js, or Next refuses it at runtime. */
export const DATA_SAVER_QUALITY = 50;

/** 12 KB, versus 1.60 MB for `/stablekraft-rocket.png`. */
export const DATA_SAVER_FALLBACK_ART = '/album-placeholder-thumbnail.png';

/**
 * Routes this app serves itself. They must NEVER be handed to `next/image` with
 * `unoptimized: false`, because `/_next/image` would then fetch them
 * SERVER-SIDE — and `/api/proxy-image` exists solely to work around browser
 * CORS, which a server fetch does not have. 3b8c1da8 removed exactly that hop
 * and fdc87176 wrote the rule into the auth-and-security skill: never fetch our
 * own proxy from the server. Data Saver must not quietly reintroduce it.
 */
const OWN_IMAGE_ROUTES = [
  '/api/proxy-image',
  '/api/optimized-images/',
  '/api/placeholder-image/',
  '/api/gif-placeholder',
];

/**
 * Read the flag from a storage-like object.
 *
 * Split out from `isDataSaverOn` so it can be tested without a DOM — this repo
 * runs `node:test` + tsx, and there is no jsdom. Accepts null so a caller in a
 * private window, where `localStorage` access throws, resolves to "off".
 */
export function readDataSaverFlag(
  storage: Pick<Storage, 'getItem'> | null | undefined
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(DATA_SAVER_KEY) === '1';
  } catch {
    // Private mode, blocked site data, or a sandboxed iframe. Off is the safe
    // answer: it is the behaviour every user has today.
    return false;
  }
}

/** Is Data Saver on for this device? False during SSR, always. */
export function isDataSaverOn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return readDataSaverFlag(window.localStorage);
  } catch {
    return false;
  }
}

/** Persist the choice and tell anything already rendered. */
export function setDataSaver(on: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DATA_SAVER_KEY, on ? '1' : '0');
  } catch {
    // Unwritable storage still gets the in-session behaviour below; it simply
    // will not survive a reload. Better than throwing out of a click handler.
  }
  window.dispatchEvent(new Event(DATA_SAVER_EVENT));
}

/** True for a URL this app serves. See OWN_IMAGE_ROUTES. */
export function isOwnImageRoute(src: string): boolean {
  return OWN_IMAGE_ROUTES.some((route) => src.includes(route));
}

/**
 * Deliberately BROADER than `isAnimatedArtworkUrl` in lib/cdn-utils.ts, which
 * requires the path to end in `.gif`. This matches CDNImage's own long-standing
 * test instead (substring, plus `format=gif`), and the direction of the
 * difference is the point: every URL the precise function calls animated is
 * also matched here, so Data Saver can never hand an animation to the optimizer
 * or fetch one it meant to refuse. Erring wide costs a still frame; erring
 * narrow costs 19 MB.
 */
export function isGifSource(src: string): boolean {
  const lower = src.toLowerCase();
  return lower.includes('.gif') || lower.includes('format=gif');
}

/**
 * Can `next/image` fetch this at all?
 *
 * MEASURED, not assumed: /_next/image answers **HTTP 400** for any host missing
 * from `images.remotePatterns` in next.config.js. Lifting `unoptimized` on such
 * a URL does not degrade the image, it deletes it.
 *
 * `ALLOWED_IMAGE_DOMAINS` is the in-app mirror of that list — checked on
 * 2026-09-20, all 46 of its hosts are present in remotePatterns (which carries
 * one extra, feeds.podcastindex.org). Matching is dot-boundary, never
 * `includes`, for the reason CLAUDE.md gives: `includes` accepts
 * `wavlake.com.attacker.net`.
 *
 * In practice `getAlbumArtworkUrl` has already rewritten a non-allowed host to
 * /api/proxy-image before it reaches a component (lib/cdn-utils.ts) — which is
 * its own note about Next image 400s. This check is here so `artworkPlan` is
 * correct on its own terms rather than on that assumption holding at every one
 * of its call sites.
 */
export function isNextOptimizable(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;
  // Same-origin path: Next serves and optimizes it from public/.
  if (src.startsWith('/')) return !isOwnImageRoute(src);

  let hostname: string;
  try {
    hostname = new URL(src).hostname.toLowerCase();
  } catch {
    return false;
  }

  return ALLOWED_IMAGE_DOMAINS.some((domain) => {
    const d = domain.toLowerCase();
    return hostname === d || hostname.endsWith('.' + d);
  });
}

/** What a component does today, with the switch off. */
export interface ArtworkBaseline {
  quality: number;
  unoptimized: boolean;
}

export interface ArtworkPlanInput {
  src: string;
  dataSaver: boolean;
  baseline: ArtworkBaseline;
}

export interface ArtworkPlan {
  quality: number;
  unoptimized: boolean;
  /** False means: show the still frame and never fetch the animation. */
  allowAnimation: boolean;
}

/**
 * The ONE place that decides how heavy an artwork request may be.
 *
 * WHY ONE PLACE: there are four artwork paths in this app — AlbumCard's own
 * `next/image`, CDNImage, ArtworkImage, and 31 raw `<img>` tags — and this repo
 * has been bitten repeatedly by a field that is written or read from N places
 * where fixing one looks like fixing it (see CLAUDE.md). A branch inside each
 * component is that bug waiting to happen.
 *
 * With `dataSaver` false this returns the caller's baseline, field for field.
 */
export function artworkPlan({ src, dataSaver, baseline }: ArtworkPlanInput): ArtworkPlan {
  if (!dataSaver) {
    return {
      quality: baseline.quality,
      unoptimized: baseline.unoptimized,
      allowAnimation: true,
    };
  }

  const gif = isGifSource(src);

  return {
    quality: DATA_SAVER_QUALITY,
    // Optimizing is the whole point in Data Saver — a 2.0 MB cover in a 180px
    // box measured 5.5 KB through the optimizer — but three kinds of URL must
    // stay unoptimized: our own routes (server self-fetch, see
    // OWN_IMAGE_ROUTES), animations the optimizer would flatten or refuse, and
    // any host Next is not configured to fetch, which answers 400 rather than
    // degrading. `isNextOptimizable` covers the first and the third.
    unoptimized: !(isNextOptimizable(src) && !gif),
    // A still first frame instead of 7-19 MB of animation.
    allowAnimation: !gif,
  };
}

/** The placeholder to use when a track has no artwork of its own. */
export function fallbackArtworkSrc(dataSaver: boolean, baseline: string): string {
  return dataSaver ? DATA_SAVER_FALLBACK_ART : baseline;
}
