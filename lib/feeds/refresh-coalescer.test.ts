// Run: npx tsx --test lib/feeds/refresh-coalescer.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshCoalescer } from './refresh-coalescer';

/**
 * Anyone can send a podping, and every podping reaches refresh-by-url from the
 * ONE podping-service IP, whose 30/min budget is shared by every feed. A burst
 * for one feed must cost one refresh per window — and a real second update
 * inside the window must still be read, never dropped.
 */

const WINDOW = 5 * 60_000;

function harness() {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const logs: string[] = [];
  const c = new RefreshCoalescer({
    windowMs: WINDOW,
    now: () => now,
    setTimer: (fn, ms) => {
      timers.push({ at: now + ms, fn });
    },
    log: (msg) => logs.push(msg),
  });
  return {
    c,
    logs,
    advance(ms: number) {
      now += ms;
    },
    /** Fire every timer that is due, in order; returns how many fired. */
    async fireDue() {
      let fired = 0;
      timers.sort((a, b) => a.at - b.at);
      while (timers.length && timers[0].at <= now) {
        timers.shift()!.fn();
        fired++;
        await new Promise((r) => setImmediate(r));
      }
      return fired;
    },
    pending: () => timers.length,
  };
}

test('the first request runs now and returns its value', async () => {
  const h = harness();
  const out = await h.c.runOrDefer('feed-a', async () => 'body', async () => {});
  assert.deepEqual(out, { ran: true, value: 'body' });
  assert.equal(h.pending(), 0);
});

test('a request inside the window is deferred to ONE trailing run at the window end', async () => {
  const h = harness();
  let trailing = 0;
  await h.c.runOrDefer('feed-a', async () => 1, async () => { trailing++; });
  h.advance(60_000);
  const second = await h.c.runOrDefer('feed-a', async () => 2, async () => { trailing++; });
  assert.equal(second.ran, false);
  if (!second.ran) assert.equal(second.runAt, 1_000_000 + WINDOW);
  // More requests join the same trailing run.
  for (let i = 0; i < 20; i++) {
    const again = await h.c.runOrDefer('feed-a', async () => 3, async () => { trailing++; });
    assert.equal(again.ran, false);
  }
  assert.equal(h.pending(), 1);
  h.advance(WINDOW);
  await h.fireDue();
  assert.equal(trailing, 1, 'twenty-one deferred requests, one refresh');
});

test('the trailing run starts a new window', async () => {
  const h = harness();
  let trailing = 0;
  await h.c.runOrDefer('feed-a', async () => 1, async () => { trailing++; });
  await h.c.runOrDefer('feed-a', async () => 2, async () => { trailing++; });
  h.advance(WINDOW);
  await h.fireDue();
  // Straight after the trailing run: inside ITS window, so deferred again.
  const next = await h.c.runOrDefer('feed-a', async () => 3, async () => { trailing++; });
  assert.equal(next.ran, false);
  h.advance(WINDOW);
  await h.fireDue();
  assert.equal(trailing, 2);
});

test('after a quiet window the next request runs immediately', async () => {
  const h = harness();
  await h.c.runOrDefer('feed-a', async () => 1, async () => {});
  h.advance(WINDOW + 1);
  const out = await h.c.runOrDefer('feed-a', async () => 2, async () => {});
  assert.deepEqual(out, { ran: true, value: 2 });
});

test('different feeds do not wait for each other', async () => {
  const h = harness();
  await h.c.runOrDefer('feed-a', async () => 1, async () => {});
  const b = await h.c.runOrDefer('feed-b', async () => 2, async () => {});
  assert.deepEqual(b, { ran: true, value: 2 });
});

test('a request while a refresh is running queues one trailing run after it', async () => {
  const h = harness();
  let release!: () => void;
  const running = h.c.runOrDefer('feed-a', () => new Promise<number>((r) => { release = () => r(1); }), async () => {});
  let trailing = 0;
  const during = await h.c.runOrDefer('feed-a', async () => 2, async () => { trailing++; });
  assert.equal(during.ran, false);
  release();
  await running;
  h.advance(WINDOW);
  await h.fireDue();
  assert.equal(trailing, 1);
});

test('an admin request bypasses the window but still starts one', async () => {
  const h = harness();
  await h.c.runOrDefer('feed-a', async () => 1, async () => {});
  const admin = await h.c.runOrDefer('feed-a', async () => 2, async () => {}, { bypass: true });
  assert.deepEqual(admin, { ran: true, value: 2 });
});

test('a failed run does not wedge the feed', async () => {
  const h = harness();
  await assert.rejects(h.c.runOrDefer('feed-a', async () => { throw new Error('boom'); }, async () => {}));
  h.advance(WINDOW + 1);
  const out = await h.c.runOrDefer('feed-a', async () => 'ok', async () => {});
  assert.deepEqual(out, { ran: true, value: 'ok' });
});

test('a failed trailing run is logged, not thrown', async () => {
  const h = harness();
  await h.c.runOrDefer('feed-a', async () => 1, async () => {});
  await h.c.runOrDefer('feed-a', async () => 2, async () => { throw new Error('boom'); });
  h.advance(WINDOW);
  await h.fireDue();
  assert.ok(h.logs.some((l) => l.includes('feed-a') && l.includes('boom')));
});
