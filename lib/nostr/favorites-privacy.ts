/**
 * Public / private / not-on-Nostr, for the shared kind:10333 favorites list.
 *
 * The list is public in a stronger sense than "someone with your pubkey can
 * read it". Every entry is an `i` tag, `i` is a single-letter tag, and relays
 * INDEX those — so a `#i` filter answers *which pubkeys favorited this feed*.
 * The list is searchable in reverse. `content` is the only free slot in the
 * event, and per the spec's private-half section it takes NIP-51's split:
 * public entries stay in tags, private entries go in `content` as a NIP-44
 * encrypt-to-self of a tag array.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR THINGS A SECOND HALF BREAKS
 *
 * None is hypothetical. Boost Me Bitch shipped fifteen defects finding them,
 * and the last and worst one passed every vector the other fourteen added.
 *
 * 1. IDEMPOTENCE. NIP-44 draws a fresh nonce, so re-encrypting identical
 *    entries produces different bytes every time. A ciphertext comparison
 *    therefore always differs and every load republishes — two apps rewriting
 *    the event against each other forever, this time self-inflicted. Compare
 *    the DECRYPTED arrays. `publishPlan` returns `privateTags` for exactly
 *    that, and the caller must digest those rather than the ciphertext.
 *
 * 2. THE BASELINE HAS TO SAY WHICH HALF. Moving an entry public→private is a
 *    removal on one side and an addition on the other. Against one shared
 *    baseline those cancel and the entry is deleted outright.
 *
 * 3. THE BASELINE MUST NOT CLAIM THE HALF IT DOES NOT FEED. This is the one
 *    that hid behind every other guard. The active half's claims are derived
 *    from what we just published there. The inactive half's are CARRIED
 *    FORWARD from the previous record and then cleared by the move — never
 *    re-derived, because nothing feeds that half next cycle, so a derived
 *    claim goes unbacked and the removal test fires on the whole half at once.
 *    Cycle 1 claims another writer's entries and cycle 2 deletes them, and
 *    cycle 1 need not even publish for it to happen.
 *
 * 4. THE INACTIVE HALF IS NOT PAINTED INTO LOCAL STATE. Local favorites are
 *    written through to the database and read back as `local`, which goes
 *    wholly into the ACTIVE half. So an entry adopted out of the inactive half
 *    is republished into this one: for our own entries that is how a switch
 *    completes, but for another writer's it is a migration nobody asked for —
 *    and in the private→public direction it is a DISCLOSURE, because relays
 *    index `i`. `claimedByBaseline` filters it to what this device claims. A
 *    foreign private half is carried but not shown; that is the cost.
 * ---------------------------------------------------------------------------
 *
 * Everything here is pure. The signer, the relays and `localStorage` live in
 * `favorites-sync-client.ts`; this file is where the reasoning is testable.
 */

import {
  type ListNode,
  type ListVisibility,
  type ParsedSingleList,
  type PublishedRecord,
  type SingleListGroup,
  EMPTY_PARSED,
  mergeSingleList,
  publishedRecordFrom,
  tagsFromNodes,
  withVisibility,
} from './favorites-single-list';

/**
 * Where this device puts new favorites.
 *
 * `'off'` is not "stop syncing quietly" — it is a withdrawal, and it publishes
 * once to take down what this device claims before it stops. See
 * `withdrawalPlan`.
 */
export type FavoritesPrivacy = 'public' | 'private' | 'off';

/**
 * Does going private take the WHOLE list, including entries this app did not
 * write and cannot resolve?
 *
 * The spec says it must — the choice belongs to the list, not to the app — and
 * the alternative was measured: a real account went private and 13 of 449
 * entries stayed in the tags, public and relay-indexed, because a second app
 * had written them. Nothing on screen said which. A user who has made a privacy
 * choice and got 97% of it is worse off than one told plainly that they have to
 * make it again elsewhere.
 *
 * ON since 2026-08-26. The sequencing this waited on is complete: an app must
 * be able to READ and RENDER `content` before anything moves entries into it on
 * that app's behalf, or the move is indistinguishable from a deletion on its
 * screen. Boost Me Bitch reads it (boostmebitch#222) and renders it
 * (boostmebitch#232), and it is the only other writer of this list.
 *
 * Only ever public → private. The reverse is a disclosure and stays limited to
 * what this device's baseline claims — see `publishPlan`. That asymmetry does
 * NOT depend on this flag and must survive it being removed.
 */
