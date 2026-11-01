/**
 * The public/private split, and the four things it breaks.
 *
 * READ THIS BEFORE ADDING A VECTOR: several of these need TWO cycles to say
 * anything. A single cycle emits correct bytes and only the baseline recorded
 * beside them is wrong, which is exactly why every existing vector in
 * favorites-single-list.test.ts passes over the worst defect in this file. If a
 * test here publishes once and asserts on the tags, it is not testing the thing
 * this module exists for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_BASELINE,
  WHOLE_LIST_PRIVACY_MOVE,
  claimedByBaseline,
  countNamedFavorites,
  parseBaseline,
  publishGate,
  publishPlan,
  reconcileInput,
  seedModeFromWire,
  wireContradictsMode,
  withdrawalPlan,
  type PrivacyBaseline,
} from './favorites-privacy';
import {
  EMPTY_PARSED,
  groupForSingleList,
  itemClaim,
  parseSingleList,
  LIST_ALT,
  VISIBILITY_TAG,
} from './favorites-single-list';
import { itemId, showId, type FavoriteEntry } from './pc20-identifiers';

const MUSIC_A = '9b024349-ccf0-5f69-a609-6b82873eab3c';
const MUSIC_B = '4a7c1e58-2d93-5f04-b6e1-8c5a90d3f2b7';
const FOREIGN = 'c31ad2f6-1b7e-5b34-a2a4-6b06d5b0b4e2';

const album = (guid: string, medium?: string): FavoriteEntry => ({ id: showId(guid), medium });
const track = (guid: string, parent: string, medium?: string): FavoriteEntry => ({
  id: itemId(guid),
  feedRef: showId(parent),
  medium,
});

/** A half holding the given feed guids, as if read off the wire. */
const halfWith = (...guids: string[]) =>
  parseSingleList([
    ['alt', LIST_ALT],
    ['medium', 'music'],
    ...guids.map((g) => ['i', showId(g)]),
  ]);

// The identifier an entry DECLARES: position 2 when there is one, position 1
// otherwise. An item entry names its FEED at position 1 now, so reading
// position 1 does not merely stop finding the item — it makes every NEGATIVE
// assertion below pass for the wrong reason.
const feedsOf = (tags: string[][]) =>
  tags.filter((t) => t[0] === 'i').map((t) => t[2] ?? t[1]);

/** A half holding one feed group with the given tracks under it. */
const halfWithTracks = (feedGuid: string, ...itemGuids: string[]) =>
  parseSingleList([
    ['alt', LIST_ALT],
    ['medium', 'music'],
    ['i', showId(feedGuid)],
    ...itemGuids.map((g) => ['i', itemId(g)]),
  ]);

/** A half holding items that NAME THEIR OWN FEED — the form every writer uses
 *  since #256, and the one `halfWithTracks` does not produce. */
const halfWithItems = (...pairs: [feedGuid: string, itemGuid: string][]) =>
  parseSingleList([
    ['alt', LIST_ALT],
    ['medium', 'music'],
    ...pairs.map(([feed, item]) => ['i', showId(feed), itemId(item)]),
  ]);

// ---------------------------------------------------------------------------
// Seeding — each half answers only for itself
// ---------------------------------------------------------------------------

test('a device seeds its mode from the wire, and asks when the wire is ambiguous', () => {
  assert.equal(seedModeFromWire(true, false), 'public');
  assert.equal(seedModeFromWire(false, true), 'private');

  // Both, or neither. Neither is a genuinely new account; both is an account
  // that has used the split. Guessing either way edits data nobody asked to
  // move, so the answer is a question.
  assert.equal(seedModeFromWire(true, true), null);
  assert.equal(seedModeFromWire(false, false), null);
});

test('testing the public half first would fail OPEN, which is why it does not', () => {
  // The disclosure bug, stated as a test so the shape cannot come back. A
  // private account has hasPublic=false, hasPrivate=true. An implementation
  // that checked `hasPublic ? 'public' : 'private'` returns 'public' here —
  // the device then paints the decrypted entries into its store and
  // republishes every one as a plaintext, relay-INDEXED `i` tag.
  assert.notEqual(seedModeFromWire(false, true), 'public');
  // And the mirror: private-first would move a genuinely public account into
  // `content`, an edit nobody asked for.
  assert.notEqual(seedModeFromWire(true, false), 'private');
});

// ---------------------------------------------------------------------------
// The baseline
// ---------------------------------------------------------------------------

test('a pre-halves baseline is read as the PUBLIC half, never as neither', () => {
  // Nothing could have written a private entry before the split existed, so
  // every claim on record is a tag claim. Reading it as `private` or dropping
  // it makes the first publish after upgrading treat this device's own public
  // entries as another app's and carry them forever.
  const old = JSON.stringify({ feeds: [MUSIC_A], items: ['t1'] });
  assert.deepEqual(parseBaseline(old), {
    public: { feeds: [MUSIC_A], items: ['t1'] },
    private: { feeds: [], items: [] },
  });
});

test('an unreadable baseline is empty, and an empty baseline removes nothing', () => {
  // The safe direction, and the same rule the single-record version had: a
  // device that has agreed to nothing may not delete anything.
  assert.deepEqual(parseBaseline('not json'), EMPTY_BASELINE);
  assert.deepEqual(parseBaseline(null), EMPTY_BASELINE);
  assert.deepEqual(parseBaseline('{"public":{"feeds":"nope"}}').public, { feeds: [], items: [] });

  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWith(FOREIGN),
    privateRead: EMPTY_PARSED,
    local: [],
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [showId(FOREIGN)], 'the foreign entry survives');
});

