/**
 * The PC20-Nostr favorites conformance suite, pointed at THIS app's merge.
 *
 *   npm run check:conformance
 *
 * `../PC20-Nostr/conformance/vectors.test.mjs` is the spec's 24 vectors as
 * code, driven through the contract in `conformance/adapter.d.ts`. This file
 * is the shim: it maps that contract onto the real `favorites-single-list.ts`
 * and `favorites-privacy.ts`, so a failure is this app's merge disagreeing
 * with the document it implements — never a copy drifting from the shipping
 * code. Loaded by `tsx`, which is what resolves the extensionless imports.
 *
 * WHAT IS WIRED, AND WHAT IS STOOD IN FOR. `plan()` replays the orchestration
 * in `favorites-sync-client.ts` — `resolveMode`, `publishGate`, `publishPlan`,
 * the digest gate and the plaintext cap — over the pure functions, because
 * that wiring is where this feature's bugs have lived. Two things cannot exist
 * here and are modelled: the signer (a reversible, unauthenticated `seal`,
 * standing in for NIP-44 exactly as the spec's reference does) and the read
 * (the vector hands us the event, so it is trustworthy; `read: null` is the
 * degraded case). The digest gate compares against the READ rather than
 * against `localStorage`, which is the comparison the spec asks for and the
 * only one a pure harness can make.
 *
 * Keep this a THIN mapping. Logic added here is logic the suite runs that the
 * app does not.
 */

import {
  EMPTY_PARSED,
  SINGLE_LIST_KIND,
  decodePrivateFavorites,
  encodePrivateFavorites,
  isItemClaim,
  itemClaim as realItemClaim,
  parseSingleList,
  plaintextBytes,
  frameForCompare,
  statedVisibility,
  PRIVATE_PLAINTEXT_MAX,
  type ParsedSingleList,
  type SingleListGroup,
} from './favorites-single-list';
import {
  publishGate,
  publishPlan,
  seedModeFromWire,
  type FavoritesPrivacy,
  type PrivacyBaseline,
} from './favorites-privacy';
import {
  ITEM_KIND,
  PUBLISHER_KIND,
  SHOW_KIND,
  identifierKind,
  itemId,
  parseItemGuid,
  parseShowGuid,
  showId,
} from './pc20-identifiers';

// --- the signer stand-in ----------------------------------------------------

const PRIV_PREFIX = 'PRIV1:';

/** NOT encryption. Stands in for NIP-44 encrypt-to-self, reversibly. */
export const seal = (text: string): string =>
  PRIV_PREFIX + Buffer.from(text, 'utf8').toString('base64');

const unseal = (content: string): string | null =>
  content.startsWith(PRIV_PREFIX)
    ? Buffer.from(content.slice(PRIV_PREFIX.length), 'base64').toString('utf8')
    : null;

/** The real plaintext codec — `?` escaped, non-array refused. */
export const encodePlaintext = (tags: string[][]): string => encodePrivateFavorites(tags ?? []);
export const decodePlaintext = (text: string): string[][] | null => decodePrivateFavorites(text);

export const encodePrivate = (tags: string[][]): string =>
  !tags || tags.length === 0 ? '' : seal(encodePlaintext(tags));

export function decodePrivate(content: string): string[][] | null {
  if (!content) return [];
  const text = unseal(content);
  return text === null ? null : decodePlaintext(text);
}

// --- parsing ----------------------------------------------------------------

export const kindOf = (id: unknown): string | null =>
  typeof id === 'string' ? identifierKind(id) : null;

interface Entry {
  id: string;
  kind: string;
  medium: string | null;
  /** The BARE feed guid this entry names, off position 1 of its OWN tag. */
  feed: string | null;
  /** True when the feed came from the entry above rather than from the tag. */
  legacy?: boolean;
  favorited?: boolean;
  key?: string;
  index: number;
}

/**
 * A baseline claim on one item favorite: the real one, from the shipping module.
 *
 * The contract only requires that one pair always produce the same string and
 * two pairs never collide. This app encodes it as the feed identifier, a
 * separator, then the item identifier — feed first, because a feed guid is a
 * UUID and an item guid is routinely a permalink URL.
 */
export const itemClaim = (itemIdentifier: string, feedGuid: string): string =>
  realItemClaim(parseItemGuid(itemIdentifier) ?? itemIdentifier, feedGuid);

