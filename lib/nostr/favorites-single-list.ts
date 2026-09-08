/**
 * The single-list favorites format — kind 10333, "PC 2.0 Favorites".
 *
 * Spec: github.com/ChadFarrow/PC20-Nostr, `pc20-favorites.md`. It
 * replaces the two-list kind:30078 format, which proved overcomplicated: one
 * plain (non-`d`-tagged) replaceable event, `i` tags grouped under a running
 * `medium`, no baseline and no merge. Republishing the whole tag list IS the
 * sync. Podcasting 2.0 data, shared over Nostr.
 *
 * ---------------------------------------------------------------------------
 * The one thing to understand before editing: placement is POSITIONAL
 *
 * A `podcast:item:guid` entry carries no parent of its own. It belongs to the
 * feed group most recently opened above it, and to the medium most recently
 * declared above that. Both facts live in tag ORDER rather than in the tag, so
 * reordering the output is not cosmetic — it re-parents entries and re-labels
 * media, and it does so while leaving the event perfectly well-formed.
 *
 * Three consequences, all properties of the format rather than choices here:
 *
 *   - **A feed group is opened for every parent of a favorited track**, whether
 *     or not the feed is itself favorited, because there is no other way to say
 *     which feed a track came from. Measured on real data: 82 favorited feeds,
 *     159 distinct parents, 196 groups. Resolving the guids and deciding what
 *     to show is the consuming app's job — they are the standard Podcasting 2.0
 *     identifiers and any PC 2.0 app knows what they are.
 *   - **Unfavoriting a feed while a track of it stays favorited is invisible.**
 *     The placement group and the favorite are the same bytes, so the removal
 *     cannot be expressed until the last track goes too. Pinned by a test.
 *
 *     BOTH OF THOSE DESCRIBE WHAT THIS APP WRITES, and the format has moved on.
 *     An item entry may now carry the guid of its feed on its own tag —
 *     `['i','podcast:guid:<feed>','podcast:item:guid:<item>']` — so nothing
 *     needs to be on the list for structural reasons. This app is at STAGE 1 of
 *     that migration (PC20-Nostr `pc20-favorites-feed-guid-migration.md`): it
 *     READS the three-element form and carries it whole, and still WRITES the
 *     legacy two-element form under a feed group. Boost Me Bitch already writes
 *     the new form, so this reader is what stops its item favorites arriving
 *     here as followed shows.
 *
 *     THE ELEMENT COUNT IS THE ONLY THING separating a feed favorite from an
 *     item favorite — their position 1 is byte-for-byte the same string — so an
 *     entry is told apart by LENGTH, never by position 1. A position 2 we do
 *     not recognise makes the whole entry unreadable rather than a feed
 *     favorite. The LEGACY two-element item is still positional and reading it
 *     stays mandatory: every list published before this revision writes items
 *     that way.
 *   - **A track whose parent feed has no `<podcast:guid>` cannot be expressed**
 *     and is dropped on write. The two-list format could carry it parentless;
 *     this one cannot. No favorite is in that state today, and the fix is an
 *     admin reparse to populate `Feed.guid`, not an invented parent.
 * ---------------------------------------------------------------------------
 *
 * `k` tags are ONE PER DISTINCT KIND, trailing — the spec's rule since PC20-Nostr
 * #8, which this implementation drove: the paired form cost 423 tags holding two
 * distinct values on the first real event, ~11 KB of 36 KB. An earlier revision
 * paired a `k` with every `i`, so the reader accepts BOTH forms and takes an
 * entry's kind from position 1, never from an adjacent tag. A reader that walks
 * `i`/`k` in pairs sees an empty library rather than an error.
 */

import type { Filter } from 'nostr-tools';

import {
  bareFeedGuid,
  identifierKind,
  isKnownIdentifierKind,
  itemId,
  parseItemGuid,
  parseShowGuid,
  showId,
  type FavoriteEntry,
} from './pc20-identifiers';
import { readReplaceableEvent } from './relay-read';

/**
 * Self-assigned, and unclaimed in the NIPs registry as of 2026-08-13.
 *
 * NIP-51's kind 10054 "Favorite podcasts list" is the nearest registered thing
 * and cannot express this: it holds only `p` (NIP-F4 podcast pubkeys) and `url`
 * tags, so it has no way to name a feed by `<podcast:guid>` and no concept of
 * an episode or track at all.
 */
export const SINGLE_LIST_KIND = 10333;

/** NIP-31 `alt`, so a generic client renders something rather than nothing. */
export const LIST_ALT = 'PC 2.0 Favorites';

/** One feed and the favorited items beneath it. */
export interface SingleListGroup {
  feedGuid: string;
  /** `<podcast:medium>` as the feed declared it, or undefined when it declared
   *  none. NEVER defaulted — see `buildSingleListTags` and `parseSingleList`. */
  medium?: string;
  itemGuids: string[];
  /** Whether the feed itself is favorited, as opposed to the group existing
   *  only to place an item. Not expressible on the wire — see the header — so
   *  it is meaningful on the way OUT and always false on the way back IN. */
  favorited: boolean;
  /**
   * The feed's `i` tag AS READ, when this group came off the wire.
   *
   * Emitted back verbatim so anything a writer newer than us parked past
   * position 1 survives. Absent on a group built from local state, which has
   * nothing to carry.
   */
  feedTag?: string[];
  /**
   * Each LEGACY item's `i` tag as read, by item guid. Same rule, same reason.
   *
   * Keyed rather than positional: the merge splices item guids around, and a
   * parallel array would silently pair a tag with a different item.
   */
  itemTags?: Record<string, string[]>;
}

