/**
 * Every placeholder image the code names must be a real image in public/.
 *
 * public/placeholder-podcast.jpg was a 1-byte file from the initial commit to
 * 2026-11-01. It answered HTTP 200, so nothing looked broken on the server, while
 * every <img> that fell back to it — 33 code paths, the Top 100 page's cover among
 * them — drew a broken-image box. A status check cannot see this; the bytes can.
 *
 *   npx tsx --test lib/public-placeholder-images.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE_DIRS = ['app', 'components', 'lib', 'contexts'];
const REF = /['"`]\/((?:[\w-]*placeholder[\w-]*)\.(?:jpe?g|png|webp|gif))['"`?]/g;

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') yield* sourceFiles(p); }
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) yield p;
  }
}

function kind(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif';
  return null;
}

test('every placeholder image the code names is a real image in public/', () => {
  const refs = new Map<string, string>();
  for (const dir of SOURCE_DIRS) {
    if (!existsSync(join(ROOT, dir))) continue;
    for (const file of sourceFiles(join(ROOT, dir))) {
      for (const m of readFileSync(file, 'utf8').matchAll(REF)) if (!refs.has(m[1])) refs.set(m[1], file.slice(ROOT.length));
    }
  }
  assert.ok(refs.has('placeholder-podcast.jpg'), 'the scan must at least find placeholder-podcast.jpg');
  for (const [name, firstUse] of refs) {
    const path = join(ROOT, 'public', name);
    assert.ok(existsSync(path), `${name} (used in ${firstUse}) is missing from public/`);
    const bytes = readFileSync(path);
    const k = kind(bytes);
    assert.ok(k, `${name} (used in ${firstUse}) is not an image: ${bytes.length} bytes`);
    assert.ok(bytes.length > 1024, `${name} is only ${bytes.length} bytes`);
    const ext = name.split('.').pop()!.replace('jpg', 'jpeg');
    assert.equal(k, ext, `${name} holds ${k} data under a .${ext} name`);
  }
});