/** The contract's flat entry list, derived from this app's ordered node list. */
export function parseTags(tags: string[][]) {
  const input = tags ?? [];
  const list = parseSingleList(input);
  const entries: Entry[] = [];
  const favorited = new Map<string, boolean>();
  const foreign: Array<{ index: number; tag: string[] }> = [];

  // Tag positions, so a reader can check that order survived. Matched on the
  // WHOLE tag and first-unused, because a duplicate group names the same
  // identifier twice AND a feed entry shares position 1 with every item entry
  // under it — keying on position 1 alone pairs them with each other.
  const used = new Set<number>();
  const indexOf = (tag: string[]): number => {
    const want = JSON.stringify(tag);
    for (let i = 0; i < input.length; i++) {
      if (!used.has(i) && input[i][0] === 'i' && JSON.stringify(input[i]) === want) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };

  for (const node of list.nodes) {
    if (node.t === 'group') {
      const id = showId(node.group.feedGuid);
      const medium = node.group.medium ?? null;
      // A FEED ENTRY IS A FEED FAVORITE. Nothing is on the list for structural
      // reasons any more — but this app still WRITES a placement group, so the
      // claim is about what the wire says rather than about what it holds.
      entries.push({
        id,
        kind: SHOW_KIND,
        medium,
        feed: null,
        favorited: true,
        key: id,
        index: indexOf(node.group.feedTag ?? ['i', id]),
      });
      favorited.set(id, true);
      for (const guid of node.group.itemGuids) {
        const item = itemId(guid);
        entries.push({
          id: item,
          kind: ITEM_KIND,
          medium,
          // The LEGACY form: its feed came from the entry above it.
          feed: node.group.feedGuid,
          legacy: true,
          key: itemClaim(item, node.group.feedGuid),
          index: indexOf(node.group.itemTags?.[guid] ?? ['i', item]),
        });
      }
      continue;
    }

    if (node.t === 'item') {
      const item = itemId(node.item.itemGuid);
      entries.push({
        id: item,
        kind: ITEM_KIND,
        medium: node.item.medium ?? null,
        // Off position 1 of its OWN tag.
        feed: node.item.feedGuid,
        key: itemClaim(item, node.item.feedGuid),
        index: indexOf(node.item.tag),
      });
      continue;
    }

    const tag = node.loose.tag;
    // The kind of the entry's LAST identifier, not of position 1.
    const kind = kindOf(tag[2] ?? tag[1]);
    const index = indexOf(tag);
    if (kind === null) {
      foreign.push({ index, tag });
      continue;
    }
    // A publisher entry, or an item that named no feed. Neither belongs to a
    // feed and neither is given one.
    entries.push({
      id: tag[1],
      kind,
      medium: node.loose.medium ?? null,
      feed: null,
      legacy: kind === ITEM_KIND ? true : undefined,
      favorited: kind === PUBLISHER_KIND ? true : undefined,
      key: tag[1],
      index,
    });
    if (kind === PUBLISHER_KIND) favorited.set(tag[1], true);
  }
  entries.sort((a, b) => a.index - b.index);

  list.foreignTags.forEach((tag) => {
    const index = input.findIndex((t) => t === tag || JSON.stringify(t) === JSON.stringify(tag));
    foreign.push({ index, tag });
  });
  foreign.sort((a, b) => a.index - b.index);

  return {
    entries,
    favorited,
    kinds: input.filter((t) => t[0] === 'k').map((t) => t[1]),
    foreign,
  };
}

// --- shapes -----------------------------------------------------------------

interface ContractGroup {
  id: string;
  medium: string | null;
  items: string[];
  favorited?: boolean;
}

/** Contract groups -> this app's `SingleListGroup[]`. */
function localGroups(groups: ContractGroup[]): SingleListGroup[] {
  const out: SingleListGroup[] = [];
  for (const g of groups ?? []) {
    const feedGuid = parseShowGuid(g.id);
    if (!feedGuid) continue;
    out.push({
      feedGuid,
      medium: g.medium ?? undefined,
      itemGuids: (g.items ?? []).map((id) => parseItemGuid(id)).filter((x): x is string => !!x),
      // Absent reads as true, which is what every vector written before the
      // field meant. `false` says the group is held only to supply its items'
      // feed guid, so the FEED itself is not an entry.
      favorited: g.favorited !== false,
    });
  }
  return out;
}

/** `{public, private}` identifier lists -> this app's per-half guid records. */
function toBaseline(b: { public?: string[]; private?: string[] } | undefined): PrivacyBaseline {
  // A PAIRED ITEM CLAIM OPENS WITH THE FEED'S IDENTIFIER, so `parseShowGuid`
  // answers for it and every item claim would be filed under feeds — the merge
  // would then never see the claim that licenses a removal. `isItemClaim` is
  // asked first, and it comes from the shipping module rather than a separator
  // written down a second time here.
  // Items arrive as finished claims from `itemClaim` and are stored as they are;
  // feeds arrive as NIP-73 identifiers and are stored bare. Classify BEFORE
  // flattening — a paired claim holds the separator, a feed identifier does not.
  const half = (ids: string[] | undefined) => ({
    feeds: (ids ?? [])
      .filter((id) => !isItemClaim(id))
      .map(parseShowGuid)
      .filter((x): x is string => !!x),
    items: (ids ?? []).filter(isItemClaim),
  });
  return { public: half(b?.public), private: half(b?.private) };
}

// `items` already holds finished claims (`itemClaim` output), so they go back
// as they are — running `itemId` over one would prefix the pair a second time.
const fromBaseline = (b: PrivacyBaseline) => ({
  public: [...b.public.feeds.map(showId), ...b.public.items],
  private: [...b.private.feeds.map(showId), ...b.private.items],
});

const hasEntries = (list: ParsedSingleList) =>
  list.groups.length > 0 || list.orphanItemGuids.length > 0;

// --- one cycle --------------------------------------------------------------

export function plan(input: {
  read: { tags: string[][]; content: string } | null;
  local?: ContractGroup[];
  baseline?: { public?: string[]; private?: string[] };
  mode?: 'public' | 'private' | null;
  canReadPrivate?: boolean;
  userChose?: boolean;
}) {
  const { read, local = [], baseline, mode = null, canReadPrivate = true, userChose = false } = input;
  const unchanged = {
    publish: null as null | { kind: number; tags: string[][]; content: string },
    baselineIfLanded: {
      public: [...(baseline?.public ?? [])],
      private: [...(baseline?.private ?? [])],
    },
  };

  // Rule 1. The vector hands us the event, so a present read is trustworthy
  // and an absent one is the degraded case.
  if (read === null || read === undefined) return unchanged;

  const readTags = read.tags ?? [];
  const readContent = read.content ?? '';
  const publicRead = parseSingleList(readTags);

  // `readPrivateHalf`'s answers: none, readable, unsupported, unreadable. The
  // last two are the same thing here — a half this writer may not derive a
  // publish from — and `publishSingleList` refuses on either.
  let privateRead: ParsedSingleList = EMPTY_PARSED;
  let privateTagsRead: string[][] = [];
  let privateUsable = true;
  if (readContent !== '') {
    const text = canReadPrivate ? unseal(readContent) : null;
    const decoded = text === null ? null : decodePlaintext(text);
    if (decoded === null) privateUsable = false;
    else {
      privateTagsRead = decoded;
      privateRead = parseSingleList(decoded);
    }
  }
  const hasPublic = hasEntries(publicRead);
  const hasPrivate = hasEntries(privateRead);

  // `resolveMode`: a stored setting wins; otherwise seed from the tag, then
  // from emptiness, and 'off' — publish nothing — when neither can say or the
  // private half could not be read.
  let stored: FavoritesPrivacy | null = mode;
  if (stored === null) {
    if (!privateUsable) return unchanged;
    stored = publicRead.visibility ?? seedModeFromWire(hasPublic, hasPrivate);
    if (!stored) return unchanged;
  }

  // `publishGate`: an automatic cycle whose stored mode disagrees with what
  // the wire says stops and asks; a choice publishes over the conflict.
  const gate = publishGate({
    stored,
    privateHalfUsable: privateUsable,
    hasPublic,
    hasPrivate,
    intent: userChose ? 'resolve' : 'auto',
    stated: publicRead.visibility,
  });
  if (!gate.publish) return unchanged;
  if (stored === 'off') return unchanged;

  // `publishSingleList`: an unusable private half refuses any publish that
  // would have to touch it; a public writer on a list that does not say
  // private carries it and writes the public half.
  if (!privateUsable && (stored === 'private' || publicRead.visibility === 'private')) {
    return unchanged;
  }

  const p = publishPlan({
    mode: stored,
    publicRead,
    privateRead,
    local: localGroups(local),
    baseline: toBaseline(baseline),
    userChose,
    canReadPrivate: privateUsable,
  });

  // RULE 5, against the read PUT THROUGH THIS WRITER'S OWN FRAMING. Two
  // conforming events differ byte for byte — a `k` beside every `i` and one `k`
  // per kind at the end are both legal and mean the same list — so comparing the
  // read as it arrived republishes a list nothing had changed, on every load,
  // forever if the other app does the same. `readAsWeWouldWriteIt` renders the
  // parsed read through the same emitter the plan used, which is what
  // `publishSingleList` compares against.
  const privateTags = p.privateTags ?? [];
  const privateSame =
    JSON.stringify(privateTags.filter((t) => t[0] === 'i')) ===
    JSON.stringify(privateTagsRead.filter((t) => t[0] === 'i'));
  if (
    JSON.stringify(frameForCompare(p.tags, statedVisibility(p.tags))) ===
      JSON.stringify(frameForCompare(readTags, statedVisibility(readTags))) &&
    privateSame
  ) {
    return { publish: null, baselineIfLanded: fromBaseline(p.baseline) };
  }

  // `buildContent`: an opaque half -> the ciphertext verbatim, nothing to
  // encrypt -> '', unchanged -> carry the ciphertext, over the cap -> refuse
  // the whole publish.
  let content: string;
  if (p.privateTags === null) content = readContent;
  else if (privateTags.every((t) => t[0] !== 'i')) content = '';
  else if (privateSame && readContent !== '') content = readContent;
  else {
    const text = encodePlaintext(privateTags);
    if (plaintextBytes(text) > PRIVATE_PLAINTEXT_MAX) return unchanged;
    content = seal(text);
  }

  return {
    publish: { kind: SINGLE_LIST_KIND, tags: p.tags, content },
    baselineIfLanded: fromBaseline(p.baseline),
    // The contract's `holds`: this app's local state is a database the merge
    // never writes. The inbound reconcile adds what it can resolve, add-only,
    // and a vector's foreign entries are by definition unresolvable here.
    holds: local,
  };
}