/**
 * An item entry that NAMES ITS OWN FEED — the three-element form.
 *
 * `['i', 'podcast:guid:<feedGuid>', 'podcast:item:guid:<itemGuid>']`. It is not
 * a member of the group above it and depends on nothing before it; moving it
 * changes nothing. This app does not originate one yet (that is stage 2 of the
 * migration), so every one of these came off the wire and its `tag` goes back
 * byte for byte.
 *
 * Distinct from {@link LooseNode} because we CAN read it: both guids are known,
 * so it resolves, renders and matches a local row. `loose` means "no meaning
 * for this", which is a different claim about a different tag.
 */
export interface ItemNode {
  /** Bare feed guid, off position 1 of its OWN tag — never the entry above. */
  feedGuid: string;
  /** Bare item guid, off position 2. */
  itemGuid: string;
  medium?: string;
  /** The WHOLE tag as read. Never rebuilt from the two guids. */
  tag: string[];
}

/**
 * A tag we read and cannot place, carried WHOLE.
 *
 * An identifier kind outside our table, a `podcast:guid:` whose guid is
 * malformed, an `i` a newer writer gave a meaning we don't have — all of it
 * belongs to a writer older or newer than this one. `tag` is the array as it
 * arrived, so a third element (which the spec reserves and nothing uses yet)
 * survives a round trip; re-rendering it from our own model would not.
 *
 * A loose node deliberately does NOT close the open feed group. An `i` we
 * can't read sitting between a feed and its items must not re-parent the ones
 * after it: the entries around it belong to a writer that knew what it meant,
 * and our not understanding one of them is no licence to move the others.
 */
export interface LooseNode {
  tag: string[];
  medium?: string;
}

/**
 * The parsed list as an ORDERED node list rather than a bag of groups.
 *
 * Position is the data here, so the model has to be able to hold it. A group
 * array cannot say where an unreadable entry sat, and re-emitting those at a
 * fixed place instead of where they were makes two apps rewrite the event
 * against each other forever — each publish locally reasonable, the only
 * symptom being that it never stops.
 */
export type ListNode =
  | { t: 'group'; group: SingleListGroup }
  | { t: 'item'; item: ItemNode }
  | { t: 'loose'; loose: LooseNode };

/** Which half the WHOLE list lives in. Never a per-entry property. */
export type ListVisibility = 'public' | 'private';

/**
 * The tag naming that half.
 *
 * Multi-letter on purpose: relays index single-letter tags, so a `["v", …]`
 * would let a `#v=private` filter enumerate the pubkeys that keep a private
 * list. It takes no part in grouping — treat it like `k`.
 */
export const VISIBILITY_TAG = 'visibility';

export interface ParsedSingleList {
  nodes: ListNode[];
  /**
   * The mode the event STATES, or null when it does not.
   *
   * Null is not "public". It means the list was written before this tag
   * existed, and the caller falls back to inferring the mode from whichever
   * half holds entries — which answers for every list that has any, and
   * cannot answer at all for one that has none.
   */
  visibility: ListVisibility | null;
  /** Tag types we have no meaning for, whole and in read order. */
  foreignTags: string[][];
  /** `k` values naming kinds outside our table. Re-emitted, never acted on. */
  foreignKinds: string[];
  /** Derived from `nodes`, for callers that only want what we can model. */
  groups: SingleListGroup[];
  /** Items that appeared before any feed group. This app never writes them;
   *  another writer might, and dropping them would lose favorites. */
  orphanItemGuids: string[];
}

export interface SingleList extends ParsedSingleList {
  updatedAt: number;
  exists: boolean;
  /** See `TrustedRead` — false means "nothing answered", not "no favorites". */
  trustworthy: boolean;
  /**
   * `event.content` EXACTLY as it arrived, always.
   *
   * kind:10333 is ONE event with many writers, and `content` is the only free
   * slot in it. The spec's rule 4 — carry what you can't read — is written
   * about TAGS and says nothing about `content`, so a writer following the
   * document to the letter republishes the empty string the format has
   * specified from the start. That erases whatever another app put there:
   * silently, on someone else's device, with no undo, while behaving correctly
   * by the document it was written against.
   *
   * This app does not use `content` and does not need to understand it. It
   * only has to not destroy it. There is nothing to decrypt and nothing to
   * parse — keep the bytes and put them back.
   */
  content: string;
}

/** The medium a node sits under — the running value at its position. */
function mediumOfNode(node: ListNode): string | undefined {
  if (node.t === 'group') return node.group.medium;
  if (node.t === 'item') return node.item.medium;
  return node.loose.medium;
}

/** `groups` / `orphanItemGuids` as projections of the node list, so the two can
 *  never disagree about what was read. */
function projectNodes(nodes: ListNode[]): {
  groups: SingleListGroup[];
  orphanItemGuids: string[];
} {
  const groups: SingleListGroup[] = [];
  const orphanItemGuids: string[] = [];
  /** feedGuid -> where that feed sits in `groups`. */
  const at = new Map<string, number>();
  for (const node of nodes) {
    if (node.t === 'group') {
      groups.push(node.group);
      // First group for a feed wins the position; a duplicate on the wire is
      // well-formed and folds into the one already here.
      if (!at.has(node.group.feedGuid)) at.set(node.group.feedGuid, groups.length - 1);
      continue;
    }
    // AN ITEM THAT NAMES ITS OWN FEED STILL PROJECTS UNDER THAT FEED, or every
    // consumer of `groups` — the sync endpoint, the row resolvers — stops
    // seeing tracks the moment the other app writes the three-element form.
    if (node.t === 'item') {
      const where = at.get(node.item.feedGuid);
      if (where !== undefined) {
        const g = groups[where];
        if (!g.itemGuids.includes(node.item.itemGuid)) {
          // A COPY, NEVER A MUTATION. `groups` aliases the node's own object,
          // so pushing into it would add this item to the NODE LIST as well —
          // and the republish would then emit it twice, once as a group item
          // and once as its own entry. The projection is what this app models;
          // the node list is what it republishes, and neither may edit the
          // other.
          groups[where] = {
            ...g,
            medium: g.medium ?? node.item.medium,
            itemGuids: [...g.itemGuids, node.item.itemGuid],
          };
        }
        continue;
      }
      // No feed entry for it on the list. That is an ordinary state now — the
      // user saved a track from a feed they never favorited — so this is a
      // placement projection and `favorited` stays false.
      at.set(node.item.feedGuid, groups.length);
      groups.push({
        feedGuid: node.item.feedGuid,
        medium: node.item.medium,
        itemGuids: [node.item.itemGuid],
        favorited: false,
      });
      continue;
    }
    // An item with no group above it is unplaceable, not unreadable: we know
    // exactly what it is and can still match it to a local row by its guid.
    const guid = node.loose.tag[0] === 'i' ? parseItemGuid(node.loose.tag[1] ?? '') : null;
    if (guid && !orphanItemGuids.includes(guid)) orphanItemGuids.push(guid);
  }
  return { groups, orphanItemGuids };
}

