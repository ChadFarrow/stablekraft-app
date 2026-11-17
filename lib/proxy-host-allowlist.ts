/**
 * Keeps the media proxies from being an open internet proxy.
 *
 * /api/proxy-image, /api/proxy-audio and /api/proxy-video take a caller-supplied
 * `?url=` and fetch it. Their only check was isSafePublicUrl (lib/url-security.ts),
 * which blocks PRIVATE addresses — the SSRF question — and permits every public
 * host on the internet. So a stranger could pipe any file anywhere through this
 * deployment's bandwidth and CPU. That is unrelated to any fork; it is open to
 * anyone who knows the URL shape.
 *
 * WHY NOT SIGNED URLS. The obvious fix is an HMAC of the url, keyed by
 * SESSION_SECRET, which only our server could mint. It cannot work here: every
 * proxy URL is built in the BROWSER — lib/cdn-utils.ts, components/CDNImage.tsx
 * ('use client'), lib/audio-url-utils.ts and AudioContext's getAudioUrlsToTry —
 * from artwork and audio URLs that arrive in API responses. The client holds no
 * secret, so signing would mean signing inside every API response instead, which
 * changes their shape (an API_VERSION bump, and the same field is read from many
 * places here) and would strand every proxy URL already cached in a service
 * worker or an offline download.
 *
 * So bind the proxy to the CATALOG instead of to a signature: allow a target host
 * only if it is a host this catalog actually references. That needs no client
 * change, no response-shape change, and nothing already stored goes stale — a
 * saved album's artwork URL still points at a host that is still in the catalog.
 *
 * RESIDUAL, and it is deliberate: a stranger can still proxy some OTHER file on a
 * host we already carry (any file on wavlake.com, say). Closing that would need
 * per-URL state we do not have. The abuse being closed is "proxy anything on the
 * internet", which this ends completely.
 *
 * FAILS OPEN on any database trouble. A proxy that refuses artwork because a
 * query timed out would break the catalog for real users, which costs far more
 * than the abuse does.
 */

import { CORS_PROBLEMATIC_DOMAINS, DIRECT_FIRST_DOMAINS } from './audio-url-utils';
import { ALLOWED_IMAGE_DOMAINS } from './cdn-utils';
import { hostMatches } from './host-match';

export type ProxyHostMode = 'log' | 'enforce';