export const WHOLE_LIST_PRIVACY_MOVE = true;

/** The half a set of claims belongs to. `'off'` claims neither. */
export type ListHalf = 'public' | 'private';

/**
 * What this device has put on each half of the list.
 *
 * Two records rather than one, per defect 2 above. The old single-record shape
 * (`{feeds, items}`) migrates to `public`, which is true by construction —
 * everything published before this file existed went in tags.
 */
export interface PrivacyBaseline {
  public: PublishedRecord;
  private: PublishedRecord;
}

const EMPTY_RECORD: PublishedRecord = { feeds: [], items: [] };
export const EMPTY_BASELINE: PrivacyBaseline = { public: EMPTY_RECORD, private: EMPTY_RECORD };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const record = (v: unknown): PublishedRecord => ({
  feeds: strings((v as any)?.feeds),
  items: strings((v as any)?.items),
});

/**
 * Read a stored baseline, in either shape.
 *
 * The old `{feeds, items}` is read as the PUBLIC half's claims. That is not a
 * guess: nothing could have written a private entry before this existed, so
 * every claim on record is a tag claim. Reading it as `private` — or as
 * neither — would make the first publish after upgrading treat this device's
 * own public entries as another app's and carry them forever.
 *
 * Anything unreadable becomes empty, which is the safe direction: **an empty
 * record treats nothing as a removal and suppresses nothing.** A device that
 * has agreed to nothing may not delete anything.
 */
export function parseBaseline(raw: string | null): PrivacyBaseline {
  if (!raw) return EMPTY_BASELINE;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.public || parsed.private)) {
      return { public: record(parsed.public), private: record(parsed.private) };
    }
    // The pre-halves shape. Everything on it was published as tags.
    return { public: record(parsed), private: EMPTY_RECORD };
  } catch {
    return EMPTY_BASELINE;
  }
}

/** The other half. `'off'` has no active half, so callers handle it first. */
export const otherHalf = (half: ListHalf): ListHalf =>
  half === 'public' ? 'private' : 'public';

/**
 * Which mode a device should adopt for an account that already has a list.
 *
 * Returns null for "ask the user" — and getting this wrong FAILS OPEN, which
 * is why each half answers only for itself.
 *
 * Testing the public half first is the tempting shape and it is a disclosure
 * bug: a device seeded `'public'` over an account whose entries are private
 * paints the decrypted entries into its store and republishes every one as a
 * plaintext, relay-indexed tag. Reversing the tests is wrong the other way — it
 * moves a genuinely public account into `content`, which is an edit nobody
 * asked for. Only one half having anything in it is an answer. Both, or
 * neither, is a question.
 */
export function seedModeFromWire(hasPublic: boolean, hasPrivate: boolean): FavoritesPrivacy | null {
  if (hasPublic && !hasPrivate) return 'public';
  if (hasPrivate && !hasPublic) return 'private';
  return null;
}

/**
 * Which half the WIRE says this list is in, when the stored mode says the other.
 *
 * The mode is per-app and per-device — `sk_favorites_privacy:<pubkey>` here,
 * `bmb:favPrivacy:<npub>` in Boost Me Bitch — and there is nothing on the wire
 * that says which half the list intends to be. So two apps can hold opposite
 * answers about one shared event, and every load of whichever app ran last
 * rewrites the whole list to match its own stored answer. That is not a
 * hypothetical: this app was left on `'private'` for an account whose list had
 * since been made entirely public from the other one, and the next page load
 * would have moved all 287 entries back into `content` with no user action and
 * nothing on screen.
 *
 * WHOLESALE is the whole point. The reuse of `seedModeFromWire` is deliberate:
 * one half populated and the other empty is exactly the shape it already
 * answers for, and everything else is either ambiguous (both halves have
 * entries — that is the both-halves state, and it belongs to the counts, not
 * here) or empty (nothing to rewrite). A partial disagreement is ordinary and
 * must stay silent, or this fires on every account that has ever used both.
 */
export type WireVerdict = 'wire-public' | 'wire-private' | null;

