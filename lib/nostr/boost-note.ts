/**
 * The NIP-73 identifier block on a boost note (kind:1), and the NIP-89
 * attribution beside it.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN THE COMPONENT: the `k` tags are
 * what make a boost findable at all. The normal way to ask a relay for podcast
 * boosts is `{"kinds":[1],"#k":["podcast:guid","podcast:item:guid"]}`, and an
 * `i` tag with no `k` matches that filter exactly never. StableKraft shipped
 * 274 notes in that state — well-formed, fully identified, and invisible to
 * every indexer for months, with nothing visibly wrong (#237). Boost Me Bitch
 * sends both (282 of 282); so has Fountain since ~April 2025. Living under
 * `lib/` is also the only way any of this is testable: `npm run test:all` globs
 * `lib/` and one level below, and nothing under `components/` is covered.
 *
 * PAIRED — one `k` immediately after its `i`. That is the shape BMB uses and
 * what #237 asks for. Deliberately NOT the "one per distinct kind, trailing"
 * rule kind:10333 uses (`favorites-single-list.ts`), whose two reasons are both
 * false here: that list is POSITIONAL, so a `k` mid-list would disturb the
 * grouping, and pairing there cost 423 tags holding two distinct values, ~11 KB
 * of a 36 KB event. A boost note carries at most three identifiers, each of a
 * distinct kind, so for this event the two rules emit identical bytes anyway.
 * Position is inert to a relay regardless: NIP-01 indexes single-letter tags by
 * name and value, never by order.
 *
 * The kind ALWAYS comes from `identifierKind`'s table, never from scanning the
 * identifier. Boost item guids are routinely permalink URLs, and "everything
 * before the last colon" on `podcast:item:guid:https://example.com/ep/42`
 * yields `podcast:item:guid:https` — a `k` no filter matches, which reinstates
 * the exact bug this file exists to fix while looking correct.
 *
 * Dependency-free on purpose: `./pc20-identifiers` and `@/lib/constants` both
 * import nothing, so this is safe to import statically into a client bundle.
 * Never import `favorites-single-list.ts` here — it reaches `relay-read` →
 * nostr-tools → `ws`, none of which belongs in a boost button.
 */

import { APP_NAME } from '@/lib/constants';
import { identifierKind, itemId, publisherId, showId } from './pc20-identifiers';

/** The Podcasting 2.0 guids a boost can name. Any of them may be absent. */
export interface BoostIdentifiers {
  /** The RSS `<item>` guid — the track or episode boosted. */
  itemGuid?: string | null;
  /** The feed's `<podcast:guid>`. */
  feedGuid?: string | null;
  /** The publisher feed's guid, when the feed declares one. */
  publisherGuid?: string | null;
}

/**
 * The `i`/`k` pairs for a boost, in the order this app has always emitted its
 * identifiers: item, feed, publisher. BMB emits feed-then-item; matching that
 * buys nothing, since order is inert, and 274 published notes already use ours.
 *
 * An identifier whose kind is not in the table is dropped rather than emitted
 * bare. Unreachable today — all three builders produce known kinds — but it is
 * what stops a fourth identifier, added one day without a table entry, from
 * quietly reintroducing the untagged `i` this file was written to remove.
 *
 * A blank or whitespace-only guid counts as absent. `podcast:item:guid: ` is a
 * real identifier as far as an indexer is concerned, and these notes are about
 * to become discoverable.
 */
export function podcastIdentifierTags(ids: BoostIdentifiers): string[][] {
  const tags: string[][] = [];

  const add = (guid: string | null | undefined, toId: (g: string) => string) => {
    if (!guid || !guid.trim()) return;
    const id = toId(guid);
    const kind = identifierKind(id);
    if (!kind) return;
    tags.push(['i', id], ['k', kind]);
  };

  add(ids.itemGuid, itemId);
  add(ids.feedGuid, showId);
  add(ids.publisherGuid, publisherId);

  return tags;
}

/**
 * Everyone a boost note names, as hex pubkeys: each one becomes BOTH a `p` tag
 * and a `nostr:npub…` mention in the text. One list, so the two cannot drift.
 *
 * They did drift. The mentions were built from the split recipients only, and
 * the feed's own `<podcast:person>` / `<podcast:txt>` npubs were appended to the
 * `p` tags afterwards. So the artist was tagged but never shown: in Jumble a
 * boost of "Kulture Collection" read "@ChadF" — the booster, reached through
 * the MSP 2.0 split — and nothing naming Matt Finlay, whose key sat only in a
 * tag no client renders in the body.
 *
 * Persons come FIRST: the note is about their music, and a split recipient is
 * as often an app (MSP 2.0, Podcastindex) as a musician. A person who is also a
 * split recipient appears once. Self-tagging stays allowed — an artist may be in
 * their own splits and want the notification.
 *
 * `decodeNpub` is injected so this file stays dependency-free (see the header):
 * bech32 lives in nostr-tools, which the caller already imports dynamically. It
 * returns the hex key, or null for anything that is not a valid npub.
 */
export function boostNotifiedPubkeys(
  splitPubkeys: readonly string[],
  personNpubs: readonly (string | null | undefined)[],
  decodeNpub: (npub: string) => string | null,
): string[] {
  const named: string[] = [];
  const add = (hex: string | null | undefined) => {
    if (hex && !named.includes(hex)) named.push(hex);
  };

  for (const raw of personNpubs) {
    if (typeof raw !== 'string') continue;
    const npub = raw.trim().toLowerCase();
    if (!npub.startsWith('npub1')) continue;
    add(decodeNpub(npub));
  }
  for (const hex of splitPubkeys) add(hex);

  return named;
}

/**
 * NIP-89 attribution, the bare two-element form.
 *
 * No kind:31990 handler address in position 2: this app publishes no handler
 * event, and a pointer to an event that does not exist is worse than no pointer
 * — a client that follows it fetches nothing and renders a broken handler link.
 * The bare form is NIP-89's own fallback, and is what BMB sends.
 */
export const clientTag = (): string[] => ['client', APP_NAME];