/** An empty parse, for an absent event and for callers building one by hand. */
export const EMPTY_PARSED: ParsedSingleList = {
  nodes: [],
  visibility: null,
  foreignTags: [],
  foreignKinds: [],
  groups: [],
  orphanItemGuids: [],
};

// --- writing ---------------------------------------------------------------

/**
 * Collapse a flat favorites list into feed groups, preserving first-appearance
 * order — which is what makes a republish byte-identical when nothing changed.
 */
export function groupForSingleList(items: FavoriteEntry[]): SingleListGroup[] {
  const groups = new Map<string, SingleListGroup>();

  const ensure = (feedGuid: string, medium?: string): SingleListGroup => {
    const existing = groups.get(feedGuid);
    if (existing) {
      // A group opened by a track carries the parent feed's medium; the album
      // entry for the same feed carries its own. They come from one column, so
      // this only fills a gap — it never overwrites an answer with another.
      if (!existing.medium && medium) existing.medium = medium;
      return existing;
    }
    const created: SingleListGroup = { feedGuid, medium, itemGuids: [], favorited: false };
    groups.set(feedGuid, created);
    return created;
  };

  for (const item of items) {
    const feedGuid = parseShowGuid(item.id);
    if (feedGuid) {
      ensure(feedGuid, item.medium).favorited = true;
      continue;
    }

    const itemGuid = parseItemGuid(item.id);
    if (!itemGuid) continue; // an identifier kind this format has no place for

    // The parent arrives prefixed from this app and bare from writers on the
    // newer revisions; `bareFeedGuid` accepts both and rejects anything else.
    const parent = bareFeedGuid(item.feedRef);
    if (!parent) continue; // unplaceable — see the header

    const group = ensure(parent, item.medium);
    if (!group.itemGuids.includes(itemGuid)) group.itemGuids.push(itemGuid);
  }

  return [...groups.values()];
}

/**
 * The full tag list for the event.
 *
 * Groups whose medium is unknown are emitted FIRST, ahead of any `medium` tag.
 * The spec reads those as `podcast`, which is a guess — but every alternative
 * is worse: appending them puts them under whatever medium was declared last,
 * and inventing a `["medium", "unknown"]` tag writes a value no reader has been
 * told about. The spec is explicit that the medium is a display hint and that a
 * Podcast Index lookup wins where it disagrees, so this is the one position
 * where being wrong is recoverable. What must never happen is publishing
 * `Feed.type` here: it defaults to "album" and would make the guess look
 * authoritative.
 */
export function buildSingleListTags(items: FavoriteEntry[]): string[][] {
  return tagsFromGroups(groupForSingleList(items), []);
}

/**
 * Render ordered groups as tags.
 *
 * Group ORDER is the caller's to decide and is preserved within each medium
 * block — that is what lets `mergeSingleList` keep the order it read and append
 * new entries at the end of their block, as the spec asks.
 *
 * Where the spec's two ordering rules conflict — "preserve the order you read"
 * and "keep same-medium feeds contiguous" — contiguity wins. A foreign writer
 * interleaving media would otherwise force us to choose between reordering
 * (harmless: items always follow their own group, so nothing is reattached) and
 * emitting a layout that silently re-labels every entry after the first
 * boundary. Reordering within a block costs nothing; breaking contiguity
 * corrupts.
 */
/**
 * State the list's mode on a tag array that is about to become the EVENT.
 *
 * Kept out of `tagsFromNodes` on purpose. That function builds both halves,
 * and the private half is a tag array inside `content` — a mode stated there
 * is a claim about the list made in a place no reader may act on, and this
 * app's own parser drops it. So the tag is added once, to the array that
 * really is the event's, and never to the other one.
 *
 * Inserted after `alt` so the head of the event is stable across republishes;
 * position is not semantic for either tag.
 */
export function withVisibility(
  tags: string[][],
  visibility: ListVisibility | null
): string[][] {
  if (!visibility) return tags;
  const out = tags.filter((t) => t[0] !== VISIBILITY_TAG);
  const at = out.findIndex((t) => t[0] === 'alt');
  out.splice(at === -1 ? 0 : at + 1, 0, [VISIBILITY_TAG, visibility]);
  return out;
}

