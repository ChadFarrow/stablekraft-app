import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_AUDIO_CACHE, purgeLegacyAudioCache } from './legacy-audio-cache';
import { DOWNLOADS_CACHE, DOWNLOADS_ART_CACHE } from './downloads/downloads-cache';

/**
 * A CacheStorage holding the buckets a real profile had on 2026-11-17: the
 * automatic audio cache (4.52 GB), the user's downloads and their art, and the
 * service worker's own buckets.
 */
function fakeCacheStorage(names: string[]) {
  const store = new Set(names);
  const deleted: string[] = [];
  const storage = {
    async delete(name: string) {
      deleted.push(name);
      return store.delete(name);
    },
    async open(): Promise<never> {
      throw new Error('the purge must never open a cache');
    },
    async keys() {
      return [...store];
    },
  };
  return { storage, store, deleted };
}

const REAL_PROFILE = [
  LEGACY_AUDIO_CACHE,
  DOWNLOADS_CACHE,
  DOWNLOADS_ART_CACHE,
  'workbox-precache-v2-https://stablekraft.app/',
  'pages-cache',
];

test('the purge targets the exact bucket that filled 4.5 GB', () => {
  assert.equal(LEGACY_AUDIO_CACHE, 'stablekraft-audio-cache-v1');
});

test('deletes the automatic audio cache and nothing else', async () => {
  const { storage, store, deleted } = fakeCacheStorage(REAL_PROFILE);
  assert.equal(await purgeLegacyAudioCache(storage), true);
  assert.deepEqual(deleted, [LEGACY_AUDIO_CACHE]);
  assert.deepEqual(
    [...store].sort(),
    REAL_PROFILE.filter((n) => n !== LEGACY_AUDIO_CACHE).sort(),
  );
});

test('the user downloads are never the purge target', async () => {
  // A name-prefix match ("stablekraft-") would take the downloads with it.
  const { storage, store } = fakeCacheStorage([DOWNLOADS_CACHE, DOWNLOADS_ART_CACHE]);
  assert.equal(await purgeLegacyAudioCache(storage), false);
  assert.ok(store.has(DOWNLOADS_CACHE));
  assert.ok(store.has(DOWNLOADS_ART_CACHE));
  assert.notEqual(LEGACY_AUDIO_CACHE, DOWNLOADS_CACHE);
  assert.notEqual(LEGACY_AUDIO_CACHE, DOWNLOADS_ART_CACHE);
});

test('a second visit finds nothing to delete', async () => {
  const { storage } = fakeCacheStorage(REAL_PROFILE);
  assert.equal(await purgeLegacyAudioCache(storage), true);
  assert.equal(await purgeLegacyAudioCache(storage), false);
});

test('no Cache API (SSR, old WebView) resolves false and does not throw', async () => {
  assert.equal(await purgeLegacyAudioCache(undefined), false);
});

test('a CacheStorage that rejects (private window, blocked storage) resolves false', async () => {
  const storage = {
    async delete(): Promise<boolean> {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  };
  assert.equal(await purgeLegacyAudioCache(storage), false);
});

/**
 * The app wrote whole songs into Cache Storage that nothing ever read and
 * nothing ever removed. The only buckets the page may write are the user's
 * downloads, which the user adds and removes on the Downloads page. A new
 * `caches.open` anywhere else needs a byte limit with eviction, and a reader.
 */
test('only the downloads layer opens a Cache Storage bucket', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dirs = ['app', 'lib', 'components', 'contexts', 'hooks'];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.ts$/.test(name)) {
        const src = readFileSync(path, 'utf8');
        if (/caches\s*\.\s*open\s*\(/.test(src) || src.includes(LEGACY_AUDIO_CACHE)) {
          offenders.push(relative(root, path));
        }
      }
    }
  };
  for (const d of dirs) walk(join(root, d));
  assert.deepEqual(offenders.sort(), ['lib/downloads/downloads-cache.ts', 'lib/legacy-audio-cache.ts']);
});
