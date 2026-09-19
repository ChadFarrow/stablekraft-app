/**
 * A cache that re-reads its source only when the source has actually changed.
 *
 * WHY: `/api/albums-fast` rebuilt its catalog on a plain 15-minute TTL — up to 96
 * full reads a day of ~13,800 track rows (~20 MB; Prisma applies the per-feed `take`
 * AFTER the read, so the database sends every track of every active feed). That was
 * most of the ~65 GB/period of billed database egress (see CLAUDE.md), and the data
 * itself had changed in about 18 of the week's 672 fifteen-minute windows (measured
 * 2026-09-19). So ~97% of rebuilds re-read identical rows.
 *
 * Here the interval asks a cheaper question instead: "did anything change?" — a
 * caller-supplied `fingerprint()` (for the catalog, an md5 Postgres computes over the
 * rows, which returns 32 bytes). Only a different fingerprint, an explicit
 * `invalidate()`, or `maxAgeMs` pays for a real `load()`.
 *
 * Behaviour, pinned by fingerprinted-cache.test.ts:
 *  - cold → the caller waits for a load (every concurrent caller shares ONE load);
 *  - checked within `checkIntervalMs` → served, no I/O;
 *  - check due → served IMMEDIATELY from memory while one background check runs;
 *    a changed fingerprint rebuilds, and the next request sees the new data;
 *  - `invalidate()` → the next request waits for a load that STARTS after the
 *    invalidation. A build already in flight read rows that may predate the change,
 *    so it is queued behind, never joined.
 *  - a failed load keeps the old value and retries on the next request; a failed
 *    fingerprint counts as "changed", never as "unchanged".
 *
 * The fingerprint is taken BEFORE the load. Taken after, a write landing between
 * the two would be stamped as already-seen and served stale until `maxAgeMs`;
 * before, the worst case is one extra rebuild.
 */

export type RebuildReason = 'cold' | 'changed' | 'max-age' | 'invalidated' | 'fingerprint-failed';

export interface FingerprintedCacheOptions {
  /** Cheap "has the source changed?" probe. Any change must change its result. */
  fingerprint: () => Promise<string>;
  /** How long a checked value is served without asking again. */
  checkIntervalMs: number;
  /** Rebuild at least this often even if the fingerprint never moves — a safety net
   *  for any change the fingerprint cannot see. */
  maxAgeMs: number;
  now?: () => number;
  /** Called after each real load, for logging. */
  onRebuild?: (reason: RebuildReason, ms: number) => void;
  /** Called when a background check or rebuild fails (the old value kept serving). */
  onBackgroundError?: (error: unknown) => void;
}

export interface FingerprintedCache<T> {
  get(load: () => Promise<T>): Promise<T>;
  invalidate(): void;
  /** When the value being served was loaded; 0 if there is none. */
  builtAt(): number;
  /** Resolves once no check or rebuild is running. For tests. */
  settled(): Promise<void>;
}

export function createFingerprintedCache<T>(opts: FingerprintedCacheOptions): FingerprintedCache<T> {
  const now = opts.now ?? Date.now;

  let has = false;
  let value: T | undefined;
  let fingerprint: string | null = null;
  let builtAt = 0;
  let checkedAt = 0;
  let invalidated = false;
  let generation = 0;
  let inflight: Promise<T> | null = null;
  let inflightGeneration = -1;

  async function revalidate(load: () => Promise<T>): Promise<T> {
    const startedGeneration = generation;
    const startedAt = now();

    let fp: string | null;
    try {
      fp = await opts.fingerprint();
    } catch (error) {
      opts.onBackgroundError?.(error);
      fp = null;
    }

    let reason: RebuildReason | null;
    if (!has) reason = invalidated ? 'invalidated' : 'cold';
    else if (invalidated) reason = 'invalidated';
    else if (fp === null) reason = 'fingerprint-failed';
    else if (fp !== fingerprint) reason = 'changed';
    else if (startedAt - builtAt >= opts.maxAgeMs) reason = 'max-age';
    else reason = null;

    if (reason === null) {
      if (generation === startedGeneration) checkedAt = startedAt;
      return value as T;
    }

    const loaded = await load();
    const ms = now() - startedAt;
    value = loaded;
    has = true;
    builtAt = startedAt;
    if (generation === startedGeneration) {
      fingerprint = fp;
      checkedAt = startedAt;
      invalidated = false;
    } else {
      // Invalidated while this load was running: the rows it read may predate the
      // change. Keep them (a background caller needs an answer) but don't trust
      // them — `invalidated` stays set, so the next check rebuilds.
      fingerprint = null;
      checkedAt = 0;
    }
    opts.onRebuild?.(reason, ms);
    return loaded;
  }

  return {
    get(load) {
      if (has && now() - checkedAt < opts.checkIntervalMs) {
        return Promise.resolve(value as T);
      }
      // Join a running check — unless the cache was invalidated after it started.
      // Then it may be reading pre-change rows, so queue a fresh one behind it.
      if (!inflight || (!has && inflightGeneration !== generation)) {
        const previous = inflight;
        const run = () => revalidate(load);
        const p: Promise<T> = (previous ? previous.catch(() => undefined).then(run) : run()).finally(() => {
          if (inflight === p) inflight = null;
        });
        inflight = p;
        inflightGeneration = generation;
        // Nobody awaits a background check, so report its failure here, once.
        if (has) p.catch((error) => opts.onBackgroundError?.(error));
      }
      // Stale-while-revalidate: with a value in hand, this request is not the one that waits.
      if (has) return Promise.resolve(value as T);
      return inflight;
    },

    invalidate() {
      has = false;
      value = undefined;
      fingerprint = null;
      checkedAt = 0;
      invalidated = true;
      generation++;
    },

    builtAt() {
      return has ? builtAt : 0;
    },

    async settled() {
      while (inflight) {
        await inflight.catch(() => {});
      }
    },
  };
}