export function tagsFromNodes(
  nodes: ListNode[],
  foreignTags: string[][] = [],
  foreignKinds: string[] = [],
  visibility: ListVisibility | null = null
): string[][] {
  const tags: string[][] = [['alt', LIST_ALT]];
  // Right after `alt`, and only when the caller has one to state. Absent is a
  // real answer — see `ParsedSingleList.visibility` — so a default here would
  // make every legacy list claim a mode nobody picked.
  if (visibility) tags.push([VISIBILITY_TAG, visibility]);

  // Tag types we have no meaning for, replayed whole and in read order. They
  // take no part in grouping, so position among themselves is all they need.
  for (const tag of foreignTags) tags.push(tag.slice());

  // THE TAG AS READ, NEVER ONE REBUILT FROM THE MODEL. Position 2 of an item
  // entry carries the guid of its FEED — half the item's address, not a label —
  // and position 3 is undefined, which is exactly where the next revision will
  // put something. A writer that re-renders `['i', id]` type-checks, renders
  // correctly, and strips every item on the list of the value that makes it
  // resolvable. Only a node built from local state has nothing to carry.
  const emit = (node: ListNode) => {
    if (node.t === 'loose') {
      tags.push(node.loose.tag.slice());
      return;
    }
    if (node.t === 'item') {
      tags.push(node.item.tag.slice());
      return;
    }
    const group = node.group;
    const feed = showId(group.feedGuid);
    if (identifierKind(feed)) tags.push(group.feedTag ? group.feedTag.slice() : ['i', feed]);
    for (const guid of group.itemGuids) {
      const id = itemId(guid);
      if (!identifierKind(id)) continue;
      const read = group.itemTags?.[guid];
      tags.push(read ? read.slice() : ['i', id]);
    }
  };

  for (const node of nodes) {
    if (!mediumOfNode(node)) emit(node);
  }

  // First-appearance order, so the grouping is stable across republishes.
  const mediums: string[] = [];
  for (const node of nodes) {
    const m = mediumOfNode(node);
    if (m && !mediums.includes(m)) mediums.push(m);
  }

  for (const medium of mediums) {
    tags.push(['medium', medium]);
    // Same-medium feeds must stay contiguous: the tag applies to everything
    // that follows it, so interleaving media would silently re-label entries.
    for (const node of nodes) {
      if (mediumOfNode(node) === medium) emit(node);
    }
  }

  // Derived from what we ACTUALLY emitted, in emission order — never from the
  // model, or a `k` could name a kind that isn't on the list. From position 1
  // via the kinds table rather than a scan: item guids are routinely permalink
  // URLs, so "everything before the last colon" yields `podcast:item:guid:https`
  // — a `k` no relay filter matches, which breaks discovery with nothing
  // visibly wrong.
  //
  // Trailing, and one per distinct kind. Safe to append because `k` takes no
  // part in grouping — only `i` and `medium` are positional.
  const kinds: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== 'i' || !tag[1]) continue;
    // THE KIND OF THE ENTRY'S LAST IDENTIFIER — position 2 when there is one,
    // position 1 otherwise. A three-element `podcast:guid:` entry is an ITEM
    // favorite and must declare `podcast:item:guid`, even though position 1
    // reads `podcast:guid`. Derive it from position 1 alone and that kind never
    // reaches the event at all, so `#k` discovery stops finding item favorites
    // on every list this app republishes.
    const kind = identifierKind(tag[2] ?? tag[1]);
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  for (const kind of kinds) tags.push(['k', kind]);
  for (const kind of foreignKinds) {
    if (!kinds.includes(kind)) tags.push(['k', kind]);
  }

  return tags;
}

/**
 * The group-array entry point, for callers building a list from local state
 * only (`buildSingleListTags`) — there is nothing foreign to carry there.
 * Anything derived from a READ must go through `tagsFromNodes`, or the
 * entries this app cannot model are dropped on republish.
 */
export function tagsFromGroups(
  groups: SingleListGroup[],
  orphanItemGuids: string[]
): string[][] {
  const nodes: ListNode[] = orphanItemGuids
    .filter((guid) => identifierKind(itemId(guid)))
    // Ahead of every group, so they are still orphans when read back. This app
    // never originates one; it re-emits what another writer left.
    .map((guid): ListNode => ({ t: 'loose', loose: { tag: ['i', itemId(guid)] } }));
  for (const group of groups) nodes.push({ t: 'group', group });
  return tagsFromNodes(nodes);
}

/**
 * What THIS DEVICE last put on the list.
 *
 * Not a wire concept and not the kind:30078 baseline coming back — nothing
 * about the event changes. It is this app remembering which identifiers it
 * published, which is the only way to answer the question the format cannot:
 * an entry on the list that we do not hold locally is either something another
 * app added or something we just removed, and those need opposite treatment.
 *
 * Empty means "this device has never agreed to anything", so it may not treat
 * anything as a removal — the conservative direction, and the same rule the
 * predecessor used for an absent baseline.
 */
export interface PublishedRecord {
  feeds: string[];
  items: string[];
}

const EMPTY_PUBLISHED: PublishedRecord = { feeds: [], items: [] };

/** The record to store after a successful publish: OUR contribution only.
 *  Entries carried on another app's behalf must stay foreign next time. */
export function publishedRecordFrom(local: SingleListGroup[]): PublishedRecord {
  return {
    feeds: local.map((g) => g.feedGuid),
    items: local.flatMap((g) => g.itemGuids),
  };
}

/**
 * Merge what we hold onto what the relays hold — the read-then-carry pass.
 *
 * There is no baseline in this format, so this is not the 30078 merge and does
 * not try to be. It answers one question per entry: is this ours to manage?
 *
 *   - **A feed group we hold** is emitted from LOCAL state, in the position it
 *     was read. Its items are ours, so an unfavorite still propagates.
 *   - **A feed group we don't hold** is carried verbatim, with its items. This
 *     is the spec's "don't clobber entries the writing app doesn't understand",
 *     and without it every publish deletes whatever the other app holds alone.
 *   - **Groups we hold that weren't on the list** are appended, so a new
 *     favorite lands at the end of its medium block rather than the top.
 *   - **Orphan items** — items that appeared before any feed group — are
 *     carried untouched. We never write one.
 *
 * **"Foreign" means we cannot account for it, NOT that we don't favorite it.**
 * Getting that backwards shipped a resurrection loop: an album the user
 * unfavorited left `local`, was read as another app's entry, carried on every
 * republish, and then read back by the reconcile — which takes an itemless
 * group as a feed favorite — and re-created. Unfavoriting an album undid itself
 * on the next page load, permanently, because each pass re-established the
 * state the previous one had removed. `published` is what tells the two apart.
 */