test('the two halves round-trip through parseBaseline', () => {
  const both: PrivacyBaseline = {
    public: { feeds: [MUSIC_A], items: [] },
    private: { feeds: [MUSIC_B], items: ['t9'] },
  };
  assert.deepEqual(parseBaseline(JSON.stringify(both)), both);
});

// ---------------------------------------------------------------------------
// Carrying the half we do not use
// ---------------------------------------------------------------------------

test('a public-mode device carries a foreign private half untouched', () => {
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWith(FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [showId(MUSIC_A)]);
  assert.deepEqual(feedsOf(plan.privateTags!), [showId(FOREIGN)], 'not ours, not touched');
});

test('a private-mode device takes the foreign public half WITH it', () => {
  // Flag-aware on purpose. This vector asserted the pre-spec rule — carry the
  // other half untouched — and that rule is what left a real account 97%
  // private. Written to hold under both settings so flipping the flag does not
  // "break" the suite and invite someone to weaken it.
  const plan = publishPlan({
    mode: 'private',
    publicRead: halfWith(FOREIGN),
    privateRead: EMPTY_PARSED,
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });

  if (WHOLE_LIST_PRIVACY_MOVE) {
    assert.deepEqual(feedsOf(plan.tags), [], 'the public half is emptied');
    assert.deepEqual(feedsOf(plan.privateTags!), [showId(MUSIC_A), showId(FOREIGN)]);
  } else {
    assert.deepEqual(feedsOf(plan.tags), [showId(FOREIGN)], 'stranded until the move ships');
    assert.deepEqual(feedsOf(plan.privateTags!), [showId(MUSIC_A)]);
  }
});

// ---------------------------------------------------------------------------
// Defect 3 — the baseline must not claim the half it does not feed.
// These need two cycles. That is the point.
// ---------------------------------------------------------------------------

test('cycle 2 does not delete the foreign half cycle 1 merely carried', () => {
  // THE FIFTEENTH DEFECT, and the one every other guard missed.
  //
  // Deriving BOTH halves' baselines from their merges is locally reasonable —
  // "this app renders the union, so it must claim what it renders". True of
  // the active half, whose merge really is backed by local state next cycle.
  // False of the other one: nothing feeds it, so the claim goes unbacked and
  // the removal test fires on the whole half at once.
  //
  // Cycle 1 emits correct bytes. Only the baseline beside them is wrong, which
  // is why a single-cycle assertion cannot see this.
  const local = groupForSingleList([album(MUSIC_A, 'music')]);

  const cycle1 = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWith(FOREIGN),
    local,
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(cycle1.privateTags!), [showId(FOREIGN)], 'cycle 1 carries it');
  assert.deepEqual(
    cycle1.baseline.private,
    { feeds: [], items: [] },
    'and claims NOTHING there — this is the assertion that matters'
  );

  const cycle2 = publishPlan({
    mode: 'public',
    publicRead: parseSingleList(cycle1.tags),
    privateRead: parseSingleList(cycle1.privateTags!),
    local,
    baseline: cycle1.baseline,
  });
  assert.deepEqual(
    feedsOf(cycle2.privateTags!),
    [showId(FOREIGN)],
    'cycle 2 still carries it — a derived claim would have deleted it here'
  );
});

test('a mode switch still removes what it moved, across two cycles', () => {
  // The control for the test above. Suppressing the claim entirely would be
  // one way to pass it, and it would break this: a switch has to take the
  // entry OUT of the half it left, or the favorite exists twice.
  const local = groupForSingleList([album(MUSIC_A, 'music')]);

  // Established public.
  const before = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: EMPTY_PARSED,
    local,
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(before.baseline.public.feeds, [MUSIC_A]);

  // The user switches to private. The public half is now inactive, and its
  // previous claims are what authorise the removal.
  const after = publishPlan({
    mode: 'private',
    publicRead: parseSingleList(before.tags),
    privateRead: EMPTY_PARSED,
    local,
    baseline: before.baseline,
  });
  assert.deepEqual(feedsOf(after.tags), [], 'gone from the public half');
  assert.deepEqual(feedsOf(after.privateTags!), [showId(MUSIC_A)], 'and arrived in the private one');
  assert.deepEqual(after.baseline.public, { feeds: [], items: [] }, 'no longer claimed there');
  assert.deepEqual(after.baseline.private.feeds, [MUSIC_A]);

  // Cycle 2 in the new mode is stable.
  const settled = publishPlan({
    mode: 'private',
    publicRead: parseSingleList(after.tags),
    privateRead: parseSingleList(after.privateTags!),
    local,
    baseline: after.baseline,
  });
  assert.deepEqual(feedsOf(settled.privateTags!), [showId(MUSIC_A)]);
  assert.deepEqual(feedsOf(settled.tags), []);
});

test('a switch moves ours and leaves the other writer alone in the same pass', () => {
  // Both rules at once, which is where an implementation with only one of them
  // looks correct on a single-entry fixture.
  const local = groupForSingleList([album(MUSIC_A, 'music')]);
  const baseline: PrivacyBaseline = {
    public: { feeds: [MUSIC_A], items: [] },
    private: { feeds: [], items: [] },
  };

  const plan = publishPlan({
    mode: 'private',
    publicRead: halfWith(MUSIC_A, FOREIGN),
    privateRead: EMPTY_PARSED,
    local,
    baseline,
  });

  // OURS moves because we claim it. THEIRS moves only once the whole-list rule
  // is on — and either way it is never dropped, which is the assertion that
  // matters in both branches.
  assert.deepEqual(feedsOf(plan.privateTags!)[0], showId(MUSIC_A), 'ours went private');
  const theirs = WHOLE_LIST_PRIVACY_MOVE ? plan.privateTags! : plan.tags;
  assert.equal(
    feedsOf(theirs).includes(showId(FOREIGN)),
    true,
    "the other app's entry is somewhere on the list, never dropped"
  );
});

