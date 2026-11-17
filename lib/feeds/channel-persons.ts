import type { Prisma } from '@prisma/client';

import type { ParsedPerson } from '@/lib/rss-parser-db';

/**
 * The channel-level `persons` to write with a feed row, or nothing.
 *
 * `Feed.persons` holds what the feed says about itself — its band or host, and
 * the Nostr keys they publish, from `<podcast:person>` and from an npub carried
 * by `<podcast:txt>`. Those keys become the `p` tags on a boost note, so a feed
 * whose row has no persons boosts to nobody.
 *
 * Until this helper existed the column had ONE writer, `importFeedToDatabase`,
 * which only the import path reaches. Every refresh route parses through
 * `parseRSSFeedWithSegments` and wrote every other channel field — title,
 * artist, guid, medium, podcastImages — and silently left this one alone. So a
 * key added to a feed already in the catalog could never land, however often
 * the feed was reparsed. Item-level persons never had the problem: they ride on
 * `ParsedItem` and refresh with every parse.
 *
 * This is the field-written-from-N-places family that CLAUDE.md warns about,
 * and the reason it is a helper rather than a spread copied twenty times: one
 * call site missed is one refresh path that keeps dropping the key, and it
 * type-checks perfectly. `channel-persons.test.ts` scans the routes and fails
 * when a feed write fed by a parse does not call this.
 *
 * It returns an EMPTY object when the parse found nothing, so the spread is a
 * no-op rather than a null. A feed that declares nobody must not erase persons
 * a previous parse stored: the tag may have moved out of the slice a future
 * parser reads, and a wrong empty is indistinguishable from a true one here.
 *
 * The cast to `InputJsonValue` is the one `Feed.persons` needs as a Json column,
 * and it lives here so no call site reaches for `as any` — which would also
 * swallow a genuine type error in whatever it is handed.
 */
export function channelPersonsFields(
  parsed: { persons?: ParsedPerson[] } | null | undefined
): { persons?: Prisma.InputJsonValue } {
  const persons = parsed?.persons;
  if (!Array.isArray(persons) || persons.length === 0) return {};
  return { persons: persons as unknown as Prisma.InputJsonValue };
}
