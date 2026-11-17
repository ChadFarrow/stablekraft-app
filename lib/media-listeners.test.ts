import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// AudioProvider's media listeners, read from the source. There is no DOM test
// environment here; the behaviour itself was measured in a real browser.
const source = readFileSync(
  fileURLToPath(new URL('../contexts/AudioContext.tsx', import.meta.url)),
  'utf8'
);

function between(from: string, to: string): string {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + from.length);
  assert.ok(a > 0 && b > a, `found the block from "${from}" to "${to}"`);
  return source.slice(a, b);
}

test('the media listeners are bound once, not on every render', () => {
  // They were bound in an effect whose deps changed on every `timeupdate`, so all
  // 27 were removed and re-added on each tick: 101.3 removes and 101.3 adds a
  // second while a song played (production build, 2026-11-17). Bound once, the
  // count during playback is 0.
  const block = between('// Media event listeners:', '// HLS teardown');
  assert.match(block, /addEventListener\(type, listener\)/);
  assert.match(block, /removeEventListener\(type, listener\)/);
  assert.match(block, /\}, \[\]\);\s*$/, 'the binding effect has an empty dependency list');
});

test('nothing else binds a media handler directly', () => {
  // A second binding of the handlers themselves — rather than of the stable
  // listeners that call through mediaHandlersRef — would bring the churn back.
  assert.doesNotMatch(source, /\.addEventListener\(\s*['"][a-z]+['"]\s*,\s*handle(Play|Pause|Ended|TimeUpdate|LoadedMetadata|DurationChange|Error|Stalled|Waiting)\b/);
});

test('the handlers are refreshed after every render, so they never go stale', () => {
  // They read state the binding never sees: chapters, isPlaying, radioMode and
  // publishNip38StatusDebounced. The effect that refreshes them must therefore
  // have NO dependency list — a list would freeze them between its changes.
  const block = between('// Media event handlers.', '// Media event listeners:');
  assert.match(block, /mediaHandlersRef\.current = \{/);
  assert.match(block, /\n {2}\}\);\s*$/, 'the handler effect ends with "});" — no dependency list');
});

test('the HLS teardown runs on a new track, album, mode or queue — not on every tick', () => {
  // With a deps list that changed on every `timeupdate`, pausing an HLS video
  // re-rendered once more, found the video paused and destroyed its stream:
  // src emptied, position back to 0, and Play did nothing (measured on main,
  // 2026-11-17).
  const block = between('// HLS teardown', '// Silent stall detection');
  assert.match(block, /hlsRef\.current\.destroy\(\)/);
  const deps = block.slice(block.lastIndexOf('}, ['));
  assert.doesNotMatch(deps, /publishNip38StatusDebounced|currentTime|duration\b/);
  assert.match(deps, /currentTrackIndex/);
});