export function mergeSingleList(
  read: ParsedSingleList,
  local: SingleListGroup[],
  published: PublishedRecord = EMPTY_PUBLISHED
): ParsedSingleList {
  const localByGuid = new Map(local.map((g) => [g.feedGuid, g]));
  const publishedFeeds = new Set(published.feeds);
  const publishedItems = new Set(published.items);
  const nodes: ListNode[] = [];
  const emitted = new Map<string, SingleListGroup>();

  /**
   * Item guids the wire states in THREE-ELEMENT form and that survive this
   * cycle, keyed by feed because an item guid is unique only inside its feed.
   *
   * Computed ahead of the walk because an item node may sit after the group
   * that also holds it locally, and both passes below have to agree. Without
   * it, an item carried here would ALSO be appended to its feed's group from
   * local state — emitted twice, and the second copy in the two-element form
   * that strips the guid making it resolvable.
   */
  const carriedItems = new Set<string>();
  for (const node of read.nodes) {
    if (node.t !== 'item') continue;
    const { feedGuid, itemGuid } = node.item;
    const held = localByGuid.get(feedGuid)?.itemGuids.includes(itemGuid) ?? false;
    if (publishedItems.has(itemGuid) && !held) continue;
    carriedItems.add(`${feedGuid}|${itemGuid}`);
  }
  const carried = (feedGuid: string, itemGuid: string): boolean =>
    carriedItems.has(`${feedGuid}|${itemGuid}`);

  for (const node of read.nodes) {
    // Not ours to read, so not ours to touch. Kept where it was: moving it is
    // how two writers end up reordering the event against each other forever.
    if (node.t === 'loose') {
      nodes.push(node);
      continue;
    }

    // An entry that names its own feed. This app does not originate one yet, so
    // it is always another writer's — carried whole, in place, unless our own
    // record says we published that item and no longer hold it.
    if (node.t === 'item') {
      const { feedGuid, itemGuid } = node.item;
      const held = localByGuid.get(feedGuid)?.itemGuids.includes(itemGuid) ?? false;
      if (publishedItems.has(itemGuid) && !held) continue;
      nodes.push({ t: 'item', item: { ...node.item, tag: node.item.tag.slice() } });
      continue;
    }

    const group = node.group;

    // The same feed twice on the wire. Fold the second one's items into the
    // first rather than skipping it — the duplicate's items are real favorites
    // and are named nowhere else, so dropping the group drops them too.
    const already = emitted.get(group.feedGuid);
    if (already) {
      for (const guid of group.itemGuids) {
        if (publishedItems.has(guid)) continue;
        if (!already.itemGuids.includes(guid)) already.itemGuids.push(guid);
      }
      if (!already.medium && group.medium) already.medium = group.medium;
      continue;
    }

    const mine = localByGuid.get(group.feedGuid);
    if (!mine) {
      // We put it there and no longer hold it: that is a removal, and dropping
      // it is how an unfavorite propagates. Carrying it instead makes removal
      // impossible — the group survives every republish, a reader takes an
      // itemless group as a feed favorite, and the favorite comes back on the
      // next hydration. That loop shipped once; see the module header.
      //
      // But only once nothing is left to place under it: the group is the only
      // thing naming its items' parent, so dropping one that still carries
      // another app's tracks takes those tracks with it.
      const survivors = group.itemGuids.filter((guid) => !publishedItems.has(guid));
      if (publishedFeeds.has(group.feedGuid) && survivors.length === 0) continue;
      // Never published by us, so it is another app's. Carry it verbatim.
      const carried: SingleListGroup =
        survivors.length === group.itemGuids.length
          ? group
          : { ...group, itemGuids: survivors };
      emitted.set(group.feedGuid, carried);
      nodes.push({ t: 'group', group: carried });
      continue;
    }

    // WIRE ORDER FIRST, then what is new here. Spec vector 18.
    //
    // What survives from the read: every item we still hold, and every item we
    // never published — another app's, and not ours to delete just because it
    // sits beneath a feed we happen to hold. In the order it was read. Then
    // the items we hold that the wire does not carry, at the END of the group.
    //
    // It used to be `[...mine.itemGuids, ...theirs]` — local order first —
    // and that is the convergence bug: Boost Me Bitch keeps wire order, so
    // each app's publish put the group's items in ITS order and the other
    // app's next cycle put them back. Every publish locally reasonable, the
    // event rewritten on every load for three weeks, and tag order is
    // semantic here so it was the meaningful part of the event moving.
    const mineSet = new Set(mine.itemGuids);
    const kept = group.itemGuids.filter(
      (guid) => mineSet.has(guid) || !publishedItems.has(guid)
    );
    const merged: SingleListGroup = {
      ...mine,
      // THE TAGS AS READ, THREADED ACROSS EXPLICITLY. This literal is built from
      // `mine` — LOCAL state — which has no `feedTag` and no `itemTags`, so
      // anything read off the wire is dropped here by construction unless it is
      // named. Same sentence as the `medium` line below, applied to the rest of
      // the tag: a hint we didn't write is not ours to delete, and neither is
      // half an item's address.
      feedTag: group.feedTag,
      itemTags: group.itemTags,
      // Prefer what we resolved; fall back to the hint that was already there
      // rather than blanking it. A hint we didn't write is not ours to delete.
      medium: mine.medium ?? group.medium,
      itemGuids: [
        ...kept,
        // Already on the wire naming its own feed, so it is emitted there —
        // once, and in the form it arrived in.
        ...mine.itemGuids.filter(
          (guid) => !kept.includes(guid) && !carried(group.feedGuid, guid)
        ),
      ],
    };
    emitted.set(group.feedGuid, merged);
    nodes.push({ t: 'group', group: merged });
  }

  for (const group of local) {
    if (emitted.has(group.feedGuid)) continue;

    // Absent from the read entirely. Anything we already published and the
    // relay no longer has was removed by ANOTHER writer, and re-adding it is
    // the resurrection loop in the other direction: the favorite returns on
    // every load, on every device, forever. Spec vector 9. Only what is
    // genuinely new here goes up — and a track the user just favorited under
    // a feed another app removed still needs its group reopened to name the
    // parent, so the group is skipped only when nothing new is left under it.
    //
    // This used to be unconditional, and the comparison page in PC20-Nostr
    // named it as the second of two ways the apps were rewriting the event at
    // each other. The record stays as it was: an entry we hold and did not
    // emit stays claimed, so a later unfavorite-and-refavorite here (which
    // drops and re-adds the row) publishes it again, while merely holding it
    // does not.
    const fresh = group.itemGuids.filter(
      (guid) => !publishedItems.has(guid) && !carried(group.feedGuid, guid)
    );
    const feedFresh = !publishedFeeds.has(group.feedGuid);
    if (!feedFresh && fresh.length === 0) continue;
    const appended: SingleListGroup =
      feedFresh && fresh.length === group.itemGuids.length
        ? group
        : { ...group, itemGuids: fresh, favorited: feedFresh && group.favorited };
    emitted.set(group.feedGuid, appended);
    nodes.push({ t: 'group', group: appended });
  }

  return {
    nodes,
    // Carried from the read, not decided here. `mergeSingleList` folds ONE
    // half; the mode belongs to the whole list, and `publishPlan` is the only
    // thing that may state it.
    visibility: read.visibility,
    foreignTags: read.foreignTags,
    foreignKinds: read.foreignKinds,
    ...projectNodes(nodes),
  };
}