// ---------------------------------------------------------------------------
// Defect 1 — idempotence is decided on the decrypted array
// ---------------------------------------------------------------------------

test('a second cycle with nothing changed produces identical tags on both halves', () => {
  // NIP-44 draws a fresh nonce, so the CIPHERTEXT differs on every pass and a
  // writer comparing it republishes forever — two apps rewriting the event
  // against each other, self-inflicted. `publishPlan` returns `privateTags`
  // rather than a ciphertext precisely so the caller digests this instead.
  const local = groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')]);
  const baseline: PrivacyBaseline = {
    public: { feeds: [], items: [] },
    private: { feeds: [MUSIC_A], items: ['t1'] },
  };
  const read = {
    publicRead: halfWith(FOREIGN),
    privateRead: parseSingleList([
      ['alt', LIST_ALT],
      ['medium', 'music'],
      ['i', showId(MUSIC_A)],
      ['i', itemId('t1')],
    ]),
  };

  const first = publishPlan({ mode: 'private', ...read, local, baseline });
  const second = publishPlan({
    mode: 'private',
    publicRead: parseSingleList(first.tags),
    privateRead: parseSingleList(first.privateTags!),
    local,
    baseline: first.baseline,
  });

  assert.deepEqual(second.tags, first.tags);
  assert.deepEqual(second.privateTags, first.privateTags);
});

// ---------------------------------------------------------------------------
// Defect 4 — the inactive half is carried, not painted into local state
// ---------------------------------------------------------------------------

test('the reconcile sees the active half whole and only our part of the other', () => {
  const baseline: PrivacyBaseline = {
    public: { feeds: [], items: [] },
    private: { feeds: [MUSIC_B], items: [] },
  };
  const input = reconcileInput({
    mode: 'public',
    publicRead: halfWith(MUSIC_A),
    privateRead: halfWith(MUSIC_B, FOREIGN),
    baseline,
  });
  const guids = input.groups.map((g) => g.feedGuid).sort();
  assert.deepEqual(
    guids,
    [MUSIC_A, MUSIC_B].sort(),
    'ours from both halves — MUSIC_B is mid-move and must not vanish from the page'
  );
  assert.equal(
    guids.includes(FOREIGN),
    false,
    "another writer's private entry is carried on the wire but never adopted"
  );
});

// ---------------------------------------------------------------------------
// `visibility` — the mode as a fact about the list rather than a guess from
// which half happens to hold entries. PC20-Nostr, "The list is public or
// private, and the event says which".
// ---------------------------------------------------------------------------

/** A half with a stated mode, as if read off the wire. */
const halfSaying = (visibility: 'public' | 'private', ...guids: string[]) =>
  parseSingleList([
    ['alt', LIST_ALT],
    [VISIBILITY_TAG, visibility],
    ['medium', 'music'],
    ...guids.map((g) => ['i', showId(g)]),
  ]);

const visibilityOf = (tags: string[][]) =>
  tags.find((t) => t[0] === VISIBILITY_TAG)?.[1] ?? null;

