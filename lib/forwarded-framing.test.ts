import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardableContentLength } from './forwarded-framing';

test('an unencoded body keeps its length (ordinary audio, video and images)', () => {
  assert.equal(forwardableContentLength(new Headers({ 'content-length': '5242880' })), '5242880');
  assert.equal(
    forwardableContentLength(new Headers({ 'content-length': '512', 'content-encoding': 'identity' })),
    '512'
  );
  assert.equal(
    forwardableContentLength(new Headers({ 'content-length': '512', 'content-encoding': ' Identity ' })),
    '512'
  );
});

test('an encoded body loses its length, because fetch() decoded it', () => {
  for (const encoding of ['gzip', 'br', 'deflate', 'zstd', 'gzip, br', 'GZIP']) {
    assert.equal(
      forwardableContentLength(new Headers({ 'content-length': '512', 'content-encoding': encoding })),
      null,
      encoding
    );
  }
});

test('no upstream length, no length', () => {
  assert.equal(forwardableContentLength(new Headers()), null);
  assert.equal(forwardableContentLength(new Headers({ 'content-encoding': 'gzip' })), null);
});

/**
 * The guard only works if every route that streams a fetched body uses it. A
 * route that copies `content-length` itself next to `<response>.body` is the
 * GHSA-pc58-hwjq-p385 pattern again.
 */
test('every route that streams a fetched body takes its length from forwardableContentLength', () => {
  const apiDir = fileURLToPath(new URL('../app/api', import.meta.url));
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === 'route.ts') routes.push(path);
    }
  };
  walk(apiDir);
  assert.ok(routes.length > 50, `found only ${routes.length} routes — the walk is broken`);

  const streaming = routes.filter((path) =>
    /new (?:Next)?Response\(\s*\w+\.body\b/.test(readFileSync(path, 'utf8'))
  );
  assert.ok(streaming.length >= 2, `expected proxy-audio and proxy-video, found ${streaming.length}`);
  for (const path of streaming) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /forwardableContentLength\(/, `${path} streams a fetched body without the guard`);
    assert.doesNotMatch(
      source,
      /headers\.get\(\s*['"]content-length['"]\s*\)/i,
      `${path} reads the upstream Content-Length directly — use forwardableContentLength`
    );
  }
});
