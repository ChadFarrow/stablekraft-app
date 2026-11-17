/**
 * NIP-46 request pacing: a request that comes too soon WAITS for its slot.
 *
 * Run: npx tsx --test lib/nostr/nip46-pacing.test.ts
 *
 * The client used to THROW instead ("Rate limit: Please wait 1 seconds…").
 * One heart tap asks for two `sign_event`s ~100ms apart (the kind 30001 item
 * and the kind 10333 list), so the list publish failed on every tap; in
 * Private mode a page load decrypts the private half twice, the second
 * `nip44_decrypt` failed, and the sync stopped on "the private half is
 * unreadable" — a bunker user on Private got no automatic update at all.
 * Found by `npm run e2e:signers` against a real `nak bunker`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paceRequest } from './nip46-pacing';

test('the first request of a method goes at once', () => {
  assert.deepEqual(paceRequest({ method: 'sign_event', now: 10_000, last: undefined, limitMs: 500 }), {
    sendAt: 10_000,
    waitMs: 0,
  });
});

test('a request after the window goes at once', () => {
  assert.deepEqual(paceRequest({ method: 'sign_event', now: 10_600, last: 10_000, limitMs: 500 }), {
    sendAt: 10_600,
    waitMs: 0,
  });
});

test('a request inside the window waits for the end of it, rather than failing', () => {
  // The heart tap: the kind 30001 item at 10_000, the kind 10333 list 100ms later.
  assert.deepEqual(paceRequest({ method: 'sign_event', now: 10_100, last: 10_000, limitMs: 500 }), {
    sendAt: 10_500,
    waitMs: 400,
  });
});

test('requests that queue up go one window apart, in order', () => {
  // The slot is RESERVED when it is handed out, so a third caller that arrives
  // while the second is still waiting is paced from the second, not the first.
  const first = paceRequest({ method: 'nip44_decrypt', now: 10_000, last: undefined, limitMs: 500 });
  const second = paceRequest({ method: 'nip44_decrypt', now: 10_050, last: first.sendAt, limitMs: 500 });
  const third = paceRequest({ method: 'nip44_decrypt', now: 10_060, last: second.sendAt, limitMs: 500 });
  assert.deepEqual([first.sendAt, second.sendAt, third.sendAt], [10_000, 10_500, 11_000]);
  assert.deepEqual([second.waitMs, third.waitMs], [450, 940]);
});

test('connect is never paced', () => {
  assert.deepEqual(paceRequest({ method: 'connect', now: 10_100, last: 10_000, limitMs: 2000 }), {
    sendAt: 10_100,
    waitMs: 0,
  });
});

test('a clock that went backwards does not stall a request beyond one window', () => {
  // `last` is a reserved slot, so it can sit in the future by at most one window
  // per queued caller; a wall-clock jump must not turn that into a long stall.
  const paced = paceRequest({ method: 'sign_event', now: 5_000, last: 60_000, limitMs: 500 });
  assert.deepEqual(paced, { sendAt: 5_500, waitMs: 500 });
});

test('NIP46Client paces through paceRequest and no longer throws on its own limit', () => {
  const source = readFileSync(new URL('./nip46-client.ts', import.meta.url), 'utf8');
  assert.match(source, /paceRequest\(/, 'sendRelayRequest must take its slot from paceRequest');
  assert.doesNotMatch(
    source,
    /seconds before sending another/,
    'the client must wait for its slot, never throw on its own pacing'
  );
});