export function wireContradictsMode(
  stored: FavoritesPrivacy | null,
  hasPublic: boolean,
  hasPrivate: boolean,
  stated: ListVisibility | null = null
): WireVerdict {
  // Never asked: seeding owns that case and this must not pre-empt it.
  if (!stored || stored === 'off') return null;
  // A STATED mode outranks the inference, and widens what counts as a
  // conflict. Emptiness can only tell you about a list that is wholly one
  // thing; the tag is a fact about the list, so ANY disagreement with it is
  // one app about to overrule another — including on a list whose halves both
  // hold entries, where `seedModeFromWire` has nothing to say.
  const wire = stated ?? seedModeFromWire(hasPublic, hasPrivate);
  if (!wire || wire === stored) return null;
  return wire === 'public' ? 'wire-public' : 'wire-private';
}

/** What a sync may do, given the disagreement above. */
export interface PublishGate {
  /** May this cycle publish at all? */
  publish: boolean;
  /** The disagreement to show, or null. Reported even when publishing. */
  conflict: WireVerdict;
}

/**
 * May this cycle publish, and is there a disagreement to show?
 *
 * `intent` is the consent. `'auto'` is a page load — nobody asked for anything,
 * so a cycle that would rewrite the whole list stops and the screen asks.
 * `'resolve'` is the user pressing Public or Private, which IS the answer, so
 * it publishes over the conflict while still reporting it (the screen wants
 * the numbers either way).
 *
 * AN UNREADABLE PRIVATE HALF IS NEVER A CONFLICT. `unreadable`, `unsupported`
 * and `none` all present as an empty private half, so a verdict computed from
 * one would tell a private-mode user their list is entirely public when it is
 * not — and the buttons under that sentence would then do real damage. No
 * publish either way (`publishSingleList` already refuses), and no claim on
 * screen. Carry, publish nothing, say so.
 */
export function publishGate(input: {
  stored: FavoritesPrivacy | null;
  privateHalfUsable: boolean;
  hasPublic: boolean;
  hasPrivate: boolean;
  intent: 'auto' | 'resolve';
  /** The `visibility` tag as read, or null on a list written before it. */
  stated?: ListVisibility | null;
}): PublishGate {
  // A half we could not open is not a half we may write INTO, and it is not a
  // half we may reason about — so no conflict is ever claimed from it. But a
  // PUBLIC writer on a list that does not say private may still publish the
  // public half, carrying the ciphertext byte for byte: that is spec rule 4's
  // `content` clause and vector 12, and refusing it stranded every favorite a
  // NIP-55 user made here the moment any other app put anything in `content`.
  // Spec: "Such an app carries `content` verbatim, keeps writing into the
  // half the tag names if it can, and says on screen that it cannot open the
  // other one."
  if (!input.privateHalfUsable) {
    const mayWritePublic = input.stored === 'public' && input.stated !== 'private';
    return { publish: mayWritePublic, conflict: null };
  }
  const conflict = wireContradictsMode(
    input.stored,
    input.hasPublic,
    input.hasPrivate,
    input.stated ?? null
  );
  return { publish: !conflict || input.intent === 'resolve', conflict };
}

/**
 * The subset of a half's entries this device put there.
 *
 * Defect 4. The inactive half is carried on the wire whatever happens, but only
 * the part we claim may reach local state — an entry adopted out of another
 * writer's half is republished into ours on the next cycle, which is a
 * migration nobody asked for and, private→public, a disclosure.
 */
export function claimedByBaseline(
  groups: SingleListGroup[],
  claims: PublishedRecord
): SingleListGroup[] {
  const feeds = new Set(claims.feeds);
  const items = new Set(claims.items);
  const out: SingleListGroup[] = [];
  for (const g of groups) {
    const keptItems = g.itemGuids.filter((i) => items.has(i));
    const keptFeed = feeds.has(g.feedGuid);
    if (!keptFeed && keptItems.length === 0) continue;
    out.push({ ...g, itemGuids: keptItems, favorited: keptFeed && g.favorited });
  }
  return out;
}

