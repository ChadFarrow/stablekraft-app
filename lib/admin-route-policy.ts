/**
 * Which API requests must present the admin bearer secret.
 *
 * WHY THIS IS ITS OWN MODULE: the policy used to live inside `middleware.ts`,
 * which imports `next/server` and so cannot be unit-tested with `node:test`.
 * It also has to stay in step with the `matcher` array in that file — a rule
 * added to the function but not the matcher never runs, because middleware is
 * never invoked for an unmatched path. Both halves are now derived from
 * `ADMIN_GATED_MATCHER` below and pinned by `admin-route-policy.test.ts`.
 *
 * Pure and dependency-free on purpose: no env reads, no Next.js, no Prisma.
 * Same precedent as `lib/feed-lookup.ts` and `lib/auth/session.ts`.
 */

export type HttpMethod = string;

/** Methods that change server state. OPTIONS/HEAD/GET are not in here. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Which write methods are admin-only, per exact path.
 *
 * `WRITE_METHODS` (every write) is the common case. Two paths need a subset,
 * and both would break the app if gated wholesale:
 *
 *  - `/api/feeds` — POST is how the podping consumer mints a feed (CLAUDE.md).
 *  - `/api/artwork-colors` — POST is how NowPlayingScreen and RadioPlayer
 *    compute the canvas background for ordinary listeners. Only DELETE is
 *    dangerous there: `?all=true` runs `deleteMany({})` over the whole table.
 *
 * Getting this wrong in either direction is a real failure, so the split is
 * explicit rather than inferred, and pinned by admin-route-policy.test.ts.
 */
const WRITE_GATED_PATHS = new Map<string, ReadonlySet<string>>([
  ['/api/tracks', WRITE_METHODS],              // PUT was unrestricted mass assignment
  ['/api/playlists', WRITE_METHODS],           // /api/playlist/:path* does NOT match this
  ['/api/add-playlist-to-database', WRITE_METHODS], // Feed+Track from a caller-supplied body
  ['/api/music-tracks', WRITE_METHODS],
  ['/api/music-tracks/database', WRITE_METHODS],
  ['/api/music-tracks/clear-cache', WRITE_METHODS],
  ['/api/artwork-colors/batch-process', WRITE_METHODS],
  ['/api/cache', WRITE_METHODS],
  ['/api/resolve-hgh-tracks', WRITE_METHODS],
  ['/api/find-missing-feeds', WRITE_METHODS],
  ['/api/resolve-missing-feeds', WRITE_METHODS],

  // Subsets — see the note above.
  ['/api/feeds', new Set(['PUT', 'PATCH', 'DELETE'])],
  ['/api/artwork-colors', new Set(['DELETE'])],
]);

/** Exact paths gated for every method, read included — all are expensive. */
const FULLY_GATED_PATHS = new Set([
  '/api/parse-feeds',
  '/api/playlist-cache',
  '/api/playlist/parse-feeds',
  '/api/playlist/parse-feeds-stream',
  '/api/playlist/resolve-mmm-tracks',
]);

/**
 * Intentionally PUBLIC, per CLAUDE.md — the podping consumer
 * (msp-podping-service) calls these from outside a browser.
 * They carry no user data and no cookie.
 */
const PUBLIC_FEED_PATHS = new Set([
  '/api/feeds/exists',
  '/api/feeds/refresh-by-url',
  '/api/feeds/opml',
]);

/**
 * `/api/feeds/<id>/refresh` and `/api/feeds/<id>/process-remote-items` reparse a
 * feed and write tracks. `/api/feeds` in the matcher is an EXACT path, so no
 * sub-route under it was gated before.
 */
const GATED_FEED_SUBPATHS = ['refresh', 'process-remote-items'];