/** `enforce` only when asked for explicitly; anything else logs. */
export function parseProxyHostMode(raw: string | undefined): ProxyHostMode {
  return (raw ?? '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'log';
}

/**
 * Media hosts the HGH and ITDV playlists load from that no other list carries.
 *
 * data/hgh-*-urls.ts and data/itdv-*-urls.ts hardcode ~1800 artwork and audio
 * URLs. Those playlists' SOURCE feeds sit in PLAYLIST_SOURCE_FEED_URLS and are
 * therefore deliberately absent from the catalog, so binding the proxy to the
 * catalog does not, on its own, cover what the playlists ask it to fetch.
 *
 * Most of those hosts do turn out to be in the catalog, via the music feeds the
 * playlists point AT rather than the playlist feeds themselves. Relying on that
 * would make the playlists depend on a live database round trip for hosts that
 * are already known statically, and would break them the moment a track was
 * removed. These are the remainder, listed so the dependency does not exist.
 *
 * proxy-host-allowlist.test.ts reads the data files and asserts every host in
 * them matches STATIC_ALLOWED_HOSTS, so adding a playlist URL on a host nothing
 * covers fails the suite rather than the page.
 */
export const PLAYLIST_MEDIA_HOSTS: readonly string[] = [
  'backend-api.justcast.com',
  'poddownload.justcast.com',
  'cdn.kolomona.com',
  'headstarts.uk',
  'hogstory.net',
  'i0.wp.com',
  'images.pexels.com',
  'images.squarespace-cdn.com',
  'static1.squarespace.com',
  'ipfspodcasting.net',
  'media.blubrry.com',
  'music.jimmyv4v.com',
  'nutshellsermons.com',
  'serve.podhome.fm',
  'taylor-sound.com',
  'leuenbergmusic.com',
];

/**
 * Hosts allowed even when the catalog query has never run.
 *
 * Seeded from every host list this repo already maintains, so the media hosts
 * the app is built around keep working from a cold start. There are THREE such
 * lists — CORS_PROBLEMATIC_DOMAINS and DIRECT_FIRST_DOMAINS in audio-url-utils,
 * and ALLOWED_IMAGE_DOMAINS in cdn-utils — and seeding from only the first two
 * left socialmedia101pro.com and bobcatindex.us-southeast-1.linodeobjects.com
 * matching nothing at all. Both carry real playlist artwork, so enforce mode
 * would have refused it. Seed from all three, and from the playlist hosts above.
 *
 * `stablekraft.app` and the podcast-namespace hosts are here for artwork that is
 * served from our own domain or from a feed's own site.
 */
export const STATIC_ALLOWED_HOSTS: readonly string[] = Array.from(
  new Set([
    ...CORS_PROBLEMATIC_DOMAINS,
    ...DIRECT_FIRST_DOMAINS,
    // `localhost` belongs in ALLOWED_IMAGE_DOMAINS — next/image needs it in
    // development — but never here. isSafePublicUrl already rejects loopback
    // before this check runs, so keeping it out is defence in depth rather than
    // the control; an allowlist should still not claim loopback is a fine
    // proxy target.
    ...ALLOWED_IMAGE_DOMAINS.filter((host) => host !== 'localhost'),
    ...PLAYLIST_MEDIA_HOSTS,
    'stablekraft.app',
    'podcastindex.org',
    'op3.dev',
    'wavlake.com',
    'megaphone.fm',
    'simplecastcdn.com',
    'transistor.fm',
    'captivate.fm',
    'redcircle.com',
    'podbean.com',
    'soundcloud.com',
    'archive.org',
    'github.io',
    'githubusercontent.com',
    'imgur.com',
    'noagendaassets.com',
  ])
);

/** Re-exported so this module stays the single import for proxy host questions. */
export { hostMatches };

/** Hosts referenced by the catalog, cached in memory. Null until first loaded. */
let catalogHosts: Set<string> | null = null;
// -Infinity, never 0: a falsy sentinel here is indistinguishable from a real
// timestamp of 0, so "failed just now" would read as "never failed" and the
// cooldown below would never engage. A production clock hides that; a test with
// an injected clock does not.
let catalogHostsLoadedAt = -Infinity;
let catalogHostsFailedAt = -Infinity;
let inFlight: Promise<Set<string> | null> | null = null;

/** How long a loaded host set is reused before refreshing. */
export const CATALOG_HOSTS_TTL_MS = 10 * 60 * 1000;

/**
 * How long to wait before retrying after the query fails.
 *
 * Without this, a database that is down makes every proxy request start its own
 * doomed query — the load is not cached on failure, so nothing throttles the
 * retries during exactly the incident when the proxy has to stay quick.
 */
export const CATALOG_HOSTS_RETRY_MS = 30 * 1000;

/**
 * How long the query gets before it is treated as a failure.
 *
 * A hung Postgres would otherwise pin `inFlight` forever, and every caller that
 * awaits it with it.
 */
export const CATALOG_HOSTS_QUERY_TIMEOUT_MS = 5000;

/** Extract a lowercased hostname, or null if the value is not a usable URL. */
export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Distinct hosts across the catalog's URL columns.
 *
 * One raw query rather than four findMany calls: Track alone is large, and
 * pulling every audioUrl into node to extract a few hundred hostnames would be
 * the expensive way to ask a cheap question. Returns null on any failure, which
 * callers treat as "allow" rather than "deny".
 */
export async function loadCatalogHosts(): Promise<Set<string> | null> {
  try {
    // Imported lazily so the pure helpers above stay unit-testable without a
    // database, and so a proxy request that never reaches here pays nothing.
    const { prisma } = await import('./prisma');
    const query = prisma.$queryRaw<Array<{ host: string | null }>>`
      SELECT DISTINCT substring("audioUrl" from '://([^/]+)') AS host FROM "Track"
      UNION
      SELECT DISTINCT substring("image"    from '://([^/]+)') AS host FROM "Track"
      UNION
      SELECT DISTINCT substring("originalUrl" from '://([^/]+)') AS host FROM "Feed"
      UNION
      SELECT DISTINCT substring("image"       from '://([^/]+)') AS host FROM "Feed"
    `;

    // A hung query must not pin inFlight, and through it every awaiting caller.
    const rows = await Promise.race([
      query,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CATALOG_HOSTS_QUERY_TIMEOUT_MS)),
    ]);
    if (!rows) {
      console.warn('[proxy-hosts] catalog host query timed out, allowing all hosts');
      return null;
    }

    const hosts = new Set<string>();
    for (const row of rows) {
      const host = row.host?.trim().toLowerCase();
      // Strip any userinfo/port the regex may have carried along.
      const cleaned = host?.split('@').pop()?.split(':')[0];
      if (cleaned) hosts.add(cleaned);
    }
    return hosts;
  } catch (error) {
    console.warn('[proxy-hosts] catalog host query failed, allowing all hosts', error);
    return null;
  }
}