/** What a publish should contain, and what to record if it lands. */
export interface PublishPlan {
  /** The event's `tags`. */
  tags: string[][];
  /**
   * The private half as a TAG ARRAY, before encryption — null when there is no
   * private half to write and `content` should be carried instead.
   *
   * Returned rather than a ciphertext because this is what the digest compares
   * and what idempotence is decided on. NIP-44's nonce makes the ciphertext
   * different on every pass, so comparing it republishes forever.
   */
  privateTags: string[][] | null;
  /** The baseline to store IF the relays accept the event, and only then. */
  baseline: PrivacyBaseline;
  /**
   * Favorites this publish leaves on the OTHER half, because another app wrote
   * them and this device does not claim them.
   *
   * Surfaced rather than counted and forgotten: a user who chose Private and
   * got 97% of it must be told which part did not move, or the format has
   * quietly made a promise it did not keep. This replaced
   * `strandedInPublicHalf`, which answered only the private direction and was
   * pinned to zero once {@link WHOLE_LIST_PRIVACY_MOVE} shipped — so the only
   * both-halves signal the app had became unreachable on the day it started to
   * matter. A public-mode list with an encrypted half it is carrying reported
   * nothing at all.
   *
   * Counted on FAVORITES, not on `i` values: a group with items is a placement
   * and the format has no other way to name a track's feed.
   */
  carriedInOtherHalf: number;
  /**
   * Favorites named in BOTH emitted halves.
   *
   * The format says no entry is in both, and nothing here checked. Zero once
   * `withoutCarried` runs, which is what makes a non-zero value worth showing:
   * it is a state this device did not create and cannot repair on its own.
   */
  inBothHalves: number;
}

/**
 * Fold the nodes moving in from the other half into the ones already here.
 *
 * **A concatenation was wrong, and only one state shows it.** An entry can sit
 * in BOTH halves at once — nothing in the format forbids it, and a mode switch
 * that publishes into one half while its removal from the other is
 * baseline-gated produces exactly that. Measured on a real account: 284
 * favorites in the public tags, 287 in the encrypted half, all 284 in both.
 * Concatenating then emits one feed as TWO groups, because `tagsFromNodes`
 * writes every node it is handed. Two groups for one feed double-count it for
 * every reader and give its items two parents to sit under.
 *
 * Folding rather than dropping, because the incoming group may carry items the
 * one already here does not: this is a MOVE, and an item under a duplicate
 * group is as much the user's as the group itself. Order is the existing half's
 * — tag order is semantic, so the side already in place keeps its positions and
 * the incoming items append.
 *
 * Loose nodes fold on their identifier for the same reason. A duplicate there
 * is the same entry named twice, not two entries.
 *
 * See spec test vector 15.
 */
function mergeMovedNodes(here: ListNode[], moving: ListNode[]): ListNode[] {
  const out = here.map((n) =>
    n.t === 'group' ? { t: 'group' as const, group: { ...n.group, itemGuids: [...n.group.itemGuids] } } : n
  );
  const groupAt = new Map<string, number>();
  const looseIds = new Set<string>();
  out.forEach((n, i) => {
    if (n.t === 'group') groupAt.set(n.group.feedGuid, i);
    else if (n.loose.tag[1]) looseIds.add(n.loose.tag[1]);
  });

  for (const node of moving) {
    if (node.t === 'loose') {
      const id = node.loose.tag[1];
      if (id && looseIds.has(id)) continue;
      if (id) looseIds.add(id);
      out.push(node);
      continue;
    }
    const at = groupAt.get(node.group.feedGuid);
    if (at === undefined) {
      groupAt.set(node.group.feedGuid, out.length);
      out.push({ t: 'group', group: { ...node.group, itemGuids: [...node.group.itemGuids] } });
      continue;
    }
    const existing = out[at];
    if (existing.t !== 'group') continue;
    for (const guid of node.group.itemGuids) {
      if (!existing.group.itemGuids.includes(guid)) existing.group.itemGuids.push(guid);
    }
    // The medium hint only ever FILLS a gap. Overwriting one the feed declared
    // with one it did not is how a hint becomes wrong.
    if (!existing.group.medium && node.group.medium) {
      existing.group.medium = node.group.medium;
    }
    // AND THE TAIL of the `i` tag, on exactly the same terms. This is the one
    // branch where a group survives the fold WITHOUT a spread, so anything past
    // the identifier on the moving half's copy was dropped outright here —
    // not deferred to the copy already in place, which is what the medium rule
    // above reads like. A whole-list privacy move is the only thing that runs
    // this, so nothing is visibly wrong first. The spec names the mutation:
    // "keep the first copy's marker when folding two halves", its vector 25.
    //
    // We can read neither tail, so we cannot prefer one: fill a gap, never
    // overwrite.
    if (!existing.group.extra?.length && node.group.extra?.length) {
      existing.group.extra = node.group.extra;
    }
    for (const guid of node.group.itemGuids) {
      const tail = node.group.itemExtra?.[guid];
      if (!tail?.length) continue;
      if (existing.group.itemExtra?.[guid] !== undefined) continue;
      existing.group.itemExtra = { ...existing.group.itemExtra, [guid]: tail };
    }
  }
  return out;
}

