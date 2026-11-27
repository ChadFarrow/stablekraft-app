import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  USER_AGENT,
  USER_AGENT_NAME,
  USER_AGENT_LINK,
  USER_AGENT_VERSION,
  userAgentVersion,
  withUserAgent,
} from './user-agent';
import { APP_NAME } from './constants';
import { safeFetch, type FetchLike } from './safe-fetch';
import { fetchFeed, type LookupAll } from './feed-fetch';

const ROOT = path.join(__dirname, '..');

test('USER_AGENT is <AppName>/<version> (+<link>), nothing more', () => {
  assert.match(USER_AGENT, /^StableKraft\/\d+\.\d+ \(\+https:\/\/stablekraft\.app\)$/);
  assert.equal(USER_AGENT, `${USER_AGENT_NAME}/${USER_AGENT_VERSION} (+${USER_AGENT_LINK})`);
  // No email, no browser imitation, no other app's name.
  assert.doesNotMatch(USER_AGENT, /@|Mozilla|Chrome|Safari|AppleWebKit|Gecko/);
});

test('the name is APP_NAME, the one other apps already see on boosts and boost notes', () => {
  assert.equal(USER_AGENT_NAME, APP_NAME);
});

test('the version is the major.minor of package.json, as the app shows it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const majorMinor = /^(\d+\.\d+)/.exec(pkg.version)?.[1];
  assert.ok(majorMinor, `package.json version ${pkg.version} has no major.minor`);
  assert.equal(USER_AGENT_VERSION, majorMinor);
});

test('userAgentVersion drops the commit suffix and keeps anything it cannot parse', () => {
  assert.equal(userAgentVersion('1.2a9078bf8'), '1.2');
  assert.equal(userAgentVersion('2.3.0'), '2.3');
  assert.equal(userAgentVersion('  1.10 '), '1.10');
  assert.equal(userAgentVersion('beta'), 'beta');
  assert.equal(userAgentVersion(''), '0');
  assert.equal(userAgentVersion(undefined), '0');
});

test('the link is the live site over https, not a local or preview host', () => {
  const u = new URL(USER_AGENT_LINK);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.hostname, 'stablekraft.app');
});

test('withUserAgent adds ours, and a caller-set User-Agent wins under any case', () => {
  assert.deepEqual(withUserAgent(undefined), { 'User-Agent': USER_AGENT });
  assert.deepEqual(withUserAgent({ Accept: 'image/*' }), { 'User-Agent': USER_AGENT, Accept: 'image/*' });

  for (const key of ['User-Agent', 'user-agent', 'USER-AGENT']) {
    const given = { [key]: 'Mine/1' };
    const out = withUserAgent(given);
    // Exactly one key: fetch joins two spellings of one header into "a, b".
    assert.deepEqual(Object.keys(out), [key]);
    assert.equal(out[key], 'Mine/1');
  }

  const input = { Accept: 'x' };
  withUserAgent(input);
  assert.deepEqual(input, { Accept: 'x' }, 'the caller object is not changed');
});

/** A fetch stand-in that records the User-Agent of every request. */
function recordingFetch(routes: Record<string, () => Response>) {
  const sent: Array<{ url: string; ua: string | null }> = [];
  const impl: FetchLike = async (input, init) => {
    sent.push({ url: input, ua: new Headers(init?.headers).get('user-agent') });
    const make = routes[input];
    if (!make) throw new Error(`unexpected fetch: ${input}`);
    return make();
  };
  return { impl, sent };
}

test('safeFetch sends USER_AGENT on every hop when the caller sets none', async () => {
  const { impl, sent } = recordingFetch({
    'https://a.example/feed': () => new Response(null, { status: 302, headers: { location: 'https://b.example/feed' } }),
    'https://b.example/feed': () => new Response('ok'),
  });
  const got = await safeFetch('https://a.example/feed', { fetchImpl: impl });
  assert.equal(got.ok, true);
  assert.deepEqual(sent, [
    { url: 'https://a.example/feed', ua: USER_AGENT },
    { url: 'https://b.example/feed', ua: USER_AGENT },
  ]);
});

test("safeFetch keeps a caller's User-Agent and does not add a second one", async () => {
  const { impl, sent } = recordingFetch({ 'https://a.example/x': () => new Response('ok') });
  await safeFetch('https://a.example/x', { fetchImpl: impl, headers: { ['user-agent']: 'Mine/1' } });
  assert.deepEqual(sent, [{ url: 'https://a.example/x', ua: 'Mine/1' }]);
});

test('fetchFeed sends USER_AGENT, on the guarded path and on the loopback escape', async () => {
  const lookup: LookupAll = async () => ['93.184.215.14'];
  const guarded = recordingFetch({ 'https://feeds.example/rss': () => new Response('<rss/>') });
  await fetchFeed('https://feeds.example/rss', { fetchImpl: guarded.impl, lookup, env: {} });
  assert.deepEqual(guarded.sent, [{ url: 'https://feeds.example/rss', ua: USER_AGENT }]);

  const loop = recordingFetch({ 'http://127.0.0.1:9/rss': () => new Response('<rss/>') });
  await fetchFeed('http://127.0.0.1:9/rss', {
    fetchImpl: loop.impl,
    lookup,
    env: { FEED_FETCH_ALLOW_LOOPBACK: '1' },
  });
  assert.deepEqual(loop.sent, [{ url: 'http://127.0.0.1:9/rss', ua: USER_AGENT }]);
});

/**
 * A User-Agent written as a string literal anywhere in the code. Every request
 * names USER_AGENT (or goes through safeFetch / fetchFeed, which add it), so a
 * literal is a new private name, a browser imitation or another app's name.
 *
 * KEEP: a file may keep a literal only when a probe showed a real host refusing
 * USER_AGENT and accepting the old name. Write the host, the probe date and the
 * result next to the literal, and the file here. On 2026-11-27 no host did.
 */
const KEEP: ReadonlySet<string> = new Set<string>([]);

const LITERAL_UA = [
  /['"`]user-agent['"`]\s*:\s*['"`]/i,
  /\.set\(\s*['"`]user-agent['"`]\s*,\s*['"`]/i,
];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

test('no code writes a User-Agent as a string literal', () => {
  const self = path.join(ROOT, 'lib', 'user-agent.test.ts');
  const offenders: string[] = [];
  let scanned = 0;
  for (const top of ['app', 'lib', 'components', 'contexts', 'hooks', 'scripts']) {
    const dir = path.join(ROOT, top);
    if (!fs.existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      if (file === self) continue;
      scanned++;
      const rel = path.relative(ROOT, file);
      if (KEEP.has(rel)) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (LITERAL_UA.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  // A floor, so a broken walk cannot pass by scanning nothing.
  assert.ok(scanned > 500, `expected to scan the source tree, scanned ${scanned} files`);
  assert.deepEqual(offenders, [], `use USER_AGENT from lib/user-agent.js:\n  ${offenders.join('\n  ')}`);
});
