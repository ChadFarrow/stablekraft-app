import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { holdsSource } from './media-source';
import { proxiedAudioUrl } from './audio-url-utils';

const BASE = 'https://stablekraft.app/album/some-album';
const TRACK = 'https://d12wklypp119aj.cloudfront.net/track/7044d174-bb01-4ab3-943d-b750f1888b15.mp3';
const NEXT = 'https://d12wklypp119aj.cloudfront.net/track/80bd9737-311f-4695-a406-1b8aaa9f754f.mp3';

/** What `el.src` reads back after `el.src = url` in a browser: resolved and serialized. */
const readBack = (url: string) => new URL(url, BASE).href;

test('a proxied track: the element reads back absolute, the app holds it relative', () => {
  const wanted = proxiedAudioUrl(TRACK);
  assert.ok(wanted.startsWith('/api/proxy-audio?url='), 'the proxy URL is relative — the premise of the bug');
  assert.notEqual(readBack(wanted), wanted, 'and a plain === can therefore never match');
  assert.equal(holdsSource(readBack(wanted), wanted, BASE), true);
});

test('a different track is not held', () => {
  assert.equal(holdsSource(readBack(proxiedAudioUrl(TRACK)), proxiedAudioUrl(NEXT), BASE), false);
  assert.equal(holdsSource(TRACK, NEXT, BASE), false);
});

test('an absolute URL and a blob: URL still match themselves', () => {
  assert.equal(holdsSource(TRACK, TRACK, BASE), true);
  const blob = 'blob:https://stablekraft.app/2f0c6a3e-4f7d-4a51-9a52-1b2f0a7b6c11';
  assert.equal(holdsSource(blob, blob, BASE), true);
});

test('an element with no source holds nothing — not even the page it sits on', () => {
  // `new URL('', base)` is the base itself, so an empty src must be refused
  // before anything is resolved, or an idle element "holds" the page URL.
  assert.equal(holdsSource('', BASE, BASE), false);
  assert.equal(holdsSource('', proxiedAudioUrl(TRACK), BASE), false);
  assert.equal(holdsSource(null, TRACK, BASE), false);
  assert.equal(holdsSource(undefined, TRACK, BASE), false);
  assert.equal(holdsSource(TRACK, '', BASE), false);
});

test('a URL the element serializes differently is still the same source', () => {
  const spaced = 'https://example.com/music/my song.mp3';
  assert.equal(holdsSource(readBack(spaced), spaced, BASE), true);
});

test('http and https are different sources', () => {
  assert.equal(holdsSource(TRACK.replace('https:', 'http:'), TRACK, BASE), false);
});

test('an unparseable URL is refused rather than thrown', () => {
  assert.equal(holdsSource('http://[bad', 'http://[bad2', 'not a base'), false);
});

test('AudioContext compares no media src with a raw === any more', () => {
  // Three places compared `el.src` with a URL the app built, and every one was
  // wrong for a proxied track: the 15s warm-up restarted ~55 times per song
  // change, the Android 5s preload reloaded the idle element on every tick,
  // and the ping-pong handoff never reused what it had preloaded.
  const source = readFileSync(
    fileURLToPath(new URL('../contexts/AudioContext.tsx', import.meta.url)),
    'utf8'
  );
  const raw = source
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
    .filter(({ line }) => /\.src\s*(===|!==|==|!=)\s|\s(===|!==|==|!=)\s*[\w.]+\.src\b/.test(line));
  assert.deepEqual(raw, [], 'use holdsSource() from lib/media-source.ts');
});

test("the per-render cleanup does not drop the 15s warm-up", () => {
  // The media handlers are refreshed after every render — about four a second
  // while a song plays, one per `timeupdate`. A drop of the warm-up in that
  // cleanup rebuilt it four times a second. Fixing only the URL compare above
  // changed nothing: measured on 2026-11-17, still 53 rebuilds per song change.
  // Both had to go.
  const source = readFileSync(
    fileURLToPath(new URL('../contexts/AudioContext.tsx', import.meta.url)),
    'utf8'
  );
  const start = source.indexOf('// Media event handlers.');
  const end = source.indexOf('// Media event listeners:', start);
  assert.ok(start > 0 && end > start, 'found the media-handler effect');
  const effect = source.slice(start, end);
  const cleanup = effect.slice(effect.lastIndexOf('return () => {'));
  assert.ok(cleanup.includes('iosAdvanceTimerRef'), 'found its cleanup');
  assert.doesNotMatch(cleanup, /preloadAudioRef\.current\s*=\s*null/);
  assert.match(source, /useEffect\(\s*\(\) => dropPreloader,/, 'the warm-up has an effect of its own');
});