/**
 * The favorites a half actually names, as opposed to the identifiers in it.
 *
 * A group with items is a PLACEMENT — the format has no other way to say which
 * feed a track came from — so only an ITEMLESS group is a feed favorite. Items
 * are favorites wherever they sit, including the orphans another writer left
 * above the first group.
 *
 * The distinction is the whole reason this is not a set of `i` values: a feed
 * can legitimately be a placement group in one half and a favorite in the
 * other, and counting that as "in both halves" would report a defect that is
 * not there.
 */
function namedFavoritesIn(nodes: ListNode[]): { feeds: Set<string>; items: Set<string> } {
  const feeds = new Set<string>();
  const items = new Set<string>();
  for (const node of nodes) {
    if (node.t !== 'group') continue;
    if (node.group.itemGuids.length === 0) feeds.add(node.group.feedGuid);
    for (const guid of node.group.itemGuids) items.add(guid);
  }
  return { feeds, items };
}

/** The same, for a parse — which also knows about items above the first group. */
function namedFavorites(list: ParsedSingleList): { feeds: Set<string>; items: Set<string> } {
  const named = namedFavoritesIn(list.nodes);
  for (const guid of list.orphanItemGuids) named.items.add(guid);
  return named;
}

/**
 * How many favorites a half names — for a sentence on screen, never for a
 * decision. Counted the same way everywhere so two numbers shown side by side
 * are comparable: itemless groups plus items, placements excluded.
 */
export function countNamedFavorites(list: ParsedSingleList): number {
  const named = namedFavorites(list);
  return named.feeds.size + named.items.size;
}

/**
 * Drop from `local` whatever this device is only CARRYING on the other half.
 *
 * Defect 4 again, from the side `claimedByBaseline` cannot reach. That filter
 * governs what the RECONCILE may adopt, and it is right; but local state is a
 * database, and this app's inbound reconcile is add-only by construction — it
 * posts an empty baseline, and the route refuses to delete anything the
 * baseline never claimed. So an entry adopted while the mode was `'private'`
 * stays in the database after a switch to `'public'`, arrives back here in
 * `local`, and is written into the PUBLIC tags while `inactiveMerged` carries
 * the very same entry in `content`.
 *
 * Two faults from one line. The entry is in both halves, which the format says
 * it may not be and which double-counts it for every reader. And in the
 * private → public direction it is a DISCLOSURE: relays index `i`, so a
 * favorite the user chose to encrypt becomes searchable in reverse — published
 * by an app they never asked to publish it, from a database row they cannot
 * see. Measured on a real account: 284 in the tags, 287 encrypted, all 284 in
 * both.
 *
 * `carried` is the inactive half AFTER its own merge, never the raw read.
 * Anything this device claims there has already been removed by that merge, so
 * it is not carried and is not filtered — which is exactly what lets the first
 * publish after a mode switch move our own entries across.
 *
 * PRESENT IN THE ACTIVE HALF WINS. A favorite in both halves is ours to
 * publish: dropping it here would take it out of `publishedRecordFrom(local)`
 * as well, un-claiming an entry we do publish and making it foreign — and a
 * foreign entry is carried forever. That is defect 3 arriving by a different
 * road, and the same rule Boost Me Bitch settled on (boostmebitch#289).
 *
 * A group whose feed is carried but whose items are ours keeps its items and
 * loses only `favorited`. The group still emits its feed tag, because it has
 * to — that is the placement above — and a placement is not a favorite.
 */
