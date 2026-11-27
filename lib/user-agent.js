'use strict';

/**
 * The one User-Agent this app sends to other people's servers.
 *
 *   StableKraft/<version> (+https://stablekraft.app)
 *
 * Every server-side request uses it: feed and chapter fetches, the image, audio
 * and video proxies, Lightning address lookups, NIP-05, Podcast Index, and the
 * scripts in `scripts/`. `safeFetch` and `fetchFeed` add it when a caller sets
 * none, so a fetch through either never goes out as Node's default `node`.
 * Before this there were about 50 different names, two browser imitations, an
 * `example.com` link, and the names of other apps (DoerfelVerse,
 * PodtardsImageProxy, HGH-Resolver, ITDV-Music-Parser) — a host that wanted to
 * tell its operator who was calling could not.
 *
 * The form is the usual crawler convention: product, version, and a `+` link a
 * host operator can open. No email, and never a browser imitation. The link is
 * the live site, not `SITE_CONFIG.url`, because that one reads
 * `NEXT_PUBLIC_BASE_URL` and a request must not name a local or preview host.
 *
 * Browser code cannot set this header (Chrome drops it), so the browser-side
 * fetches are left alone. `lib/lightning/lnurl.ts` runs on both sides and
 * already sent a User-Agent from the browser, so it keeps doing so, with this
 * value.
 *
 * CommonJS on purpose, so ONE file serves all three places that need it: Next
 * (webpack), `tsx` (tests, the .ts scripts) and plain `node scripts/*.js`. A .ts
 * file cannot be required by plain node here.
 */

/** Must equal `APP_NAME` in lib/constants.ts; user-agent.test.ts pins that. */
const USER_AGENT_NAME = 'StableKraft';

/** Public and answers 200. The live site comes first; a GitHub URL is only the fallback for an app with no site. */
const USER_AGENT_LINK = 'https://stablekraft.app';

/**
 * package.json carries `1.2a<commit>` (scripts/auto-version-update.js), and the
 * commit part is set by hand and goes stale — it named an April commit in
 * November 2026. The app shows only `major.minor` (`getVersionString` in
 * lib/version.ts), so the User-Agent does too.
 *
 * @param {string | undefined} raw
 * @returns {string}
 */
function userAgentVersion(raw) {
  const value = String(raw || '').trim();
  const match = /^(\d+\.\d+)/.exec(value);
  if (match) return match[1];
  return value || '0';
}

// next.config.js inlines NEXT_PUBLIC_APP_VERSION from package.json at build
// time, so in a Next bundle the left side is a string literal and webpack drops
// the require() — package.json is never bundled, not even into the browser
// chunk that lnurl.ts pulls this into. Outside Next (tsx, plain node) the
// variable is unset and package.json is read directly. Same value either way.
const USER_AGENT_VERSION = userAgentVersion(
  process.env.NEXT_PUBLIC_APP_VERSION || require('../package.json').version
);

const USER_AGENT = `${USER_AGENT_NAME}/${USER_AGENT_VERSION} (+${USER_AGENT_LINK})`;

/**
 * `headers` with our User-Agent added — unless the caller already set one, under
 * any capitalisation. Merging blindly would send both keys, and fetch joins two
 * values of one header into `a, b`.
 *
 * @param {Record<string, string> | undefined} headers
 * @returns {Record<string, string>}
 */
function withUserAgent(headers) {
  const given = headers || {};
  for (const key of Object.keys(given)) {
    if (key.toLowerCase() === 'user-agent') return given;
  }
  return { 'User-Agent': USER_AGENT, ...given };
}

module.exports = {
  USER_AGENT,
  USER_AGENT_NAME,
  USER_AGENT_LINK,
  USER_AGENT_VERSION,
  userAgentVersion,
  withUserAgent,
};