function isGatedFeedSubpath(pathname: string): boolean {
  if (!pathname.startsWith('/api/feeds/')) return false;
  if (PUBLIC_FEED_PATHS.has(pathname)) return false;
  const rest = pathname.slice('/api/feeds/'.length).split('/');
  // ['<id>', '<action>'] — anything deeper or shallower is not one of ours.
  return rest.length === 2 && GATED_FEED_SUBPATHS.includes(rest[1]);
}

/**
 * Whether a request asks a cached route to rebuild itself: exactly `?refresh=true`.
 *
 * The gate and the handlers MUST ask this through the same function. They used to
 * ask separately — the gate `get('refresh') === 'true'`, the playlist handler
 * `has('refresh')` — so `?refresh=1`, `?refresh` or `?refresh=TRUE` passed the
 * gate unchallenged and still rebuilt the playlist: a re-fetch of the XML, a
 * Podcast Index lookup per item, and a delete-then-insert of every
 * `SystemPlaylistTrack` row for that playlist, all from an anonymous GET.
 * `admin-route-policy.test.ts` fails if a handler reads `refresh` any other way.
 *
 * Any other value is an ordinary read, not an unauthenticated refresh. Every
 * legitimate caller (the nightly workflow, `/api/playlist-cache`) sends `true`.
 */
export function isForceRefresh(searchParams: URLSearchParams): boolean {
  return searchParams.get('refresh') === 'true';
}

/**
 * True when this request must carry `Authorization: Bearer <ADMIN_SECRET>`.
 *
 * `searchParams` is read only for `?refresh=true` on `/api/playlist/*` and
 * `/api/albums-fast`.
 */
export function requiresAdminAuth(
  pathname: string,
  method: HttpMethod,
  searchParams: URLSearchParams
): boolean {
  const upper = method.toUpperCase();

  // CORS preflight always passes; the browser sends no Authorization header on it.
  if (upper === 'OPTIONS') return false;

  if (pathname.startsWith('/api/admin/')) {
    // npub-allowlist login check, used by AdminPanel before it has the secret.
    return pathname !== '/api/admin/verify';
  }

  if (FULLY_GATED_PATHS.has(pathname)) return true;

  const gatedMethods = WRITE_GATED_PATHS.get(pathname);
  if (gatedMethods) return gatedMethods.has(upper);

  if (isGatedFeedSubpath(pathname)) return WRITE_METHODS.has(upper);

  // Public playlist reads stay open; only the expensive ?refresh=true variant is
  // gated. The public app never sends it.
  if (pathname.startsWith('/api/playlist/')) {
    return isForceRefresh(searchParams);
  }

  // Same for the catalog: ?refresh=true drops the in-memory cache, so the next
  // request rescans every feed and its tracks from Postgres. Nothing in the app,
  // the scripts or the workflows sends it; anyone could, in a loop.
  if (pathname === '/api/albums-fast') {
    return isForceRefresh(searchParams);
  }

  return false;
}

/**
 * The `matcher` entries `middleware.ts` must export for the rules above to run.
 *
 * Next.js requires the matcher to be statically analysable, so `middleware.ts`
 * repeats these as literals. `admin-route-policy.test.ts` asserts the two lists
 * agree, which is the drift this module exists to prevent.
 */
export const ADMIN_GATED_MATCHER: readonly string[] = [
  '/api/admin/:path*',
  '/api/feeds',
  '/api/feeds/:id/refresh',
  '/api/feeds/:id/process-remote-items',
  '/api/tracks',
  '/api/playlists',
  '/api/artwork-colors',
  '/api/artwork-colors/batch-process',
  '/api/add-playlist-to-database',
  '/api/music-tracks',
  '/api/music-tracks/database',
  '/api/music-tracks/clear-cache',
  '/api/cache',
  '/api/resolve-hgh-tracks',
  '/api/find-missing-feeds',
  '/api/resolve-missing-feeds',
  '/api/parse-feeds',
  '/api/playlist-cache',
  '/api/playlist/:path*',
  '/api/albums-fast',
];
