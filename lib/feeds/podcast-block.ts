/**
 * `<podcast:block>` — the feed's own say over which platforms may show it.
 *
 * Spec: https://podcasting2.org/docs/podcast-namespace/tags/block
 * Channel level only, any number of copies, value `yes` or `no`, and an optional
 * `id` naming ONE service from the namespace's `serviceslugs.txt`. The spec's
 * order of discovery, which `isBlockedFor` follows exactly:
 *
 *   1. `<podcast:block id="[myslug]">no</podcast:block>` → safe to ingest.
 *   2. `<podcast:block id="[myslug]">yes</podcast:block>` → do not ingest.
 *   3. `<podcast:block>yes</podcast:block>` → do not ingest.
 *
 * So a `no` naming us beats a bare `yes` ("block every platform except …"), and
 * a `yes` naming another service blocks only that service.
 *
 * What this app does with the answer is `Feed.blocked`: written from every parse
 * of the feed (`podcastBlockFields`), and filtered beside `markedDead` on every
 * surface that hides a feed. It is a SEPARATE column on purpose. `markedDead` is
 * Chad's manual hide, and a feed that drops its block must come back without
 * undoing a hide he set by hand — one column cannot remember both.
 */

/**
 * Our entry in the service slug list. `serviceslugs.txt` has no `stablekraft`
 * line yet (checked 2026-11-21), so today only a bare `yes` can block us; a feed
 * that names us by this slug is honoured either way, and nothing changes here
 * when the slug lands upstream. The one place the slug is spelled.
 */
export const STABLEKRAFT_SERVICE_SLUG = 'stablekraft';

export interface PodcastBlock {
  /** The `id` attribute, trimmed and lower-cased; absent for a bare tag. */
  id?: string;
  /** Only the two values the spec defines. Anything else is not kept. */
  value: 'yes' | 'no';
}

/**
 * Does this set of channel `<podcast:block>` tags keep `slug` from showing the
 * feed? Pure; the spec's three steps in their order. A value other than yes/no
 * never reaches here (the parser drops it), so an unreadable tag blocks nothing.
 */
export function isBlockedFor(
  blocks: readonly PodcastBlock[] | null | undefined,
  slug: string = STABLEKRAFT_SERVICE_SLUG
): boolean {
  if (!blocks || blocks.length === 0) return false;
  const me = slug.trim().toLowerCase();
  if (blocks.some(b => b.id === me && b.value === 'no')) return false;
  if (blocks.some(b => b.id === me && b.value === 'yes')) return true;
  return blocks.some(b => b.id === undefined && b.value === 'yes');
}

/**
 * The `blocked` field to write with a feed row, or nothing.
 *
 * Unlike funding or persons, an ABSENT block is an answer: a feed that removes its
 * `<podcast:block>` must come back at the next parse, so `false` is written as
 * readily as `true`. What returns nothing is a parse result that never looked —
 * a shape built from Podcast Index data, say — because writing `false` from that
 * would un-hide a blocked feed on a guess. `parseRSSFeed` always sets the field.
 *
 * `podcast-block.test.ts` scans the routes and fails when a feed write fed by a
 * parse does not call this.
 */
export function podcastBlockFields(
  parsed: { blocked?: boolean } | null | undefined
): { blocked?: boolean } {
  if (typeof parsed?.blocked !== 'boolean') return {};
  return { blocked: parsed.blocked };
}
