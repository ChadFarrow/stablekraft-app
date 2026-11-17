/**
 * The URL half of the image version: adding, removing and comparing it.
 *
 * Pure string work and no Node imports, so client code (the offline-downloads
 * cover cache) can use it. The half that asks an image host lives in
 * `./image-version.ts`, which re-exports everything here.
 *
 * WHAT THE VERSION IS: `Feed.image` and `Track.image` may carry
 * `?skv=<8 letters>` (or `&skv=`), added by THIS app, not by the feed. It
 * changes when the image host reports different bytes, so every cache that keys
 * on the URL — the image proxy, `/_next/image`, browsers, offline downloads —
 * fetches the new art. Compare a stored URL with a feed's URL only after
 * `stripImageVersion`.
 */

export const IMAGE_VERSION_PARAM = 'skv';

/** Exactly our parameter: the name, then 8 letters a-p (see `versionToken`). */
const VERSION_PAIR = new RegExp(`^${IMAGE_VERSION_PARAM}=[a-p]{8}$`);

interface UrlParts {
  base: string;
  /** undefined when the URL has no `?` at all; '' for a bare trailing `?`. */
  query: string | undefined;
  fragment: string;
}

/**
 * Split without `new URL()`: re-serialising would re-encode the rest of the URL
 * (a literal space becomes %20), and the feed-lookup ladder and the offline
 * cache both compare these strings byte for byte.
 */
function split(url: string): UrlParts {
  const hashAt = url.indexOf('#');
  const fragment = hashAt === -1 ? '' : url.slice(hashAt);
  const rest = hashAt === -1 ? url : url.slice(0, hashAt);
  const qAt = rest.indexOf('?');
  if (qAt === -1) return { base: rest, query: undefined, fragment };
  return { base: rest.slice(0, qAt), query: rest.slice(qAt + 1), fragment };
}

/** Remove our version parameter; every other byte of the URL is unchanged. */
export function stripImageVersion(url: string): string {
  const { base, query, fragment } = split(url);
  if (query === undefined) return url;
  const pairs = query.split('&');
  const kept = pairs.filter((pair) => !VERSION_PAIR.test(pair));
  if (kept.length === pairs.length) return url;
  return kept.length === 0 ? `${base}${fragment}` : `${base}?${kept.join('&')}${fragment}`;
}

/** Set our version parameter to `token`, replacing any earlier one. */
export function withImageVersion(url: string, token: string): string {
  const { base, query, fragment } = split(stripImageVersion(url));
  const pair = `${IMAGE_VERSION_PARAM}=${token}`;
  if (query === undefined) return `${base}?${pair}${fragment}`;
  if (query === '') return `${base}?${pair}${fragment}`;
  return `${base}?${query}&${pair}${fragment}`;
}

/**
 * For a path that writes an image URL WITHOUT asking the host (the nightly jobs,
 * the Podcast Index paths): if the new URL is the stored one minus our version,
 * keep the stored one. Without this, every such write strips the version, and
 * the next podping adds it back — the URL flips and every cache downloads the
 * art again. A genuinely different URL is taken as given.
 */
export function preserveImageVersion<T extends string | null | undefined>(
  next: T,
  stored: string | null | undefined
): T | string {
  if (next == null || !stored) return next;
  return stripImageVersion(stored) === stripImageVersion(next) ? stored : next;
}