/**
 * Start a refresh unless one is already running, and never throw.
 *
 * `inFlight` is cleared in a `finally`, not in the success path. loadCatalogHosts
 * catches everything today, so the promise cannot reject today — but if it ever
 * could, clearing only on success would leave a permanently rejected promise
 * here, and every later caller would throw. app/api/proxy-audio/route.ts calls
 * guardProxyTarget OUTSIDE its try block, so that would be a 500 on every audio
 * request until the instance restarted. The module's doc says it never throws;
 * this is what makes that true rather than incidental.
 */
function refreshCatalogHosts(nowMs: number): Promise<Set<string> | null> {
  if (inFlight) return inFlight;
  inFlight = (loaderForTests ?? loadCatalogHosts)()
    .catch(() => null)
    .then((hosts) => {
      if (hosts) {
        catalogHosts = hosts;
        catalogHostsLoadedAt = nowMs;
        catalogHostsFailedAt = -Infinity;
      } else {
        catalogHostsFailedAt = nowMs;
      }
      return hosts;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * The cached catalog host set. Never throws, and never makes a request wait
 * except on the very first call.
 *
 * The blocking version of this was a latency bug hiding inside a mode switch.
 * checkProxyTarget consults the catalog for any host not in STATIC_ALLOWED_HOSTS
 * whatever the mode, because log mode has to know whether it would have refused
 * in order to say so. So in LOG mode — the mode this ships in, the one that is
 * supposed to change nothing — the first proxy request after boot and after
 * every TTL expiry blocked on a DISTINCT scan of Track and Feed. Measured at
 * 170–650 ms against production, on a route that serves every image and every
 * audio stream. "Log mode answers exactly as today" has to be true of latency,
 * not only of responses.
 *
 * So: serve what we have and refresh behind the request. Only a cold start
 * waits, and that once. A stale set is a far better answer than a slow one —
 * hosts enter the catalog when a feed is imported, and STATIC_ALLOWED_HOSTS
 * already covers everything the app itself is built around.
 */
export async function getCatalogHosts(nowMs: number = Date.now()): Promise<Set<string> | null> {
  const fresh = catalogHosts && nowMs - catalogHostsLoadedAt < CATALOG_HOSTS_TTL_MS;
  if (fresh) return catalogHosts;

  const coolingOff = nowMs - catalogHostsFailedAt < CATALOG_HOSTS_RETRY_MS;
  if (coolingOff) return catalogHosts;

  // Nothing loaded yet: there is no stale answer to serve, so wait for this one.
  if (!catalogHosts) return refreshCatalogHosts(nowMs);

  // Stale but usable. Refresh behind the request and answer from the old set.
  void refreshCatalogHosts(nowMs);
  return catalogHosts;
}

/** Test seam. */
export function resetCatalogHostCache(): void {
  catalogHosts = null;
  catalogHostsLoadedAt = -Infinity;
  catalogHostsFailedAt = -Infinity;
  inFlight = null;
}

/**
 * Test seam: run the cache against a stand-in loader instead of Prisma.
 *
 * The cache had no coverage at all — every test drove `catalogHostsOverride`,
 * which skips the TTL, the stampede collapse, the failure cooldown and the
 * stale-while-revalidate path entirely. That is the half of this module with
 * state in it, so it is the half worth testing.
 */
let loaderForTests: (() => Promise<Set<string> | null>) | null = null;

export function setCatalogHostLoaderForTests(load: (() => Promise<Set<string> | null>) | null): void {
  loaderForTests = load;
  resetCatalogHostCache();
}

/**
 * Whether the proxies should fetch `targetUrl`.
 *
 * `allowed: true` with a reason of 'log-mode' or 'unavailable' means it is being
 * permitted despite not matching — the caller should serve it and warn.
 */
export async function checkProxyTarget(
  targetUrl: string,
  mode: ProxyHostMode = parseProxyHostMode(process.env.PROXY_HOST_MODE),
  /** Test seam: stand in for the catalog query. `null` simulates a failed load. */
  catalogHostsOverride?: Set<string> | null
): Promise<{ allowed: boolean; host: string | null; reason: 'static' | 'catalog' | 'unavailable' | 'log-mode' | 'foreign' }> {
  const host = hostOf(targetUrl);
  if (!host) return { allowed: true, host: null, reason: 'unavailable' };

  if (hostMatches(host, STATIC_ALLOWED_HOSTS)) return { allowed: true, host, reason: 'static' };

  const hosts = catalogHostsOverride !== undefined ? catalogHostsOverride : await getCatalogHosts();
  if (!hosts) return { allowed: true, host, reason: 'unavailable' };
  if (hostMatches(host, hosts)) return { allowed: true, host, reason: 'catalog' };

  return mode === 'enforce'
    ? { allowed: false, host, reason: 'foreign' }
    : { allowed: true, host, reason: 'log-mode' };
}

/**
 * Route-side guard: returns a 403 to return early, or null to carry on.
 *
 * In log mode it always returns null, so a route reads it identically in both
 * modes and there is no second code path to get wrong — same shape as
 * enforceRateLimit in lib/rate-limit-guard.ts.
 */
export async function guardProxyTarget(
  targetUrl: string,
  routeLabel: string,
  mode: ProxyHostMode = parseProxyHostMode(process.env.PROXY_HOST_MODE),
  catalogHostsOverride?: Set<string> | null
): Promise<{ refusal: { error: string; status: number } | null }> {
  const check = await checkProxyTarget(targetUrl, mode, catalogHostsOverride);
  if (check.reason === 'static' || check.reason === 'catalog') return { refusal: null };

  if (check.reason === 'unavailable') return { refusal: null };

  // console.warn, never console.log — next.config.js strips console.log from
  // production builds, which is the one environment worth reading.
  console.warn(
    `[proxy-hosts] ${check.allowed ? 'off-catalog host (log mode)' : 'refused'} ${routeLabel} host=${check.host}`
  );

  return check.allowed ? { refusal: null } : { refusal: { error: 'Host not allowed', status: 403 } };
}

/**
 * Where /api/proxy-image may send the browser for an image too big to proxy, or
 * null to serve the placeholder as it always did.
 *
 * MAX_IMAGE_BYTES (lib/safe-fetch.ts) caps what the proxy buffers, and real
 * catalog artwork is bigger: Pixel Palace's cover GIF is 18 MB and a 12 Rods GIF
 * is 41 MB, so both rendered as the placeholder (2026-10-24). Raising the cap
 * would bill that egress on every view — nothing over 4 MB is cached — and hold
 * the body in memory, so the browser fetches those from the artist's host.
 *
 * Three conditions, each closing a different hole:
 *  - `Sec-Fetch-Dest: image` only. A link to /api/proxy-image?url=… is a
 *    top-level navigation, and redirecting it makes stablekraft.app an open
 *    redirect to whatever that host shows a browser. A host check cannot stop
 *    that on its own: STATIC_ALLOWED_HOSTS has shared hosting (github.io,
 *    imgur.com) and an unauthenticated POST /api/feeds adds any host to the
 *    catalog. An <img> pointed at an attacker's page only fails to render. A
 *    fetch() or a browser without Fetch Metadata keeps the placeholder.
 *  - A host the catalog vouches for ('static' or 'catalog'), so log mode's
 *    off-catalog allowance and a failed catalog read change nothing.
 *  - HTTPS before and after the origin's own redirects, or the browser would
 *    block the image as mixed content.
 *
 * `fetchUrl` is the URL the proxy asked for, not the hop it ended on: the
 * browser follows the origin's redirects itself, and a signed CDN hop would
 * expire inside a cached 302.
 */
export async function oversizeImageRedirect(input: {
  fetchUrl: string;
  finalUrl: URL;
  fetchDest: string | null;
  /** Test seam, as for checkProxyTarget. */
  catalogHostsOverride?: Set<string> | null;
}): Promise<string | null> {
  if (input.fetchDest !== 'image') return null;

  let location: URL;
  try {
    location = new URL(input.fetchUrl);
  } catch {
    return null;
  }
  if (location.protocol !== 'https:' || input.finalUrl.protocol !== 'https:') return null;

  const check = await checkProxyTarget(location.href, undefined, input.catalogHostsOverride);
  return check.reason === 'static' || check.reason === 'catalog' ? location.href : null;
}