function withoutCarried(
  local: SingleListGroup[],
  carried: ParsedSingleList,
  activeRead: ParsedSingleList
): SingleListGroup[] {
  const theirs = namedFavorites(carried);
  if (theirs.feeds.size === 0 && theirs.items.size === 0) return local;
  const ours = namedFavorites(activeRead);

  const out: SingleListGroup[] = [];
  for (const group of local) {
    const dropFeed =
      group.favorited && theirs.feeds.has(group.feedGuid) && !ours.feeds.has(group.feedGuid);
    const itemGuids = group.itemGuids.filter(
      (guid) => !theirs.items.has(guid) || ours.items.has(guid)
    );
    if (dropFeed && itemGuids.length === 0) continue;
    if (!dropFeed && itemGuids.length === group.itemGuids.length) {
      out.push(group);
      continue;
    }
    out.push({ ...group, favorited: dropFeed ? false : group.favorited, itemGuids });
  }
  return out;
}

/**
 * Build the publish, given both halves as read and what this device claims.
 *
 * `mode` decides which half the local favorites are merged into. The other one
 * is carried: merged against its OWN previous claims with no local state, which
 * removes what this device put there and no longer holds — the second half of a
 * mode switch — and carries everything it never claimed.
 *
 * The baseline that comes back is the asymmetry in defect 3, and it is the
 * whole reason this function returns one instead of the caller deriving it:
 *
 *   active half   — derived from `local`, which really does back it next cycle
 *   inactive half — EMPTY, because the merge above just removed everything we
 *                   claimed there. Not re-derived from its merge: that would
 *                   claim the foreign entries we are only carrying, and nothing
 *                   feeds that half next cycle to back the claim, so the
 *                   removal test would fire on all of them at once.
 */
