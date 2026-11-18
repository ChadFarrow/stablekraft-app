/**
 * NIP-46 request pacing.
 *
 * `NIP46Client` spaces requests of the same method by an adaptive window
 * (500–2000ms, from the signer's measured response time), so a burst does not
 * flood a phone signer such as Amber. A request that comes inside the window
 * WAITS for its slot. It used to throw, and two callers of this app send the
 * same method twice inside the window as a matter of course:
 *
 *  - a heart tap signs the kind 30001 item and the kind 10333 list ~100ms apart,
 *    so the list publish failed on every tap and waited for the next page load;
 *  - a page load in Private mode decrypts the private half twice (pull, then
 *    push), so the second `nip44_decrypt` failed and the sync stopped on "the
 *    private half is unreadable" — no automatic update at all.
 *
 * The caller RESERVES the slot (stores `sendAt` as the method's last request)
 * before it waits, so callers that queue up go one window apart, in order.
 * `connect` is never paced: it is the connection itself.
 */
/** More queued requests of one method than this means the clock moved, not a queue. */
const MAX_QUEUED = 32;

export function paceRequest(input: {
  method: string;
  now: number;
  /** The slot the previous request of this method was given, if any. */
  last: number | undefined;
  limitMs: number;
}): { sendAt: number; waitMs: number } {
  const { method, now, last, limitMs } = input;
  if (method === 'connect' || last === undefined) return { sendAt: now, waitMs: 0 };
  // A reserved slot is in the future by at most one window per queued caller.
  // If the wall clock went backwards, wait one window rather than the gap.
  const after = last > now + limitMs * MAX_QUEUED ? now + limitMs : last + limitMs;
  const sendAt = Math.max(now, after);
  return { sendAt, waitMs: sendAt - now };
}
