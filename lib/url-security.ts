/**
 * Shared SSRF guard for routes that fetch caller-supplied URLs
 * (chapters proxy, image proxy, audio proxy).
 *
 * Known limitation: this is a string-based hostname check with no DNS
 * resolution, so on its own it does not see a public name that resolves to a
 * private address (`127.0.0.1.nip.io`), and it does not defend against DNS
 * rebinding. Feed fetches add the DNS check on every hop: `lib/feed-fetch.ts`.
 */

export type UrlCheckResult = { ok: true; url: URL } | { ok: false; error: string };

// The address lists below are from Boost Me Bitch's `lib/safe-fetch.ts` (MIT), as
// shipped in PC20-Nostr `catalog/recipes/safe-feed-fetch`, whose test fails when any
// one rule is removed. The string checks this file had before missed every one of
// these, each verified on 2026-11-24 to pass `isSafePublicUrl`:
//   http://[::ffff:127.0.0.1]/  — Node rewrites the host to [::ffff:7f00:1]
//   http://[::]/  http://0.0.0.1/  http://100.64.0.1/  http://localhost./  http://foo.localhost/

const PRIVATE_V4 = [
  /^0\./, // 0.0.0.0/8, "this network"
  /^10\./,
  /^127\./,
  /^169\.254\./, // link-local, incl. 169.254.169.254 cloud metadata
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 carrier-grade NAT (tailnets)
  /^(?:22[4-9]|23\d)\./, // 224.0.0.0/4 multicast
  /^(?:24\d|25[0-5])\./, // 240.0.0.0/4 reserved, incl. broadcast
  /^192\.0\.0\./, // IETF protocol assignments
  /^192\.0\.2\./, // TEST-NET-1
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^198\.1[89]\./, // 198.18.0.0/15 benchmarking
  /^192\.88\.99\./, // 6to4 relay anycast
];

const PRIVATE_V6 = [
  /^::$/, // unspecified
  /^::(?!$)/, // all of ::/96 — ::1 loopback, IPv4-compatible, and ::ffff: v4-mapped
  /^fe[89a-f]/i, // fe80::/10 link-local and fec0::/10 site-local
  /^f[cd]/i, // fc00::/7 unique-local
  /^64:ff9b:/i, // NAT64 (embeds an IPv4)
  /^2002:/i, // 6to4 (embeds an IPv4)
  /^2001:0?:/i, // Teredo (embeds an IPv4)
  /^100:/i, // discard-only
];

/**
 * Is this bare IP address one a server must never fetch? Brackets are allowed.
 * A host name (not an IP literal) returns false: only DNS can answer for it.
 *
 * One list for the literal check here and the post-DNS check in
 * `lib/feed-fetch.ts`, so the two cannot disagree about what "private" means.
 */
export function isPrivateIp(addr: string): boolean {
  const ip = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (ip.includes(':')) return PRIVATE_V6.some((re) => re.test(ip));
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return PRIVATE_V4.some((re) => re.test(ip));
  return false;
}

/** Lower-cased host with the trailing dot(s) of a fully-qualified name removed. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, '');
}

export function isSafePublicUrl(
  raw: string,
  opts: { allowHttp?: boolean } = {}
): UrlCheckResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  const allowedProtocols = opts.allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      ok: false,
      error: opts.allowHttp ? 'Only HTTP(S) URLs are allowed' : 'Only HTTPS URLs are allowed',
    };
  }

  // DNS treats `localhost.` as `localhost`, but `=== 'localhost'` and
  // `.endsWith('.internal')` do not — strip the trailing dot first.
  const hostname = normalizeHost(parsed.hostname);
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    isPrivateIp(hostname)
  ) {
    return { ok: false, error: 'Private URLs are not allowed' };
  }

  return { ok: true, url: parsed };
}
