import type { Prisma } from '@prisma/client';

import type { FundingLink } from '@/lib/podcast-funding';

/**
 * The channel-level `funding` to write with a feed row, or nothing.
 *
 * `Feed.funding` holds the feed's `<podcast:funding>` links — PayPal, Patreon,
 * a merch store — which the album page and the boost dialog show next to the
 * Lightning boost. The URLs were checked at the parse boundary
 * (`lib/podcast-funding.ts`), and are checked again on read.
 *
 * Same shape and same reasons as `channelPersonsFields`: a channel field is
 * written from every route that parses a feed, and one call site missed is one
 * refresh path that never lands the link, which type-checks perfectly.
 * `channel-funding.test.ts` scans the routes and fails when a feed write fed by
 * a parse does not call this.
 *
 * It returns an EMPTY object when the parse found nothing, so the spread is a
 * no-op rather than a null: a parse that could not reach the tag must not erase
 * what an earlier parse stored. The cost is that a link an artist REMOVES from
 * the feed stays until the column is cleared by hand.
 */
export function channelFundingFields(
  parsed: { funding?: FundingLink[] } | null | undefined
): { funding?: Prisma.InputJsonValue } {
  const funding = parsed?.funding;
  if (!Array.isArray(funding) || funding.length === 0) return {};
  return { funding: funding as unknown as Prisma.InputJsonValue };
}