/**
 * The unsigned event template for a list built from scratch.
 *
 * `content` is empty here because there is nothing to carry: this builds a
 * fresh list rather than republishing one that was read. Every republish goes
 * through {@link templateFromTags} with the bytes the read returned.
 */
export function singleListTemplate(items: FavoriteEntry[], createdAt: number) {
  return templateFromTags(buildSingleListTags(items), createdAt, '');
}

/**
 * The unsigned event template for a republish.
 *
 * `content` is REQUIRED and has no default. It used to be hardcoded to `''`,
 * which is correct only while no app in the world puts anything there — and
 * one now does. Whatever reaches this function must have come from the read,
 * verbatim. A `''` written by habit is another app's data deleted, and a
 * default parameter is how that habit gets written.
 */
export function templateFromTags(tags: string[][], createdAt: number, content: string) {
  return { kind: SINGLE_LIST_KIND, tags, content, created_at: createdAt };
}

// ---------------------------------------------------------------------------
// The private half's plaintext
// ---------------------------------------------------------------------------

/**
 * The largest plaintext we will hand a signer to encrypt.
 *
 * NIP-44 v2 as originally published capped plaintext at 65535 bytes. The
 * current text allows far more and switches to a 6-byte length prefix at 65536,
 * so a library built against the older text REJECTS a payload across that line.
 * A private list that grows past 64 KB is then unreadable in an app whose
 * `nip44` is a year old — and unreadable is indistinguishable from empty, which
 * is the failure this whole subsystem is arranged to avoid.
 *
 * Sized under it with room to spare rather than at it. NIP-44 also pads to a
 * power-of-two chunk and base64-encodes, so `content` runs about 1.5× this.
 */
export const PRIVATE_PLAINTEXT_MAX = 60_000;

/** UTF-8 byte length, which is what the NIP-44 limit counts. */
export function plaintextBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The private entries, as the bytes we hand a signer to encrypt.
 *
 * A stringified tag array, per the spec — the SAME shape as `event.tags`, so
 * the grouping rules apply inside it unchanged and `parseSingleList` reads it
 * without knowing which half it came from.
 *
 * The one deviation is the escaping, and it is not cosmetic: `?` is written as
 * its six-character JSON escape, backslash-u-0-0-3-f.
 *
 * This app's Amber path is NIP-46, which is not affected — but Boost Me Bitch
 * reads what we write and may be on NIP-55, where Amber URL-decodes the WHOLE
 * `nostrsigner:` URI and only then splits it on `?`. A plaintext carrying one
 * is silently truncated there and comes back "Amber received a malformed
 * nostrsigner request". Percent-encoding does not help — the `%3F` decodes back
 * into the character it splits on. And this payload is full of candidates: an
 * RSS `<guid>` is an arbitrary publisher-chosen string, and item guids are
 * routinely permalink URLs. One favorited track with a query string in its guid
 * would otherwise break every private publish on Android, forever, with a
 * message that reads as "Amber isn't installed".
 *
 * The escape has to be one every JSON reader already understands, which that
 * is: `JSON.parse` gives back the same string, byte for byte, in any
 * implementation. An app-specific wrapper would put our own marker inside the
 * ciphertext, and the other app would find something it was never told about.
 *
 * `?` can only ever appear inside a string literal here — every element of
 * every tag is a string, and the structural characters are `[`, `]`, `,` and
 * `"` — so a global replace over the stringified output cannot corrupt the
 * syntax. A `?` preceded by a backslash is preceded by an ESCAPED backslash
 * (`\\`), so the replacement lands after it correctly.
 */
