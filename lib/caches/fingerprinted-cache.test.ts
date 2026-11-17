import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFingerprintedCache, type RebuildReason } from './fingerprinted-cache';

const CHECK = 15 * 60 * 1000;
const MAX_AGE = 6 * 60 * 60 * 1000;

/** A cache over a fake source whose fingerprint and contents the test controls. */
function harness() {
  let clock = 1_000_000;
  const source = { fp: 'v1', data: 'rows@v1', fingerprintFails: false, loadFails: false };
  const calls = { fingerprint: 0, load: 0 };
  const rebuilds: RebuildReason[] = [];
  const errors: unknown[] = [];
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;

  const cache = createFingerprintedCache<string>({
    checkIntervalMs: CHECK,
    maxAgeMs: MAX_AGE,
    now: () => clock,
    fingerprint: async () => {
      calls.fingerprint++;
      if (source.fingerprintFails) throw new Error('fingerprint down');
      return source.fp;
    },
    onRebuild: (reason) => rebuilds.push(reason),
    onBackgroundError: (e) => errors.push(e),
  });

  const load = async () => {
    calls.load++;
    const snapshot = source.data;
    if (gate) await gate;
    if (source.loadFails) throw new Error('db down');
    return snapshot;
  };

  return {
    cache, source, calls, rebuilds, errors,
    get: () => cache.get(load),
    advance: (ms: number) => { clock += ms; },
    /** Make the next loads wait until release() is called. */
    hold: () => { gate = new Promise((r) => { release = () => { gate = null; r(); }; }); },
    release: () => release?.(),
  };
}

test('a cold cache loads once and serves from memory inside the check interval', async () => {
  const h = harness();
  assert.equal(await h.get(), 'rows@v1');
  h.advance(CHECK - 1);
  assert.equal(await h.get(), 'rows@v1');
  assert.deepEqual(h.calls, { fingerprint: 1, load: 1 });
  assert.deepEqual(h.rebuilds, ['cold']);
});

test('concurrent cold requests share one load', async () => {
  const h = harness();
  const results = await Promise.all([h.get(), h.get(), h.get(), h.get()]);
  assert.deepEqual(results, ['rows@v1', 'rows@v1', 'rows@v1', 'rows@v1']);
  assert.equal(h.calls.load, 1);
});

test('an unchanged fingerprint after the interval costs one probe and no load', async () => {
  const h = harness();
  await h.get();
  h.advance(CHECK);
  assert.equal(await h.get(), 'rows@v1');
  await h.cache.settled();
  assert.deepEqual(h.calls, { fingerprint: 2, load: 1 });
  // And the successful check restarts the interval.
  h.advance(CHECK - 1);
  await h.get();
  assert.equal(h.calls.fingerprint, 2);
});

test('a changed fingerprint rebuilds behind the request; the NEXT request sees the new rows', async () => {
  const h = harness();
  await h.get();
  h.source.fp = 'v2';
  h.source.data = 'rows@v2';
  h.advance(CHECK);
  // Served from memory immediately — this request does not wait on the rebuild.
  assert.equal(await h.get(), 'rows@v1');
  await h.cache.settled();
  assert.equal(await h.get(), 'rows@v2');
  assert.deepEqual(h.rebuilds, ['cold', 'changed']);
});

test('max age rebuilds even when the fingerprint never moves', async () => {
  const h = harness();
  await h.get();
  for (let t = CHECK; t < MAX_AGE; t += CHECK) {
    h.advance(CHECK);
    await h.get();
    await h.cache.settled();
  }
  assert.equal(h.calls.load, 1, 'no rebuild before max age');
  h.advance(CHECK);
  await h.get();
  await h.cache.settled();
  assert.equal(h.calls.load, 2);
  assert.equal(h.rebuilds.at(-1), 'max-age');
});

test('invalidate: the next request waits for a fresh load', async () => {
  const h = harness();
  await h.get();
  h.source.data = 'rows@v2'; // a write the fingerprint has not been asked about yet
  h.cache.invalidate();
  assert.equal(await h.get(), 'rows@v2');
  assert.deepEqual(h.rebuilds, ['cold', 'invalidated']);
});

test('invalidate during an in-flight build: the next request is NOT handed the pre-change rows', async () => {
  const h = harness();
  h.hold();
  const first = h.get(); // cold load starts, reads rows@v1, then blocks
  await new Promise((r) => setImmediate(r));
  h.source.data = 'rows@v2';
  h.source.fp = 'v2';
  h.cache.invalidate();
  const second = h.get(); // must not simply join the pre-change build
  h.release();
  assert.equal(await first, 'rows@v1');
  assert.equal(await second, 'rows@v2');
  assert.equal(h.calls.load, 2);
});

test('a failed fingerprint counts as changed, never as unchanged', async () => {
  const h = harness();
  await h.get();
  h.source.fingerprintFails = true;
  h.advance(CHECK);
  await h.get();
  await h.cache.settled();
  assert.equal(h.calls.load, 2);
  assert.equal(h.rebuilds.at(-1), 'fingerprint-failed');
  assert.equal(h.errors.length, 1);
});

test('a failed background rebuild keeps serving the old rows, reports once, and retries next request', async () => {
  const h = harness();
  await h.get();
  h.source.fp = 'v2';
  h.source.loadFails = true;
  h.advance(CHECK);
  assert.equal(await h.get(), 'rows@v1');
  assert.equal(await h.get(), 'rows@v1');
  await h.cache.settled();
  assert.equal(h.errors.length, 1);
  assert.equal(await h.get(), 'rows@v1'); // still the old rows…
  await h.cache.settled();
  assert.equal(h.calls.load, 3); // …and it tried again rather than waiting out an interval
  h.source.loadFails = false;
  h.source.data = 'rows@v2';
  await h.get();
  await h.cache.settled();
  assert.equal(await h.get(), 'rows@v2');
});

test('a failed cold load rejects, and the next request tries again', async () => {
  const h = harness();
  h.source.loadFails = true;
  await assert.rejects(h.get(), /db down/);
  h.source.loadFails = false;
  assert.equal(await h.get(), 'rows@v1');
  assert.equal(h.calls.load, 2);
});
