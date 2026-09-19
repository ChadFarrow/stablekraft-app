import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { requiresAdminAuth, isForceRefresh, ADMIN_GATED_MATCHER } from './admin-route-policy';

const NO_PARAMS = new URLSearchParams();

function gated(path: string, method: string, qs = ''): boolean {
  return requiresAdminAuth(path, method, new URLSearchParams(qs));
}

/**
 * The bug this file exists to prevent: a rule added to the policy but not to
 * `middleware.ts`'s matcher never runs, because middleware is not invoked for
 * an unmatched path. Parsing the literal out of the source is deliberate —
 * importing middleware.ts would pull in `next/server`.
 */
test('middleware.ts matcher covers every path in ADMIN_GATED_MATCHER', () => {
  const source = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  for (const entry of ADMIN_GATED_MATCHER) {
    assert.ok(
      source.includes(`'${entry}'`),
      `middleware.ts matcher is missing '${entry}' — the rule would never run`
    );
  }
});

test('every admin route is gated, except the pre-secret login check', () => {
  assert.equal(gated('/api/admin/feeds', 'GET'), true);
  assert.equal(gated('/api/admin/migrate', 'POST'), true);
  assert.equal(gated('/api/admin/feeds/delete-by-url', 'DELETE'), true);
  assert.equal(gated('/api/admin/verify', 'POST'), false);
});

test('CORS preflight is never gated', () => {
  assert.equal(gated('/api/admin/feeds', 'OPTIONS'), false);
  assert.equal(gated('/api/tracks', 'OPTIONS'), false);
});

test('PUT /api/tracks is gated — it was unrestricted mass assignment', () => {
  assert.equal(gated('/api/tracks', 'PUT'), true);
  assert.equal(gated('/api/tracks', 'DELETE'), true);
  assert.equal(gated('/api/tracks', 'POST'), true);
  // Reads stay open.
  assert.equal(gated('/api/tracks', 'GET'), false);
});

test('catalog-mutating writes are gated but their reads are not', () => {
  for (const path of [
    '/api/playlists',
    '/api/artwork-colors/batch-process',
    '/api/add-playlist-to-database',
    '/api/music-tracks',
    '/api/music-tracks/database',
    '/api/music-tracks/clear-cache',
    '/api/cache',
    '/api/resolve-hgh-tracks',
    '/api/find-missing-feeds',
    '/api/resolve-missing-feeds',
  ]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(gated(path, method), true, `${method} ${path} must be gated`);
    }
    assert.equal(gated(path, 'GET'), false, `GET ${path} must stay public`);
  }
});

// POST /api/artwork-colors computes the Now Playing canvas background for
// ordinary listeners (NowPlayingScreen.tsx, RadioPlayer.tsx). Gating it would
// break that for everyone; only the table-wiping DELETE is dangerous.
test('artwork-colors: DELETE is gated, POST and GET are not', () => {
  assert.equal(gated('/api/artwork-colors', 'DELETE'), true);
  assert.equal(gated('/api/artwork-colors', 'POST'), false);
  assert.equal(gated('/api/artwork-colors', 'GET'), false);
});

test('the podping consumer endpoints stay public — CLAUDE.md', () => {
  assert.equal(gated('/api/feeds', 'GET'), false);
  assert.equal(gated('/api/feeds', 'POST'), false);
  assert.equal(gated('/api/feeds/exists', 'GET'), false);
  assert.equal(gated('/api/feeds/refresh-by-url', 'POST'), false);
  assert.equal(gated('/api/feeds/opml', 'GET'), false);
});

test('PUT and DELETE on /api/feeds are gated', () => {
  assert.equal(gated('/api/feeds', 'PUT'), true);
  assert.equal(gated('/api/feeds', 'DELETE'), true);
});

test('feed sub-routes that reparse and write tracks are gated', () => {
  assert.equal(gated('/api/feeds/abc-123/refresh', 'POST'), true);
  assert.equal(gated('/api/feeds/abc-123/process-remote-items', 'POST'), true);
  // A read of the same sub-route is not a write.
  assert.equal(gated('/api/feeds/abc-123/refresh', 'GET'), false);
  // An unrelated sub-route is not swept up.
  assert.equal(gated('/api/feeds/abc-123', 'GET'), false);
  assert.equal(gated('/api/feeds/abc-123/something-else', 'POST'), false);
});