export function publishPlan(input: {
  mode: ListHalf;
  publicRead: ParsedSingleList;
  /** The decrypted private half, or `EMPTY_PARSED` when there is none. */
  privateRead: ParsedSingleList;
  local: SingleListGroup[];
  baseline: PrivacyBaseline;
  /**
   * Is the user CHOOSING this mode right now, rather than it being this app's
   * standing setting?
   *
   * Only a choice may write the `visibility` tag for the first time or change
   * one already there. A standing setting that merely disagrees is two apps
   * holding different answers about one shared event, and letting whichever
   * loaded last win is how a list flips halves on a page load — which is what
   * `publishGate` holds. Stamping our own default on a legacy list would state
   * a mode nobody picked, and on a list that already has a private half that
   * stamp is what would license disclosing it.
   */
  userChose?: boolean;
  /**
   * Could this writer read the private half?
   *
   * False for a signer with no NIP-44, which is a normal state for a real
   * user. Such a writer cannot move what it cannot see, so it may not restate
   * the mode: declaring the list public while the entries in it stay encrypted
   * publishes a false claim about someone's privacy, and the next writer
   * converges on the strength of it.
   */
  canReadPrivate?: boolean;
}): PublishPlan {
  const { mode, publicRead, privateRead, local, baseline } = input;
  const userChose = input.userChose ?? false;
  const canReadPrivate = input.canReadPrivate ?? true;

  // WHAT THE EVENT SAYS, which is not the same as what this writer wants.
  // Null means the list predates the tag, and the old inference stands.
  const stated = publicRead.visibility;

  // An empty private half is readable by anybody — there is no half to be
  // blind to — so a signer with no NIP-44 may still set the mode on a fresh
  // list. Treating empty as opaque would freeze every new account on such a
  // signer at whatever the first writer guessed.
  const privateIsEmpty = privateRead.nodes.length === 0;
  const mayChange = userChose && (canReadPrivate || privateIsEmpty);

  // The mode this publish actually writes, and EVERYTHING below reads this
  // rather than `mode`. A stated mode this writer is not entitled to change
  // outranks its own preference — otherwise a standing setting silently
  // overrules the app the user last answered in.
  const effective: ListHalf = stated && stated !== mode && !mayChange ? stated : mode;

  // Carried forward once the list has a tag; written for the first time only
  // on a real choice.
  const stating: ListVisibility | null = mayChange || stated ? effective : null;

  const inactive = otherHalf(effective);

  const activeRead = effective === 'public' ? publicRead : privateRead;
  const inactiveRead = effective === 'public' ? privateRead : publicRead;

  // The inactive half FIRST, because what survives it is the definition of
  // "carried" and the active half's local state has to be filtered against it.
  //
  // No local state on this side: everything we claim here is a removal in
  // flight (the entry moved to the other half), and everything we don't claim
  // is another writer's and is carried.
  const inactiveMerged = mergeSingleList(inactiveRead, [], baseline[inactive]);

  // What is left on the other half is not ours to republish into this one. See
  // `withoutCarried` — this is the line that stops a favorite the user
  // encrypted being re-emitted as a relay-indexed `i` tag.
  const ours = withoutCarried(local, inactiveMerged, activeRead);
  const activeMerged = mergeSingleList(activeRead, ours, baseline[effective]);

  const activeTags = tagsFromNodes(
    activeMerged.nodes,
    activeMerged.foreignTags,
    activeMerged.foreignKinds
  );
  const inactiveTags = tagsFromNodes(
    inactiveMerged.nodes,
    inactiveMerged.foreignTags,
    inactiveMerged.foreignKinds
  );

  // GOING PRIVATE TAKES THE WHOLE LIST.
  //
  // Everything left in the public half after the merge above is another app's —
  // ours was just removed from it — and it moves too. That is the spec's rule
  // and it is the difference between "private" and "97% private".
  //
  // Safe in this direction UNCONDITIONALLY. It strictly reduces exposure, the
  // entries are carried WHOLE rather than re-rendered, and anything that can
  // decrypt can put them back.
  //
  // THE REVERSE IS A DISCLOSURE, and it now has one licence: a STATED mode.
  // The asymmetry existed because no app could tell the user's intent for the
  // whole list from the event, so private → public moved only what
  // `baseline.private` claimed. `visibility` is that intent, and only a writer
  // that could read both halves may have written it — so with it present the
  // move is symmetric, and without it the conservative rule still stands.
  //
  // The moved entries are NOT claimed in the baseline. Nothing local backs
  // them, so a claim would read as our own removal next cycle and delete them —
  // defect 3, arriving by a different road. They stay foreign, in the other
  // half, and are carried from there exactly as they were carried here.
  const movingWholeList = WHOLE_LIST_PRIVACY_MOVE && effective === 'private';

  // The same fold in the public direction, licensed by the stated mode: either
  // the event already says public — somebody consented, in an app that could
  // see everything — or the user is choosing it right now in an app that can.
  // A list whose tag and entries disagree is one somebody left half-converged;
  // finishing it is what makes "no split in either app" true rather than
  // aspirational.
  const movingWholePublic =
    effective === 'public' &&
    canReadPrivate &&
    (stated === 'public' || (mayChange && mode === 'public')) &&
    inactiveMerged.nodes.length > 0;

  const foldedNodes = mergeMovedNodes(activeMerged.nodes, inactiveMerged.nodes);
  const foldedTags = () =>
    tagsFromNodes(
      foldedNodes,
      [...activeMerged.foreignTags, ...inactiveMerged.foreignTags],
      [...activeMerged.foreignKinds, ...inactiveMerged.foreignKinds]
    );

  const privateNodes = movingWholeList ? foldedNodes : activeMerged.nodes;
  const privateTags = movingWholeList ? foldedTags() : activeTags;
  const publicTags = movingWholePublic ? foldedTags() : activeTags;

  // A private half this writer could not open is CARRIED, never re-rendered.
  // `privateRead` is empty in that case only because there was nothing to
  // parse, and rendering that emptiness back would replace the ciphertext with
  // an encrypted empty array — rule 4's `content` clause broken by the branch
  // that exists to honour it. Null tells `buildContent` to put the bytes back.
  // Only reachable in public mode: `publishSingleList` refuses a private-mode
  // publish over such a half before this is called.
  const carryOpaque = !canReadPrivate && effective === 'public';

  // THE COUNTS DESCRIBE WHAT IS ABOUT TO BE ON THE WIRE, not what was read.
  //
  // Taken from the emitted node lists rather than from the reads, because the
  // merge and the whole-list fold both move entries between them — a count off
  // the read would name a half the publish is about to empty. `movingWholeList`
  // is the case that makes this visible: the public half becomes `[]`, so there
  // is nothing left behind and nothing to report.
  const emittedActive =
    effective === 'private' ? privateNodes : movingWholePublic ? foldedNodes : activeMerged.nodes;
  const emittedInactive = movingWholeList || movingWholePublic ? [] : inactiveMerged.nodes;
  const theirs = namedFavoritesIn(emittedInactive);
  const oursNow = namedFavoritesIn(emittedActive);
  const inBoth =
    [...theirs.feeds].filter((f) => oursNow.feeds.has(f)).length +
    [...theirs.items].filter((i) => oursNow.items.has(i)).length;

  return {
    // The `visibility` tag goes on the EVENT and nowhere else — never inside
    // `privateTags`, which becomes `content`. Going private still emits a tag
    // array rather than nothing: the label and the mode are what is left of a
    // list whose entries have all moved into `content`, and a private list
    // with no entries yet has no other way to say what it is.
    tags: withVisibility(
      effective === 'public'
        ? publicTags
        : movingWholeList
          ? tagsFromNodes([], [], [])
          : inactiveTags,
      stating
    ),
    privateTags: carryOpaque
      ? null
      : effective === 'private'
        ? privateTags
        : movingWholePublic
          ? []
          : inactiveTags,
    // The two partition the other half: an entry is either left there alone or
    // in both places, never counted twice. Saying "287 are still encrypted"
    // when 284 of them are public as well is false in the direction that
    // matters, and the two states have different remedies.
    carriedInOtherHalf: theirs.feeds.size + theirs.items.size - inBoth,
    inBothHalves: inBoth,
    // The inactive half's claims are cleared because its merge just removed
    // everything they named. An OPAQUE half was not merged, so its claims are
    // carried untouched — recomputing them from nothing would disown every
    // private entry this device ever wrote.
    baseline:
      effective === 'public'
        ? { public: publishedRecordFrom(ours), private: carryOpaque ? baseline.private : EMPTY_RECORD }
        : { public: EMPTY_RECORD, private: publishedRecordFrom(ours) },
  };
}

