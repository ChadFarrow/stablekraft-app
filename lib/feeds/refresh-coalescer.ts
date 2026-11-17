/**
 * At most one refresh per feed per window, and never a lost update.
 *
 * WHY: anyone can send a podping for any feed, from anywhere, and every podping
 * reaches `POST /api/feeds/refresh-by-url` from ONE caller — the podping
 * service — whose per-IP budget (30/min) is shared by every feed. So a burst for
 * one feed used up the budget, and a real update for another feed got a 429,
 * which the podping service logs and never retries: lost until the nightly job.
 * The service also rewinds ~10 minutes of blocks on every restart, replaying
 * recent podpings as fresh refreshes.
 *
 * HOW: a request inside a feed's window, or while its refresh is running, does
 * not run now. It arms ONE trailing refresh at the end of the window, and every
 * further request joins it. A burst costs one refresh per window, and a second
 * real update inside the window is still read — a plain "skip" would drop it.
 *
 * In memory, so the window is per process. Railway runs one instance today; a
 * second instance would give each its own window, which is still correct, just
 * less thrifty.
 */

type Timer = (fn: () => void, ms: number) => unknown;

export interface CoalescerOptions {
  windowMs: number;
  /** Test seams. */
  now?: () => number;
  setTimer?: Timer;
  log?: (message: string) => void;
}

interface FeedState {
  lastStart: number;
  running: boolean;
  trailing: (() => Promise<unknown>) | null;
  armed: boolean;
}

export type Outcome<T> = { ran: true; value: T } | { ran: false; runAt: number };

/** Idle states beyond this many are pruned on the next request. */
const PRUNE_ABOVE = 1000;

export class RefreshCoalescer {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly setTimer: Timer;
  private readonly log: (message: string) => void;
  private readonly states = new Map<string, FeedState>();

  constructor(opts: CoalescerOptions) {
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
    this.setTimer =
      opts.setTimer ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        // Never hold the process open for a trailing refresh.
        (t as { unref?: () => void }).unref?.();
        return t;
      });
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /**
   * Run `run` now if the feed is outside its window, or defer: `trailing` then
   * runs once at the window end. `bypass` (an authenticated admin) always runs
   * now, and still starts a window.
   */
  async runOrDefer<T>(
    key: string,
    run: () => Promise<T>,
    trailing: () => Promise<unknown>,
    opts: { bypass?: boolean } = {}
  ): Promise<Outcome<T>> {
    this.prune();
    const now = this.now();
    const state = this.states.get(key);

    const inWindow = state && (state.running || now - state.lastStart < this.windowMs);
    if (state && inWindow && !opts.bypass) {
      state.trailing = trailing;
      this.arm(key, state);
      return { ran: false, runAt: Math.max(state.lastStart + this.windowMs, now) };
    }

    const current = state ?? { lastStart: now, running: false, trailing: null, armed: false };
    current.lastStart = now;
    current.running = true;
    this.states.set(key, current);
    try {
      return { ran: true, value: await run() };
    } finally {
      current.running = false;
      this.arm(key, current);
    }
  }

  /** Schedule the trailing run for the end of the window, if one is waiting. */
  private arm(key: string, state: FeedState): void {
    if (!state.trailing || state.armed || state.running) return;
    state.armed = true;
    const delay = Math.max(0, state.lastStart + this.windowMs - this.now());
    this.setTimer(() => {
      state.armed = false;
      const fn = state.trailing;
      state.trailing = null;
      if (!fn) return;
      state.lastStart = this.now();
      state.running = true;
      fn()
        .catch((err) => {
          this.log(`[refresh-coalescer] trailing refresh for ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          state.running = false;
          this.arm(key, state);
        });
    }, delay);
  }

  private prune(): void {
    if (this.states.size <= PRUNE_ABOVE) return;
    const now = this.now();
    for (const [key, s] of this.states) {
      if (!s.running && !s.trailing && now - s.lastStart >= this.windowMs) this.states.delete(key);
    }
  }
}