test('expensive maintenance endpoints are gated for every method', () => {
  for (const path of [
    '/api/parse-feeds',
    '/api/playlist-cache',
    '/api/playlist/parse-feeds',
    '/api/playlist/parse-feeds-stream',
    '/api/playlist/resolve-mmm-tracks',
  ]) {
    assert.equal(gated(path, 'GET'), true, `GET ${path} must be gated`);
    assert.equal(gated(path, 'POST'), true, `POST ${path} must be gated`);
  }
});

test('public playlist reads stay open; ?refresh=true does not', () => {
  assert.equal(gated('/api/playlist/hgh', 'GET'), false);
  assert.equal(gated('/api/playlist/hgh', 'GET', 'refresh=true'), true);
  assert.equal(gated('/api/playlist/hgh', 'GET', 'refresh=false'), false);
});

/**
 * The bypass this pins: the gate asked `get('refresh') === 'true'` while the
 * playlist handler asked `has('refresh')`, so these values skipped the gate and
 * still rebuilt the playlist. Whatever the answer, gate and handler must agree.
 */
test('every refresh value the gate lets through is one the handler treats as a plain read', () => {
  for (const qs of ['refresh=true', 'refresh=1', 'refresh', 'refresh=', 'refresh=TRUE', 'refresh=yes',
    'refresh=false', 'refresh=x&refresh=true', 'foo=bar']) {
    const refreshes = isForceRefresh(new URLSearchParams(qs));
    for (const path of ['/api/playlist/hgh', '/api/playlist/top100', '/api/albums-fast']) {
      assert.equal(gated(path, 'GET', qs), refreshes, `${path}?${qs}: gate and handler disagree`);
    }
  }
});

test('albums-fast: ordinary reads stay open, ?refresh=true is gated', () => {
  assert.equal(gated('/api/albums-fast', 'GET'), false);
  assert.equal(gated('/api/albums-fast', 'GET', 'limit=50&offset=0&filter=all'), false);
  assert.equal(gated('/api/albums-fast', 'GET', 'refresh=true'), true);
  assert.equal(gated('/api/albums-fast', 'GET', 'limit=1000&refresh=true'), true);
});

/**
 * The drift that made the bypass: a handler reading `refresh` with its own
 * expression. Every route the gate covers by refresh must go through
 * isForceRefresh, so the two can never answer differently again.
 */
test('refresh-gated routes read ?refresh only through isForceRefresh', () => {
  const root = new URL('..', import.meta.url);
  const files = [
    ...readdirSync(new URL('app/api/playlist/', root), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `app/api/playlist/${f}`),
    ...readdirSync(new URL('lib/playlist/', root)).filter((f) => f.endsWith('.ts')).map((f) => `lib/playlist/${f}`),
    'app/api/albums-fast/route.ts',
  ];
  assert.ok(files.length > 20, `expected the playlist routes, found ${files.length} files`);
  for (const file of files) {
    const source = readFileSync(new URL(file, root), 'utf8');
    assert.doesNotMatch(
      source,
      /searchParams\s*\.\s*(has|get|getAll)\(\s*['"`]refresh['"`]/,
      `${file} reads ?refresh directly — use isForceRefresh, or the admin gate can disagree with it`
    );
  }
});

test('user-facing routes are NOT gated — gating them would break the app', () => {
  // Called by components/PlaylistAlbum.tsx; guarded by safeFetch instead.
  assert.equal(gated('/api/resolve-audio-urls', 'POST'), false);
  // Called by app/playlist/maker/page.tsx.
  assert.equal(gated('/api/generate-playlist-rss', 'POST'), false);
  // Ordinary reads.
  assert.equal(gated('/api/albums-fast', 'GET'), false);
  assert.equal(gated('/api/favorites/albums', 'POST'), false);
  assert.equal(gated('/api/nostr/auth/login', 'POST'), false);
});

test('method matching is case-insensitive', () => {
  assert.equal(gated('/api/tracks', 'put'), true);
  assert.equal(gated('/api/admin/feeds', 'options'), false);
});