/**
 * Leaving Nostr: take down what this device claims, and nothing else.
 *
 * Both halves are merged with no local state against their own claims, so every
 * entry this device put on the list goes and every entry another app added
 * stays. Afterwards this device claims nothing in either half, which is what
 * makes a later re-opt-in start clean rather than immediately deleting
 * somebody's entries.
 *
 * It publishes once. Declining to publish would leave the relay copy in place,
 * which is a defensible choice but a different one — and a relay cannot be
 * asked to forget, so the offer has to be explicit either way.
 */
export function withdrawalPlan(input: {
  publicRead: ParsedSingleList;
  privateRead: ParsedSingleList;
  baseline: PrivacyBaseline;
}): PublishPlan {
  const { publicRead, privateRead, baseline } = input;
  const pub = mergeSingleList(publicRead, [], baseline.public);
  const priv = mergeSingleList(privateRead, [], baseline.private);
  return {
    tags: tagsFromNodes(pub.nodes, pub.foreignTags, pub.foreignKinds),
    privateTags: tagsFromNodes(priv.nodes, priv.foreignTags, priv.foreignKinds),
    // A withdrawal moves nothing between halves, so it leaves nothing behind
    // and creates no overlap. Both halves keep whatever this device never
    // claimed, exactly where it already was.
    carriedInOtherHalf: 0,
    inBothHalves: 0,
    baseline: EMPTY_BASELINE,
  };
}

/**
 * What the reconcile may see: the active half in full, plus the part of the
 * inactive half this device claims.
 *
 * The second term is what completes a mode switch — our own entries are still
 * sitting in the half we are moving out of until the publish lands, and
 * dropping them here would make them vanish from the page in between. Anything
 * we do not claim is another writer's and stays off local state entirely: see
 * defect 4.
 */
export function reconcileInput(input: {
  mode: ListHalf;
  publicRead: ParsedSingleList;
  privateRead: ParsedSingleList;
  baseline: PrivacyBaseline;
}): { groups: SingleListGroup[]; orphanItemGuids: string[] } {
  const { mode, publicRead, privateRead, baseline } = input;
  const active = mode === 'public' ? publicRead : privateRead;
  const inactive = mode === 'public' ? privateRead : publicRead;
  return {
    groups: [
      ...active.groups,
      ...claimedByBaseline(inactive.groups, baseline[otherHalf(mode)]),
    ],
    // Orphans come from the active half only. We never write one, and an
    // orphan in the half we are not feeding has no claim to check against.
    orphanItemGuids: active.orphanItemGuids,
  };
}

/** A half with nothing in it, for the "no private list yet" case. */
export const EMPTY_HALF: ParsedSingleList = EMPTY_PARSED;