test('an EMPTY list still has a mode, and it comes from the tag', () => {
  // The gap emptiness cannot fill, and it is where every user starts. A device
  // reading this list sees nothing in either half; guessing `'public'` here
  // publishes the next favorite as a relay-indexed `i` tag on the account of
  // someone who chose Private in another app.
  const empty = parseSingleList([['alt', LIST_ALT], [VISIBILITY_TAG, 'private']]);
  assert.equal(empty.visibility, 'private');
  assert.equal(seedModeFromWire(false, false), null, 'emptiness has no answer of its own');

  const plan = publishPlan({
    mode: 'private',
    publicRead: empty,
    privateRead: EMPTY_PARSED,
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [], 'nothing may reach the plaintext tags');
  assert.deepEqual(feedsOf(plan.privateTags!), [showId(MUSIC_A)]);
  assert.equal(visibilityOf(plan.tags), 'private', 'and the list keeps saying what it is');
});

test('a stated mode outranks this app\'s standing preference', () => {
  // Two apps, one event, and nothing else on the wire naming the intended
  // half. Letting a stored setting win is how a list flips halves on a page
  // load — measured, on a list of 287 entries.
  const plan = publishPlan({
    mode: 'private',
    publicRead: halfSaying('public', MUSIC_A),
    privateRead: EMPTY_PARSED,
    local: groupForSingleList([album(MUSIC_B, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.equal(visibilityOf(plan.tags), 'public', 'the event still says what it said');
  assert.deepEqual(
    feedsOf(plan.tags).sort(),
    [showId(MUSIC_A), showId(MUSIC_B)].sort(),
    'and the entries stayed in the half it names'
  );
  assert.deepEqual(feedsOf(plan.privateTags!), []);

  // The same call with the user actually choosing. That IS the answer, so it
  // goes through and the whole list moves.
  const chosen = publishPlan({
    mode: 'private',
    publicRead: halfSaying('public', MUSIC_A),
    privateRead: EMPTY_PARSED,
    local: groupForSingleList([album(MUSIC_B, 'music')]),
    baseline: EMPTY_BASELINE,
    userChose: true,
  });
  assert.equal(visibilityOf(chosen.tags), 'private');
  assert.deepEqual(feedsOf(chosen.tags), [], 'the public half is emptied');
  assert.equal(
    feedsOf(chosen.privateTags!).includes(showId(MUSIC_A)),
    true,
    "the other app's entry moved too — the choice belongs to the LIST"
  );
});

test('a stated public mode converges a half-moved list, and no tag does not', () => {
  // A list whose tag and entries disagree is one somebody left half-converged.
  // Only a writer that could read both halves may have written that tag, so
  // finishing it is the user's stated intent rather than this app guessing.
  const converged = publishPlan({
    mode: 'public',
    publicRead: halfSaying('public', MUSIC_A),
    privateRead: halfWith(FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(
    feedsOf(converged.tags).sort(),
    [showId(MUSIC_A), showId(FOREIGN)].sort(),
    'the whole list ends up in the half the tag names'
  );
  assert.deepEqual(feedsOf(converged.privateTags!), [], 'and the other half is emptied');
  assert.equal(converged.inBothHalves, 0);
  assert.equal(converged.carriedInOtherHalf, 0);

  // THE CONTROL, and it is the half a naive implementation fails: the same
  // entries with NO tag must not move. There is no stated intent, so
  // private → public stays limited to what this device claims, and moving
  // FOREIGN would be a disclosure nobody asked for.
  const untagged = publishPlan({
    mode: 'public',
    publicRead: halfWith(MUSIC_A),
    privateRead: halfWith(FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.equal(
    feedsOf(untagged.tags).includes(showId(FOREIGN)),
    false,
    "without a stated mode another app's private entry stays private"
  );
  assert.deepEqual(feedsOf(untagged.privateTags!), [showId(FOREIGN)]);
});

test('a writer that cannot read the private half may not restate the mode', () => {
  // Declaring a list public while the entries in it stay encrypted publishes a
  // false claim about someone's privacy, and the next writer converges on the
  // strength of it. A signer with no NIP-44 is an ordinary state, not an error.
  const plan = publishPlan({
    mode: 'public',
    publicRead: halfSaying('private'),
    privateRead: halfWith(FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
    userChose: true,
    canReadPrivate: false,
  });
  assert.equal(visibilityOf(plan.tags), 'private', 'the mode we could not honour is carried');
  assert.equal(
    feedsOf(plan.tags).includes(showId(FOREIGN)),
    false,
    'and nothing we could not see was moved into the clear'
  );

  // The control, in the same fixture: a writer that CAN read it. Now the
  // change is honest, so it must go through — an implementation that never
  // restates the mode passes the assertions above for the wrong reason.
  const allowed = publishPlan({
    mode: 'public',
    publicRead: halfSaying('private'),
    privateRead: halfWith(FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
    userChose: true,
  });
  assert.equal(visibilityOf(allowed.tags), 'public');
  assert.equal(feedsOf(allowed.tags).includes(showId(FOREIGN)), true, 'the whole list moves');
});

test('a legacy list is not stamped with a mode nobody picked', () => {
  // The migration is deliberately not eager. A writer stamping its own
  // standing default on a list that never said anything would state a mode the
  // user never chose — and on a list that already has a private half, that
  // stamp is exactly what would license disclosing it.
  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWith(MUSIC_A),
    privateRead: EMPTY_PARSED,
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.equal(visibilityOf(plan.tags), null, 'silence is carried as silence');
});

test('the gate treats a stated disagreement as a conflict, emptiness or not', () => {
  // `seedModeFromWire` says nothing about a list whose halves BOTH hold
  // entries — correctly, since emptiness cannot answer there. A stated mode
  // can, so the conflict is reachable in a state the inference cannot see.
  assert.equal(wireContradictsMode('private', true, true), null, 'inference has no answer');
  assert.equal(
    wireContradictsMode('private', true, true, 'public'),
    'wire-public',
    'the tag does'
  );
  assert.equal(wireContradictsMode('public', true, true, 'public'), null, 'agreement is not one');
});

// ---------------------------------------------------------------------------
// The mode is per-app; the event is shared. Nothing on the wire says which half
// the list intends to be, so every answer here is inference from emptiness.
// ---------------------------------------------------------------------------

const gate = (over: Partial<Parameters<typeof publishGate>[0]> = {}) =>
  publishGate({
    stored: 'private',
    privateHalfUsable: true,
    hasPublic: true,
    hasPrivate: false,
    intent: 'auto',
    ...over,
  });

test('a stored mode the wire wholesale contradicts holds the automatic publish', () => {
  // The live account. This app on Private, the list made entirely public from
  // the other one — and the next page load would have moved all of it back.
  assert.deepEqual(gate(), { publish: false, conflict: 'wire-public' });

  // And the mirror, which is the direction that discloses.
  assert.deepEqual(gate({ stored: 'public', hasPublic: false, hasPrivate: true }), {
    publish: false,
    conflict: 'wire-private',
  });
});

test('an ambiguous wire is NOT a conflict', () => {
  // Both halves populated is the both-halves state, and it belongs to the
  // counts. Calling it a conflict would hold every publish on the very account
  // this whole change exists for — 284 in the tags and 287 encrypted.
  assert.deepEqual(gate({ hasPublic: true, hasPrivate: true }), {
    publish: true,
    conflict: null,
  });
  // Neither half has anything: there is nothing to rewrite.
  assert.deepEqual(gate({ hasPublic: false, hasPrivate: false }), {
    publish: true,
    conflict: null,
  });
});

test('an unreadable private half never produces a conflict', () => {
  // `unreadable`, `unsupported` and `none` all present as an empty private
  // half. A verdict computed from one would tell a private-mode user their
  // list is entirely public when it is not — and the buttons under that
  // sentence would then do real damage. No publish either way, no claim.
  assert.deepEqual(gate({ privateHalfUsable: false }), { publish: false, conflict: null });
});

test('a device that has never been asked is not in conflict', () => {
  // Seeding owns that case, and pre-empting it would put a question about two
  // apps disagreeing in front of a user who has not answered the first one.
  assert.deepEqual(gate({ stored: null }), { publish: true, conflict: null });
  assert.deepEqual(gate({ stored: 'off' }), { publish: true, conflict: null });
});

test('an explicit answer publishes over the conflict, and still reports it', () => {
  // Pressing Public or Private IS the answer. The conflict stays in the return
  // because the screen wants the numbers either way — it is reported, not
  // blocking.
  assert.deepEqual(gate({ intent: 'resolve' }), { publish: true, conflict: 'wire-public' });
});

test('the verdict names which half the list is actually in', () => {
  assert.equal(wireContradictsMode('private', true, false), 'wire-public');
  assert.equal(wireContradictsMode('public', false, true), 'wire-private');
  assert.equal(wireContradictsMode('public', true, false), null, 'agreement is not a conflict');
  assert.equal(wireContradictsMode('private', false, true), null);
});

// ---------------------------------------------------------------------------
// Defect 4, from the side `claimedByBaseline` cannot reach: an entry ALREADY
// in local state because the database that holds it is add-only.
// ---------------------------------------------------------------------------

test('a feed in BOTH halves is still ours to publish', () => {
  // The exception that makes the rest safe. Dropping this one would take it
  // out of the baseline too, un-claiming an entry we DO publish — and an
  // unclaimed entry is foreign, and a foreign entry is carried forever.
  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWith(MUSIC_A),
    privateRead: halfWith(MUSIC_A),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [showId(MUSIC_A)], 'present in the active half wins');
  assert.deepEqual(plan.baseline.public.feeds, [MUSIC_A], 'and it stays claimed');
});

test('a claimed private entry still MOVES when the mode goes public', () => {
  // The filter must not freeze a mode switch. Anything this device claims on
  // the inactive half is removed by that half's own merge, so it is not
  // carried, so it is not filtered — which is the whole reason the filter is
  // derived from the merged half rather than the raw read.
  const baseline: PrivacyBaseline = {
    public: { feeds: [], items: [] },
    private: { feeds: [MUSIC_B], items: [] },
  };
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWith(MUSIC_B, FOREIGN),
    local: groupForSingleList([album(MUSIC_B, 'music')]),
    baseline,
  });
  assert.deepEqual(feedsOf(plan.tags), [showId(MUSIC_B)], 'ours crosses over');
  assert.deepEqual(feedsOf(plan.privateTags!), [showId(FOREIGN)], "theirs does not");
  assert.deepEqual(plan.baseline.public.feeds, [MUSIC_B]);
});

test('a carried TRACK is left behind while its claimed sibling moves', () => {
  // A group can be part ours and part theirs. Dropping the whole group would
  // take the claimed track with it; keeping the whole group discloses the
  // other one. Both tracks sit under one feed, which is the only shape where
  // that distinction is visible.
  const OURS = 'a1b2c3d4-0000-4000-8000-000000000001';
  const THEIRS = 'a1b2c3d4-0000-4000-8000-000000000002';
  const baseline: PrivacyBaseline = {
    public: { feeds: [], items: [] },
    private: { feeds: [], items: [OURS] },
  };
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWithTracks(MUSIC_A, OURS, THEIRS),
    local: groupForSingleList([track(OURS, MUSIC_A, 'music'), track(THEIRS, MUSIC_A, 'music')]),
    baseline,
  });
  const publicIds = feedsOf(plan.tags);
  assert.equal(publicIds.includes(itemId(OURS)), true, 'the claimed track moves');
  assert.equal(publicIds.includes(itemId(THEIRS)), false, "the other writer's does not");
  assert.equal(
    feedsOf(plan.privateTags!).includes(itemId(THEIRS)),
    true,
    'and it stays where its writer put it'
  );
  // The claim is the PAIR now — an item guid is unique only inside its feed.
  assert.deepEqual(
    plan.baseline.public.items,
    [itemClaim(OURS, MUSIC_A)],
    'we claim only what we published'
  );
});

test('an adopted foreign private entry is NOT republished as a public tag', () => {
  // Why the filter above is a disclosure rule and not tidiness, and why one
  // filter is not enough. Local state is written through and read back as
  // `local`, which goes wholly into the ACTIVE half — so an adopted private
  // entry comes back out as a plaintext `i` tag, and `i` is indexed by relays.
  //
  // `reconcileInput` stops the adoption. It cannot stop an entry that is
  // ALREADY adopted: this app's inbound reconcile is add-only, so anything
  // taken in while the mode was `'private'` outlives the switch to `'public'`
  // and arrives here anyway. `withoutCarried` is the second line, and this test
  // used to assert the disclosure as an outcome the first line merely avoided.
  const adopted = groupForSingleList([album(FOREIGN, 'music')]);
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWith(FOREIGN),
    local: adopted,
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [], 'nothing of another writer\'s reaches the tags');
  assert.deepEqual(
    feedsOf(plan.privateTags!),
    [showId(FOREIGN)],
    'it stays where its writer put it'
  );
  assert.deepEqual(
    plan.baseline.public.feeds,
    [],
    'and we do not claim an entry we did not publish'
  );
});

// ---------------------------------------------------------------------------
// The same guard, for an item that names its own feed
// ---------------------------------------------------------------------------
//
// The test above is a FEED. An item in the three-element form is a node of its
// own rather than a member of a group, and the guard counted only groups — so
// from #256 on, it stopped every adopted feed and no adopted item. Every item
// this app writes and every one Boost Me Bitch writes is in this form.

const PRIVATE_TRACK = 'e1f2a3b4-0000-4000-8000-000000000011';
const SHARED_TRACK = 'e1f2a3b4-0000-4000-8000-000000000012';

test('an adopted foreign private ITEM is NOT republished as a public tag', () => {
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWithItems([FOREIGN, PRIVATE_TRACK]),
    local: groupForSingleList([track(PRIVATE_TRACK, FOREIGN, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [], 'the encrypted item is not a plaintext tag');
  assert.deepEqual(
    feedsOf(plan.privateTags!),
    [itemId(PRIVATE_TRACK)],
    'it stays where its writer put it'
  );
  assert.deepEqual(plan.baseline.public.items, [], 'and we claim nothing we did not publish');
  assert.equal(plan.carriedInOtherHalf, 1, 'and it is counted as carried, not missed');
});

test('an adopted private item is held back even under a different feed row here', () => {
  // WHY THE GUARD MATCHES THE BARE GUID. The reconcile finds a track by its
  // guid alone, so the row it adopts sits under whichever feed the DATABASE
  // says — which need not be the feed the wire names. A guard keyed on the pair
  // matches nothing then, and fails open.
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWithItems([FOREIGN, PRIVATE_TRACK]),
    local: groupForSingleList([track(PRIVATE_TRACK, MUSIC_B, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), []);
});

test('a mode switch still moves our own items that name their feed, across two cycles', () => {
  // The control. Holding back everything in the other half would pass the two
  // tests above and strand the user's own list on a switch: what this device
  // CLAIMS there is removed by that half's merge first, so it is not carried
  // and must still move.
  const local = groupForSingleList([track(PRIVATE_TRACK, MUSIC_A, 'music')]);

  const before = publishPlan({
    mode: 'private',
    publicRead: EMPTY_PARSED,
    privateRead: EMPTY_PARSED,
    local,
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(before.privateTags!), [itemId(PRIVATE_TRACK)]);
  assert.deepEqual(before.baseline.private.items, [itemClaim(PRIVATE_TRACK, MUSIC_A)]);

  const after = publishPlan({
    mode: 'public',
    publicRead: parseSingleList(before.tags),
    privateRead: parseSingleList(before.privateTags!),
    local,
    baseline: before.baseline,
  });
  assert.deepEqual(feedsOf(after.tags), [itemId(PRIVATE_TRACK)], 'arrived in the public half');
  assert.deepEqual(feedsOf(after.privateTags!), [], 'and left the private one');
  assert.deepEqual(after.baseline.public.items, [itemClaim(PRIVATE_TRACK, MUSIC_A)]);
  assert.deepEqual(after.baseline.private, { feeds: [], items: [] });

  const settled = publishPlan({
    mode: 'public',
    publicRead: parseSingleList(after.tags),
    privateRead: parseSingleList(after.privateTags!),
    local,
    baseline: after.baseline,
  });
  assert.deepEqual(settled.tags, after.tags, 'cycle 2 in the new mode is stable');
  assert.deepEqual(settled.privateTags, after.privateTags);
});

test('items that name their feed are counted, and one in both halves is reported', () => {
  // Present in the active half wins, so the shared item stays public — and is
  // then in BOTH halves, which is the number the notice exists to show. Before
  // the guard saw these items, both counts below read 0.
  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWithItems([MUSIC_A, SHARED_TRACK]),
    privateRead: halfWithItems([MUSIC_A, SHARED_TRACK], [FOREIGN, PRIVATE_TRACK]),
    local: groupForSingleList([track(SHARED_TRACK, MUSIC_A, 'music')]),
    baseline: { ...EMPTY_BASELINE, public: { feeds: [], items: [itemClaim(SHARED_TRACK, MUSIC_A)] } },
  });
  assert.deepEqual(feedsOf(plan.tags), [itemId(SHARED_TRACK)], 'present in the active half wins');
  assert.equal(plan.inBothHalves, 1, 'SHARED_TRACK is public and encrypted at once');
  assert.equal(plan.carriedInOtherHalf, 1, 'PRIVATE_TRACK is encrypted only');
  assert.equal(
    countNamedFavorites(halfWithItems([MUSIC_A, SHARED_TRACK], [FOREIGN, PRIVATE_TRACK])),
    2,
    'the sentence on screen counts them too'
  );
});

test('claimedByBaseline keeps our items and drops the rest of the group', () => {
  const groups = parseSingleList([
    ['alt', LIST_ALT],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('mine')],
    ['i', itemId('theirs')],
  ]).groups;

  const kept = claimedByBaseline(groups, { feeds: [], items: ['mine'] });
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].itemGuids, ['mine']);
  assert.equal(kept[0].favorited, false, 'the feed itself was never ours to claim');

  assert.deepEqual(claimedByBaseline(groups, { feeds: [], items: [] }), [], 'claim nothing, keep nothing');
});

// ---------------------------------------------------------------------------
// Withdrawal
// ---------------------------------------------------------------------------

test('leaving Nostr removes what this device claims and nothing else', () => {
  const plan = withdrawalPlan({
    publicRead: halfWith(MUSIC_A, FOREIGN),
    privateRead: halfWith(MUSIC_B),
    baseline: {
      public: { feeds: [MUSIC_A], items: [] },
      private: { feeds: [MUSIC_B], items: [] },
    },
  });
  assert.deepEqual(feedsOf(plan.tags), [showId(FOREIGN)], "the other app's entry stays");
  assert.deepEqual(feedsOf(plan.privateTags!), []);
  assert.deepEqual(
    plan.baseline,
    EMPTY_BASELINE,
    'and afterwards this device claims nothing, so re-opting-in starts clean'
  );
});

test('a withdrawal on a device that claims nothing deletes nothing', () => {
  // The fresh-install case. Signing in on a new device and immediately opting
  // out must not take down a list that device never contributed to.
  const plan = withdrawalPlan({
    publicRead: halfWith(MUSIC_A, FOREIGN),
    privateRead: halfWith(MUSIC_B),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(feedsOf(plan.tags), [showId(MUSIC_A), showId(FOREIGN)]);
  assert.deepEqual(feedsOf(plan.privateTags!), [showId(MUSIC_B)]);
});

// ---------------------------------------------------------------------------
// Going private takes the whole list — spec test vector 13
// ---------------------------------------------------------------------------

test('a switch to private reports what it could NOT move', () => {
  // The measured failure, as a number the UI can show. A real account went
  // private and 13 of 449 entries stayed in the tags because a second app had
  // written them — public, relay-indexed, and nothing on screen said which.
  // While the move is gated, the count is the honest substitute for it.
  const plan = publishPlan({
    mode: 'private',
    publicRead: halfWith(FOREIGN),
    privateRead: EMPTY_PARSED,
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });

  if (WHOLE_LIST_PRIVACY_MOVE) {
    assert.equal(plan.carriedInOtherHalf, 0, 'nothing is left behind once the move is on');
    assert.equal(plan.inBothHalves, 0, 'and the fold leaves nothing in both');
    assert.deepEqual(feedsOf(plan.tags), [], 'the public half is emptied');
    assert.equal(
      feedsOf(plan.privateTags!).includes(showId(FOREIGN)),
      true,
      "the other app's entry moved too"
    );
  } else {
    assert.equal(plan.carriedInOtherHalf, 1);
    assert.deepEqual(feedsOf(plan.tags), [showId(FOREIGN)]);
  }
});

test('the counts partition the other half — carried and in-both never overlap', () => {
  // 284 in both and 3 encrypted-only was the measured account. Reporting 287
  // as "still encrypted" is false in the direction that matters, and reporting
  // 284 twice is worse. One number cannot say both things, which is why there
  // are two.
  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWith(MUSIC_A),
    privateRead: halfWith(MUSIC_A, FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.equal(plan.inBothHalves, 1, 'MUSIC_A is public and encrypted at once');
  assert.equal(plan.carriedInOtherHalf, 1, 'FOREIGN is encrypted only — counted once, not twice');
});

test('going private with the whole-list move reports nothing on either count', () => {
  // There is nothing to report: the public half is emptied and both halves are
  // folded into one. A non-zero number here would be a false alarm about a
  // state the publish has just removed.
  if (!WHOLE_LIST_PRIVACY_MOVE) return;
  const plan = publishPlan({
    mode: 'private',
    publicRead: halfWith(FOREIGN),
    privateRead: halfWith(MUSIC_A),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(plan.tags.filter((t) => t[0] === 'i'), []);
  assert.equal(plan.carriedInOtherHalf, 0);
  assert.equal(plan.inBothHalves, 0);
});

test('a placement group is not a favorite, and is not counted as one', () => {
  // A group with items exists to say which feed a track came from — the format
  // has no other way. Counting its feed identifier would report a feed sitting
  // in "both halves" whenever one half favorites it and the other merely places
  // a track under it, which is not the defect this number is for.
  const TRACK = 'b7c8d9e0-0000-4000-8000-000000000003';
  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWithTracks(MUSIC_A, TRACK),
    privateRead: halfWith(MUSIC_A),
    local: groupForSingleList([track(TRACK, MUSIC_A, 'music')]),
    baseline: { public: { feeds: [], items: [TRACK] }, private: { feeds: [], items: [] } },
  });
  assert.equal(plan.inBothHalves, 0, 'a placement above a track is not the same claim');
  assert.equal(plan.carriedInOtherHalf, 1, 'the encrypted feed favorite is still carried');
});

test('going public moves nothing of another app\'s, and says how much it carries', () => {
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWith(FOREIGN),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  assert.equal(plan.carriedInOtherHalf, 1, "the other app's private entry is carried, not moved");
  assert.equal(plan.inBothHalves, 0);
  // And the foreign PRIVATE entry stays private. This is the direction that
  // must never move: publishing it as a tag is a disclosure, relays index `i`,
  // and it cannot be taken back.
  assert.deepEqual(feedsOf(plan.privateTags!), [showId(FOREIGN)]);
  assert.equal(feedsOf(plan.tags).includes(showId(FOREIGN)), false);
});

test('a moved foreign entry is NOT claimed, so cycle 2 does not delete it', () => {
  // Defect 3 arriving by a different road. Claiming what we moved would look
  // reasonable — we did put it there — but nothing local backs the claim, so
  // the removal test fires on it next cycle. Two cycles to see it, as ever.
  const local = groupForSingleList([album(MUSIC_A, 'music')]);

  const cycle1 = publishPlan({
    mode: 'private',
    publicRead: halfWith(FOREIGN),
    privateRead: EMPTY_PARSED,
    local,
    baseline: EMPTY_BASELINE,
  });
  assert.deepEqual(
    cycle1.baseline.private.feeds,
    [MUSIC_A],
    'we claim OUR entry and nothing else, however the move went'
  );

  const cycle2 = publishPlan({
    mode: 'private',
    publicRead: parseSingleList(cycle1.tags),
    privateRead: parseSingleList(cycle1.privateTags!),
    local,
    baseline: cycle1.baseline,
  });
  const stillThere =
    feedsOf(cycle2.privateTags!).includes(showId(FOREIGN)) ||
    feedsOf(cycle2.tags).includes(showId(FOREIGN));
  assert.equal(stillThere, true, "the other app's entry survives a second cycle");
});

test('the whole-list move is one direction only, whatever the flag says', () => {
  // The asymmetry IS the rule, so it is asserted rather than left to the flag.
  // public→private reduces exposure and is reversible by anything that can
  // decrypt. private→public publishes an `i` tag relays index and cannot be
  // taken back, so it is limited to what this device claims — always.
  //
  // MUSIC_B is ours and still held locally, so switching to public brings it
  // back to the tags. FOREIGN is another app's, and nothing brings it there.
  const plan = publishPlan({
    mode: 'public',
    publicRead: EMPTY_PARSED,
    privateRead: halfWith(FOREIGN, MUSIC_B),
    local: groupForSingleList([album(MUSIC_B, 'music')]),
    baseline: { public: { feeds: [], items: [] }, private: { feeds: [MUSIC_B], items: [] } },
  });

  assert.deepEqual(feedsOf(plan.tags), [showId(MUSIC_B)], 'ours moved back to the tags');
  assert.deepEqual(
    feedsOf(plan.privateTags!),
    [showId(FOREIGN)],
    "another app's private entry is NEVER disclosed by our switch to public"
  );
});

// ---------------------------------------------------------------------------
// A list already in BOTH halves — spec test vector 15
// ---------------------------------------------------------------------------

test('a feed in BOTH halves moves as one group, not two', () => {
  // The state, and it is not hypothetical: 284 favorites in the public tags,
  // 287 in the encrypted half, all 284 in both, on a real account whose mode
  // read Public. Nothing in the format forbids it, and a switch that publishes
  // into one half while its removal from the other is baseline-gated lands
  // there by itself.
  //
  // Concatenating the halves on the way into private then emits MUSIC_A twice:
  // two groups for one feed, double-counted by every reader, with its items
  // given two parents to sit under. Only this state reaches it, which is why
  // every vector above passes over it.
  const plan = publishPlan({
    mode: 'private',
    publicRead: halfWith(MUSIC_A, MUSIC_B),
    privateRead: halfWith(MUSIC_A),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });

  if (!WHOLE_LIST_PRIVACY_MOVE) return; // nothing moves, nothing to duplicate

  const moved = feedsOf(plan.privateTags!);
  assert.equal(
    moved.filter((id) => id === showId(MUSIC_A)).length,
    1,
    'the feed that was in both halves was emitted twice'
  );
  assert.equal(
    moved.includes(showId(MUSIC_B)),
    true,
    'the public-only feed did not move'
  );
  assert.deepEqual(feedsOf(plan.tags), [], 'the public half is emptied');
});

test('an item under a duplicated group survives the fold', () => {
  // Folding rather than dropping. The incoming group may carry items the one
  // already here does not, and this is a MOVE — an item under a duplicate
  // group is as much the user's as the group itself.
  const withTrack = parseSingleList([
    ['alt', LIST_ALT],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId(FOREIGN)],
  ]);
  const plan = publishPlan({
    mode: 'private',
    publicRead: withTrack,
    privateRead: halfWith(MUSIC_A),
    local: groupForSingleList([album(MUSIC_A, 'music')]),
    baseline: EMPTY_BASELINE,
  });
  if (!WHOLE_LIST_PRIVACY_MOVE) return;

  // Counted on FEED ENTRIES — two elements. An item entry now carries the same
  // string at position 1, so counting position 1 counts the tracks too and this
  // assertion would fail on a correct fold.
  const ids = plan
    .privateTags!.filter((t) => t[0] === 'i' && t.length === 2)
    .map((t) => t[1]);
  assert.equal(
    ids.filter((id) => id === showId(MUSIC_A)).length,
    1,
    'the duplicated group was emitted twice'
  );
  // The item is a three-element entry now, so it is not in `ids` (feed entries
  // only). Ask for it by its own identifier at position 2.
  assert.equal(
    plan.privateTags!.some((t) => t[0] === 'i' && t[2] === itemId(FOREIGN)),
    true,
    'the item was dropped with its duplicate group'
  );
});

// ---------------------------------------------------------------------------
// An unreadable private half, and a PUBLIC writer. Spec vectors 12 and 23.
// ---------------------------------------------------------------------------

test('a public writer publishes over a private half it cannot open, and carries it', () => {
  // NIP-55 has no NIP-44. Refusing every publish here stranded each favorite
  // such a user made in this app the moment any other app put anything in
  // `content`. Rule 4's `content` clause: put the bytes back, write the half
  // you can.
  const gate = publishGate({
    stored: 'public',
    privateHalfUsable: false,
    hasPublic: true,
    hasPrivate: false,
    intent: 'auto',
    stated: null,
  });
  assert.deepEqual(gate, { publish: true, conflict: null });

  const plan = publishPlan({
    mode: 'public',
    publicRead: halfWith(MUSIC_A),
    privateRead: EMPTY_PARSED,
    local: [
      { feedGuid: MUSIC_A, medium: 'music', itemGuids: [], favorited: true },
      { feedGuid: MUSIC_B, medium: 'music', itemGuids: [], favorited: true },
    ],
    baseline: { public: { feeds: [MUSIC_A], items: [] }, private: { feeds: [FOREIGN], items: [] } },
    canReadPrivate: false,
  });
  assert.equal(plan.privateTags, null, 'null is what makes buildContent put the ciphertext back');
  assert.deepEqual(feedsOf(plan.tags), [showId(MUSIC_A), showId(MUSIC_B)]);
  assert.deepEqual(
    plan.baseline.private,
    { feeds: [FOREIGN], items: [] },
    'claims on a half we could not merge are carried, never recomputed from nothing'
  );
  assert.equal(visibilityOf(plan.tags), null, 'and no mode is stated over a half we could not read');
});

test('...but not INTO it, and not on a list that says private', () => {
  assert.equal(
    publishGate({
      stored: 'private',
      privateHalfUsable: false,
      hasPublic: false,
      hasPrivate: false,
      intent: 'resolve',
      stated: null,
    }).publish,
    false,
    'a private-mode publish would have to write the half it cannot read'
  );
  assert.equal(
    publishGate({
      stored: 'public',
      privateHalfUsable: false,
      hasPublic: true,
      hasPrivate: false,
      intent: 'auto',
      stated: 'private',
    }).publish,
    false,
    'the list says private, so the mode is private whatever this device stored'
  );
});