export function encodePrivateFavorites(tags: string[][]): string {
  return JSON.stringify(tags).replace(/\?/g, '\\u003f');
}

/**
 * Read a decrypted private half back into a tag array.
 *
 * Returns null when the plaintext is not an array of tag arrays. **Null means
 * "this is not a private favorites list", and the caller MUST treat it exactly
 * as it treats a decrypt that failed**: park the ciphertext, publish nothing
 * derived from it, and report a degraded read.
 *
 * The hole this closes is a `JSON.parse` that SUCCEEDS on something that is not
 * a tag array — a number, a string, an object. That leaves the blob marked
 * readable and empty, and the next republish rewrites `content` from those
 * empty lists and destroys it. "I parsed it and it was empty" and "I could not
 * read it" have to be different answers here.
 */
export function decodePrivateFavorites(plaintext: string): string[][] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const tags: string[][] = [];
  for (const tag of parsed) {
    if (!Array.isArray(tag)) return null;
    if (!tag.every((v) => typeof v === 'string')) return null;
    tags.push(tag as string[]);
  }
  return tags;
}

/**
 * A stable digest of what would be published.
 *
 * Every publish costs a signing prompt, and a remote signer makes that a round
 * trip to the user's phone. Comparing this against the last published value
 * skips the prompt and the relay write when a favorite toggle didn't actually
 * change this event.
 */
/**
 * The read, put through THIS writer's own framing — the rule 5 comparison.
 *
 * Rule 5 is "publish only when the bytes change", and reading it literally —
 * compare your merged array against the array as it ARRIVED — is a churn loop,
 * because **two conforming events differ byte for byte.** A reader MUST accept a
 * `k` beside every `i`; a writer MUST emit one `k` per distinct kind at the end.
 * Both layouts are legal and mean the same list. The position of `alt`, the
 * position of `visibility` and the order of the `k` tags are free the same way.
 * Compare raw and a list nobody touched reports a change — and if the other app
 * compares raw too, neither of them ever stops.
 *
 * Rendering the parsed read through {@link tagsFromNodes} IS that reframing, and
 * it reuses the emitter rather than adding a second normaliser to keep in step
 * with it. `parseSingleList` already discards `alt` and reads `k` without acting
 * on it, so both layouts arrive here as the same node list and leave as the same
 * bytes. `medium` stays positional and an entry we cannot parse is carried
 * whole, so a genuine difference still shows up as one.
 *
 * It carries the visibility the READ states, not the one a publish would state:
 * ours would make a list that predates the tag differ from itself forever.
 */
export function readAsWeWouldWriteIt(read: ParsedSingleList): string[][] {
  return tagsFromNodes(read.nodes, read.foreignTags, read.foreignKinds, read.visibility);
}

export function singleListDigest(items: FavoriteEntry[]): string {
  return JSON.stringify(buildSingleListTags(items));
}

// --- reading ---------------------------------------------------------------

/**
 * Walk the tags back into groups.
 *
 * Tolerant by design — a writer that is newer, older or simply sloppier than
 * this one must not cost the user favorites:
 *
 *   - **Both `k` forms are accepted.** Paired with each `i` as the spec writes
 *     it, or one per kind as this app writes it. `k` is ignored entirely on the
 *     way in: an entry's kind comes from its identifier, which is the only
 *     reading that works for both.
 *   - **An item before any feed group is kept**, not dropped, as
 *     `orphanItemGuids`. It cannot be resolved through /episodes/byguid without
 *     a parent, but it can still match a local row by its own guid.
 *   - **An unknown identifier kind is skipped** rather than guessed at.
 *
 * One deliberate divergence: the spec says an entry appearing before any
 * `medium` tag defaults to `podcast`. That is treated as UNKNOWN here instead.
 * This app writes its own unknown-medium groups in exactly that position, so
 * honouring the default would round-trip "not told" into "podcast" and file a
 * music release under Podcasts. The hint is advisory and a resolved answer
 * wins, so unknown is both safer and truer.
 */
export function parseSingleList(tags: string[][]): ParsedSingleList {
  const nodes: ListNode[] = [];
  const foreignTags: string[][] = [];
  const foreignKinds: string[] = [];
  let visibility: ListVisibility | null = null;
  let medium: string | undefined;
  let current: SingleListGroup | null = null;

  for (const tag of tags) {
    const type = tag[0];

    // Ours, and regenerated on the way out — a foreign `alt` is replaced
    // rather than carried, since the event can only have one label.
    if (type === 'alt') continue;

    // Read, never carried as a foreign tag. Letting it fall through to
    // `foreignTags` would replay it AND emit our own, so the event would end
    // up stating the mode twice — and the second copy would be the stale one.
    //
    // A `visibility` tag INSIDE the private half is meaningless — the mode is
    // a property of the list, not of a half — so this drops it there rather
    // than round-tripping a claim no reader may act on.
    if (type === VISIBILITY_TAG) {
      if (tag[1] === 'public' || tag[1] === 'private') visibility = tag[1];
      continue;
    }

    if (type === 'k') {
      const value = tag[1];
      // `k` takes no part in placement and is ignored when parsing entries.
      // A value naming a kind we never emit belongs to another writer, so it
      // rides along rather than being dropped.
      if (value && !isKnownIdentifierKind(value) && !foreignKinds.includes(value)) {
        foreignKinds.push(value);
      }
      continue;
    }

    if (type === 'medium') {
      // An empty value is "not told", never the empty-string medium.
      medium = tag[1] || undefined;
      continue;
    }

    if (type !== 'i' || !tag[1]) {
      foreignTags.push(tag.slice());
      continue;
    }

    const id = tag[1];

    // POSITION 2 PRESENT — an item entry that names its own feed, or something
    // we cannot read. Tested BEFORE the feed branch, because position 1 is the
    // same string on both and the ELEMENT COUNT is the only thing that tells a
    // feed favorite from an item favorite. Branch on position 1 alone and one
    // saved episode reads as a followed show.
    if (tag[2] !== undefined) {
      const feed = parseShowGuid(id);
      const item = parseItemGuid(tag[2]);
      if (feed && item) {
        // Carried whole. It opens no group and ends no legacy run: it is not a
        // feed entry, and a legacy item below it still belongs to whatever
        // group is open above.
        nodes.push({
          t: 'item',
          item: { feedGuid: feed, itemGuid: item, medium, tag: tag.slice() },
        });
        continue;
      }
      // A POSITION 2 WE CANNOT READ IS NOT A FEED FAVORITE. Only
      // `podcast:item:guid:` is defined there today, so an entry carrying
      // anything else belongs to a writer newer than this one — and reading it
      // as a two-element feed entry would turn their entry into a followed
      // show. Carry the whole tag and claim nothing about it.
      nodes.push({ t: 'loose', loose: { tag: tag.slice(), medium } });
      continue;
    }

    const feedGuid = parseShowGuid(id);
    if (feedGuid) {
      current = { feedGuid, medium, itemGuids: [], favorited: false, feedTag: tag.slice() };
      nodes.push({ t: 'group', group: current });
      continue;
    }

    // THE LEGACY FORM, and reading it is mandatory rather than a courtesy:
    // every list published before this revision writes items this way, and
    // dropping the path does not lose a label — it makes every item favorite
    // already on the relays unresolvable by anybody.
    const itemGuid = parseItemGuid(id);
    if (itemGuid && current) {
      if (!current.itemGuids.includes(itemGuid)) {
        current.itemGuids.push(itemGuid);
        (current.itemTags ??= {})[itemGuid] = tag.slice();
      }
      continue;
    }

    // Either a kind we have no placement for, or an item with no group open.
    // Both are carried whole, in position, and NEITHER closes `current` — see
    // `LooseNode`. A malformed `podcast:guid:` dropped here would silently
    // reparent every item after it to the previous feed.
    nodes.push({ t: 'loose', loose: { tag: tag.slice(), medium } });
  }

  return { nodes, visibility, foreignTags, foreignKinds, ...projectNodes(nodes) };
}

/**
 * The `{ shows, tracks }` shape `/api/favorites/sync-shared` resolves against
 * local rows. A group's medium rides along on every track under it, because
 * Podcasting 2.0 has no per-item medium — an item's is its feed's.
 */
export function partitionSingleList(list: {
  groups: SingleListGroup[];
  orphanItemGuids: string[];
}): {
  shows: Array<{ feedGuid: string; medium?: string }>;
  tracks: Array<{ itemGuid: string; feedGuid?: string; medium?: string }>;
} {
  const shows: Array<{ feedGuid: string; medium?: string }> = [];
  const tracks: Array<{ itemGuid: string; feedGuid?: string; medium?: string }> = [];

  for (const group of list.groups) {
    shows.push({ feedGuid: group.feedGuid, medium: group.medium });
    for (const itemGuid of group.itemGuids) {
      tracks.push({ itemGuid, feedGuid: group.feedGuid, medium: group.medium });
    }
  }
  for (const itemGuid of list.orphanItemGuids) tracks.push({ itemGuid });

  return { shows, tracks };
}

/**
 * Drop entries this device removed but has not yet managed to un-publish.
 *
 * The inbound path runs before the outbound one — read, reconcile, then push —
 * so between an unfavorite and its publish the list still carries the entry.
 * Reconciling it straight back in re-creates the row, and the push that follows
 * then sees it as local again, produces the tags already on the wire, and is
 * skipped as unchanged. The removal never propagates and the favorite returns
 * on every load. Observed three times before this existed.
 *
 * Same question as `mergeSingleList`, same answer: an entry we published and no
 * longer hold is ours removed, not theirs added. Anything we never published is
 * left alone, so a genuine inbound favorite from another app still arrives.
 */
export function suppressOwnRemovals<
  S extends { feedGuid: string },
  T extends { itemGuid: string },
>(
  incoming: { shows: S[]; tracks: T[] },
  local: SingleListGroup[],
  published: PublishedRecord
): { shows: S[]; tracks: T[] } {
  const localFeeds = new Set(local.map((g) => g.feedGuid));
  const localItems = new Set(local.flatMap((g) => g.itemGuids));
  const publishedFeeds = new Set(published.feeds);
  const publishedItems = new Set(published.items);

  return {
    shows: incoming.shows.filter(
      (s) => !(publishedFeeds.has(s.feedGuid) && !localFeeds.has(s.feedGuid))
    ),
    tracks: incoming.tracks.filter(
      (t) => !(publishedItems.has(t.itemGuid) && !localItems.has(t.itemGuid))
    ),
  };
}

/** Read the user's kind:10333 event. Plain replaceable — no `d` tag. */
export async function fetchSingleList(pubkey: string, relays: string[]): Promise<SingleList> {
  const filter: Filter = { kinds: [SINGLE_LIST_KIND], authors: [pubkey], limit: 1 };
  const { event, trustworthy } = await readReplaceableEvent({ pubkey, relays, filter });

  if (!event) {
    return { ...EMPTY_PARSED, updatedAt: 0, exists: false, trustworthy, content: '' };
  }
  return {
    ...parseSingleList(event.tags),
    updatedAt: event.created_at,
    exists: true,
    trustworthy: true,
    // Verbatim, and never parsed. See `SingleList.content`.
    content: event.content,
  };
}
