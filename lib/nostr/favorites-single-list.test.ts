/**
 * npx tsx --test lib/nostr/favorites-single-list.test.ts
 *
 * Pins the kind:10333 single-list format (PC20-Nostr,
 * `pc20-favorites.md`) — Podcasting 2.0 data shared over Nostr.
 *
 * Why this earns a test file: in this format an entry's parent feed and its
 * medium are both carried by tag ORDER, not by the tag itself. A reordering
 * that would be cosmetic in any other event re-parents tracks and re-labels
 * media here, and it does so silently — the event stays well-formed, every
 * identifier is still present, and only the meaning changes. So the assertions
 * below are about sequence at least as much as about content.
 *
 * The spec lists test vectors as an open question; these are a first set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_ALT,
  SINGLE_LIST_KIND,
  buildSingleListTags,
  groupForSingleList,
  mergeSingleList,
  parseSingleList,
  partitionSingleList,
  publishedRecordFrom,
  singleListDigest,
  suppressOwnRemovals,
  tagsFromGroups,
  tagsFromNodes,
  singleListTemplate,
  templateFromTags,
  encodePrivateFavorites,
  decodePrivateFavorites,
  plaintextBytes,
  PRIVATE_PLAINTEXT_MAX,
} from './favorites-single-list';
import { itemId, showId, type FavoriteEntry } from './pc20-identifiers';

// Real-shaped guids. MUSIC_A and POD_B are favorited feeds; MUSIC_C is not —
// it appears only because a track of its was favorited. NO_MEDIUM_D is a feed
// that never declared <podcast:medium>.
const MUSIC_A = '9b024349-ccf0-5f69-a609-6b82873eab3c';
const POD_B = 'c31ad2f6-1b7e-5b34-a2a4-6b06d5b0b4e2';
const MUSIC_C = '4a7c1e58-2d93-5f04-b6e1-8c5a90d3f2b7';
const NO_MEDIUM_D = '791338e2-77bc-579e-8c7c-4c996cf73305';

const album = (guid: string, medium?: string): FavoriteEntry => ({ id: showId(guid), medium });
const track = (guid: string, parent: string, medium?: string): FavoriteEntry => ({
  id: itemId(guid),
  feedRef: showId(parent),
  medium,
});

/** Tags as `"type:value"` strings — the readable form for sequence assertions. */
const seq = (tags: string[][]) => tags.map((t) => `${t[0]}:${t[1]}`);

test('the event is a plain replaceable kind with an alt tag and empty content', () => {
  const template = singleListTemplate([album(MUSIC_A, 'music')], 1_700_000_000);
  assert.equal(template.kind, SINGLE_LIST_KIND);
  assert.equal(template.kind, 10333);
  assert.equal(template.content, '');
  // No `d` tag: kind 10333 is plainly replaceable, one per pubkey.
  assert.equal(
    template.tags.some((t) => t[0] === 'd'),
    false
  );
  assert.deepEqual(template.tags[0], ['alt', LIST_ALT]);
});

/**
 * An opaque `content` this app did not write. Base64, because that is what a
 * NIP-44 payload looks like, but the point is that its meaning is none of our
 * business — only its bytes are.
 */
const FOREIGN_CONTENT =
  'AkQBc1lPZ0hlYVh1WkJqc0hRZmpOUFlZQXpQMkVmVkxRPT0/dGhpcw==';

test('`content` written by another app survives this app\'s republish', () => {
  // THE CARRY RULE FOR `content`, AND THE SPEC DOES NOT STATE IT.
  //
  // Rule 4 — carry what you can't read — is written about TAGS. So a writer
  // following the document to the letter republishes the empty string the
  // format has specified from the start, and erases whatever another app put
  // in `content`: silently, on someone else's device, with no undo, while
  // behaving correctly by the document it was written against. kind:10333 is
  // replaceable and keeps no history, so there is nothing to recover from.
  //
  // This app does not use `content` and does not need to. It only has to put
  // back what it found.
  const read = {
    ...parseSingleList([
      ['alt', LIST_ALT],
      ['medium', 'music'],
      ['i', showId(MUSIC_A)],
      ['k', 'podcast:guid'],
    ]),
    updatedAt: 1_700_000_000,
    exists: true,
    trustworthy: true,
    content: FOREIGN_CONTENT,
  };

  const merged = mergeSingleList(read, groupForSingleList([album(MUSIC_A, 'music')]));
  const tags = tagsFromNodes(merged.nodes, merged.foreignTags, merged.foreignKinds);
  const template = templateFromTags(tags, 1_700_000_100, read.content);

  assert.equal(template.content, FOREIGN_CONTENT);
});

test('carrying `content` is idempotent — a second republish does not touch it', () => {
  // A carry that mutates on each pass is not a carry. If this ever drifts, two
  // apps rewrite the event at each other forever and the only symptom is that
  // it never stops.
  const first = templateFromTags([['alt', LIST_ALT]], 1_700_000_100, FOREIGN_CONTENT);
  const second = templateFromTags([['alt', LIST_ALT]], 1_700_000_200, first.content);
  assert.equal(second.content, FOREIGN_CONTENT);
});

test('an empty `content` is only ever what the read actually held', () => {
  // The inverse, and the reason `templateFromTags` takes no default. A list
  // built from scratch has nothing to carry and is legitimately empty; a
  // republish is empty only because the event we read was.
  assert.equal(singleListTemplate([album(MUSIC_A, 'music')], 1_700_000_000).content, '');
  assert.equal(templateFromTags([['alt', LIST_ALT]], 1_700_000_000, '').content, '');
});

// ---------------------------------------------------------------------------
// The private half's plaintext — the interop contract with Boost Me Bitch
// ---------------------------------------------------------------------------

test('the private half round-trips through encode and decode unchanged', () => {
  // A tag array, the same shape as `event.tags`, so the grouping rules apply
  // inside it unchanged and one parser reads both halves.
  const tags = [
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['k', 'podcast:guid'],
  ];
  assert.deepEqual(decodePrivateFavorites(encodePrivateFavorites(tags)), tags);
});

test('a `?` in a guid survives, written as its JSON escape', () => {
  // Amber (NIP-55) URL-decodes the WHOLE nostrsigner: URI and only then splits
  // it on `?`, so a plaintext carrying one is silently truncated and comes back
  // "malformed nostrsigner request". Item guids are routinely permalink URLs,
  // so one favorited track with a query string would break every private
  // publish on Android, forever, with a message reading "Amber isn't
  // installed". This app's Amber path is NIP-46 and unaffected — BMB reads what
  // we write and may not be.
  const withQuery = itemId('https://example.com/ep?id=42&utm=x');
  const encoded = encodePrivateFavorites([['i', withQuery]]);

  assert.equal(encoded.includes('?'), false, 'no raw ? survives the encoding');
  assert.equal(encoded.includes('\\u003f'), true, 'it is written as the JSON escape');
  // And every JSON reader gives back the identical string, which is the whole
  // reason the escape is `?` and not an app-specific wrapper.
  assert.deepEqual(decodePrivateFavorites(encoded), [['i', withQuery]]);
});

test('valid JSON that is not a tag array decodes to null, not to empty', () => {
  // THE DISTINCTION THAT PREVENTS A WIPE. A `JSON.parse` that succeeds on a
  // non-array leaves the blob marked readable and EMPTY, and the next republish
  // rewrites `content` from those empty lists and destroys it. "I read it and
  // it was empty" and "I could not read it" have to be different answers, and
  // only the first may ever be published from.
  assert.equal(decodePrivateFavorites('42'), null);
  assert.equal(decodePrivateFavorites('"a string"'), null);
  assert.equal(decodePrivateFavorites('{"tags":[]}'), null);
  assert.equal(decodePrivateFavorites('null'), null);
  assert.equal(decodePrivateFavorites('[["i","x"],"not-a-tag"]'), null);
  assert.equal(decodePrivateFavorites('[["i",42]]'), null, 'tag elements must be strings');
  assert.equal(decodePrivateFavorites('not json at all'), null);

  // The one thing that IS a legitimately empty private half.
  assert.deepEqual(decodePrivateFavorites('[]'), []);
});

test('the plaintext cap sits under the NIP-44 v2 interop cliff at 64 KB', () => {
  // NIP-44 v2 as first published capped plaintext at 65535 bytes; the current
  // text allows more and changes the length prefix at 65536. A library built to
  // the older text REJECTS a payload across that line, and a private list that
  // cannot be decrypted is indistinguishable from an empty one.
  assert.ok(PRIVATE_PLAINTEXT_MAX < 65_535, 'must stay under the older cap');

  // Counted in UTF-8 bytes, which is what the limit counts — not in JS string
  // length, which would undercount every non-ASCII title by up to 3×.
  assert.equal(plaintextBytes('abc'), 3);
  assert.equal(plaintextBytes('é'), 2);
  assert.equal(plaintextBytes('🎵'), 4);
});

test('an album with no favorited tracks emits a feed group and nothing else', () => {
  assert.deepEqual(seq(buildSingleListTags([album(MUSIC_A, 'music')])), [
    `alt:${LIST_ALT}`,
    'medium:music',
    `i:podcast:guid:${MUSIC_A}`,
    'k:podcast:guid',
  ]);
});

test("a track's entry follows its parent feed's entry", () => {
  assert.deepEqual(
    seq(buildSingleListTags([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')])),
    [
      `alt:${LIST_ALT}`,
      'medium:music',
      `i:podcast:guid:${MUSIC_A}`,
      'i:podcast:item:guid:t1',
      'k:podcast:guid',
      'k:podcast:item:guid',
    ]
  );
});

test('k tags are one per distinct KIND, trailing — not one per entry', () => {
  // The spec pairs a `k` with every `i`. That restates position 1, which
  // already carries the kind as its prefix: on the first real event it cost
  // 423 tags holding two distinct values, ~11 KB of 36 KB. A reader must take
  // an entry's kind from the identifier, not from an adjacent tag.
  const tags = buildSingleListTags([
    album(MUSIC_A, 'music'),
    track('t1', MUSIC_A, 'music'),
    track('t2', MUSIC_A, 'music'),
    album(POD_B, 'podcast'),
  ]);
  assert.equal(tags.filter((t) => t[0] === 'i').length, 4);
  assert.deepEqual(
    tags.filter((t) => t[0] === 'k').map((t) => t[1]),
    ['podcast:guid', 'podcast:item:guid']
  );
  // Trailing, so they cannot disturb grouping — only `i` and `medium` are
  // positional, and a `k` landing mid-list would be inert but confusing.
  assert.deepEqual(
    tags.slice(-2).map((t) => t[0]),
    ['k', 'k']
  );
});

test('a parent feed group is opened even when the feed itself is not favorited', () => {
  // THE PLACEMENT CASE. There is no other way to say which feed a track came
  // from, so a favorited track drags its parent onto the list. 114 of 159
  // parents were in this state in real data. What a reader does with the guid
  // is the reader's business — this only has to say it.
  const groups = groupForSingleList([track('t9', MUSIC_C, 'music')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].feedGuid, MUSIC_C);
  assert.equal(groups[0].favorited, false);
  assert.deepEqual(seq(buildSingleListTags([track('t9', MUSIC_C, 'music')])), [
    `alt:${LIST_ALT}`,
    'medium:music',
    `i:podcast:guid:${MUSIC_C}`,
    'i:podcast:item:guid:t9',
    'k:podcast:guid',
    'k:podcast:item:guid',
  ]);
});

test('same-medium feeds stay contiguous and medium appears once per group', () => {
  // Interleaving media would re-label entries, because the tag applies to
  // everything that follows it. The input here is deliberately interleaved.
  const tags = buildSingleListTags([
    album(MUSIC_A, 'music'),
    album(POD_B, 'podcast'),
    track('t1', MUSIC_A, 'music'),
  ]);
  assert.deepEqual(seq(tags), [
    `alt:${LIST_ALT}`,
    'medium:music',
    `i:podcast:guid:${MUSIC_A}`,
    'i:podcast:item:guid:t1',
    'medium:podcast',
    `i:podcast:guid:${POD_B}`,
    'k:podcast:guid',
    'k:podcast:item:guid',
  ]);
  assert.equal(tags.filter((t) => t[0] === 'medium').length, 2);
});

test('a feed that declared no medium is not published as music', () => {
  // `Feed.medium` is NULL until a feed says otherwise and nothing may default
  // it — least of all `Feed.type`, which defaults to "album". Unknown-medium
  // groups therefore go ahead of every `medium` tag rather than inheriting one.
  const tags = buildSingleListTags([
    album(MUSIC_A, 'music'),
    track('t7', NO_MEDIUM_D, undefined),
  ]);
  assert.deepEqual(seq(tags), [
    `alt:${LIST_ALT}`,
    `i:podcast:guid:${NO_MEDIUM_D}`,
    'i:podcast:item:guid:t7',
    'medium:music',
    `i:podcast:guid:${MUSIC_A}`,
    'k:podcast:guid',
    'k:podcast:item:guid',
  ]);
  // Nothing before the first `medium` tag claims a medium at all.
  assert.equal(tags.findIndex((t) => t[0] === 'medium') > 0, true);
});

test('a URL-shaped item guid does not corrupt its k tag', () => {
  // Item guids are routinely permalinks. "Everything before the last colon"
  // yields `podcast:item:guid:https`, a k value no relay filter matches — so
  // the kind comes from the table in `identifierKind`, never from scanning.
  const tags = buildSingleListTags([track('https://example.com/ep/42', MUSIC_A, 'music')]);
  assert.deepEqual(
    tags.find((t) => t[1] === 'podcast:item:guid:https://example.com/ep/42'),
    ['i', 'podcast:item:guid:https://example.com/ep/42']
  );
  assert.deepEqual(
    tags.filter((t) => t[0] === 'k').map((t) => t[1]),
    ['podcast:guid', 'podcast:item:guid']
  );
});

test('an item with no resolvable parent is dropped, not given an invented one', () => {
  const orphan: FavoriteEntry = { id: itemId('t-orphan'), medium: 'music' };
  assert.deepEqual(groupForSingleList([orphan]), []);
  assert.deepEqual(seq(buildSingleListTags([orphan])), [`alt:${LIST_ALT}`]);
});

test('a parent given as a bare guid is accepted, as well as the prefixed form', () => {
  const bare: FavoriteEntry = { id: itemId('t2'), feedRef: MUSIC_A, medium: 'music' };
  const prefixed = track('t2', MUSIC_A, 'music');
  assert.deepEqual(buildSingleListTags([bare]), buildSingleListTags([prefixed]));
});

test('an album and a track of the same feed produce ONE group', () => {
  const groups = groupForSingleList([
    track('t1', MUSIC_A, 'music'),
    album(MUSIC_A, 'music'),
    track('t2', MUSIC_A, 'music'),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].favorited, true);
  assert.deepEqual(groups[0].itemGuids, ['t1', 't2']);
});

test('a duplicate favorite does not produce a duplicate tag', () => {
  const tags = buildSingleListTags([
    album(MUSIC_A, 'music'),
    album(MUSIC_A, 'music'),
    track('t1', MUSIC_A, 'music'),
    track('t1', MUSIC_A, 'music'),
  ]);
  assert.equal(tags.filter((t) => t[0] === 'i').length, 2);
});

test('a group opened by a track picks up the medium, wherever it arrives from', () => {
  // The track carries its PARENT's medium — Podcasting 2.0 has no per-item one
  // — so a group opened by a track is already labelled correctly, and the album
  // entry arriving later must not be needed to fix it.
  assert.equal(groupForSingleList([track('t1', MUSIC_C, 'music')])[0].medium, 'music');
  assert.equal(
    groupForSingleList([track('t1', MUSIC_A, undefined), album(MUSIC_A, 'music')])[0].medium,
    'music'
  );
});

test('idempotence — the same inputs twice produce byte-identical tags', () => {
  // Republishing replaces the whole event, so churn here is a real cost: a new
  // signature, a new relay write, and a `created_at` bump for nothing.
  const items = [
    album(MUSIC_A, 'music'),
    track('t1', MUSIC_A, 'music'),
    album(POD_B, 'podcast'),
    track('t9', MUSIC_C, 'music'),
    track('t7', NO_MEDIUM_D, undefined),
  ];
  assert.equal(singleListDigest(items), singleListDigest(items));
  assert.deepEqual(buildSingleListTags(items), buildSingleListTags([...items]));
  // ...and the digest is what it is FOR: a favorite toggle that does change
  // this event must be detectable, or the publish would be skipped.
  assert.notEqual(singleListDigest(items), singleListDigest(items.slice(0, -1)));
});

test('unfavoriting a feed whose track is still favorited is INVISIBLE on the wire', () => {
  // Not a bug in this module — a property of the format, and the sharpest edge
  // in it. A feed group opened for placement is byte-identical to one opened
  // because the user favorited the feed, so removing the feed favorite while a
  // track of it remains favorited produces the exact same event.
  //
  // The consequence for a reader: it cannot be told that the album was
  // unfavorited, and this app cannot say so. The two-list format could — the
  // parent lived on the item's own tag, so the feed entry was free to vanish.
  const withAlbum = [album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')];
  const withoutAlbum = [track('t1', MUSIC_A, 'music')];
  assert.equal(singleListDigest(withAlbum), singleListDigest(withoutAlbum));

  // It IS visible once the last track goes too, which is the only way out.
  assert.notEqual(singleListDigest(withoutAlbum), singleListDigest([]));

  // And the local distinction survives even though the wire one doesn't, so a
  // future reader has something to work with if the spec ever gains a marker.
  assert.equal(groupForSingleList(withAlbum)[0].favorited, true);
  assert.equal(groupForSingleList(withoutAlbum)[0].favorited, false);
});

test('an empty library is a well-formed event, not a broken one', () => {
  assert.deepEqual(buildSingleListTags([]), [['alt', LIST_ALT]]);
});

// --- reading ---------------------------------------------------------------

test('round trip — what we write is what we read back', () => {
  const items = [
    album(MUSIC_A, 'music'),
    track('t1', MUSIC_A, 'music'),
    album(POD_B, 'podcast'),
    track('t9', MUSIC_C, 'music'),
  ];
  const { groups, orphanItemGuids } = parseSingleList(buildSingleListTags(items));

  assert.deepEqual(orphanItemGuids, []);
  assert.deepEqual(
    groups.map((g) => [g.feedGuid, g.medium, g.itemGuids]),
    [
      [MUSIC_A, 'music', ['t1']],
      [MUSIC_C, 'music', ['t9']],
      [POD_B, 'podcast', []],
    ]
  );
});

test('the running medium applies until the next medium tag, not just to one entry', () => {
  const { groups } = parseSingleList([
    ['alt', LIST_ALT],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', showId(MUSIC_C)],
    ['medium', 'podcast'],
    ['i', showId(POD_B)],
  ]);
  assert.deepEqual(
    groups.map((g) => [g.feedGuid, g.medium]),
    [
      [MUSIC_A, 'music'],
      [MUSIC_C, 'music'],
      [POD_B, 'podcast'],
    ]
  );
});

test('an entry before any medium tag is UNKNOWN, not podcast', () => {
  // Deliberate divergence from the spec's default. This app writes its own
  // unknown-medium groups in exactly that position, so honouring the default
  // would round-trip "not told" into "podcast" and file a music release under
  // Podcasts. The hint is advisory and a resolved answer wins.
  const { groups } = parseSingleList([
    ['alt', LIST_ALT],
    ['i', showId(NO_MEDIUM_D)],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  assert.equal(groups[0].medium, undefined);
  assert.equal(groups[1].medium, 'music');
});

test('an item attaches to the most recently opened group, not the first', () => {
  const { groups } = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', showId(MUSIC_C)],
    ['i', itemId('t9')],
  ]);
  assert.deepEqual(groups.map((g) => g.itemGuids), [['t1'], ['t9']]);
});

test('BOTH k forms parse the same — paired as the spec writes it, or trailing', () => {
  // The reader must accept what other apps write, including the form this app
  // no longer emits. `k` is ignored entirely: an entry's kind comes from its
  // identifier, which is the only reading that works for both.
  const paired = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['k', 'podcast:guid'],
    ['i', itemId('t1')],
    ['k', 'podcast:item:guid'],
  ]);
  const trailing = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['k', 'podcast:guid'],
    ['k', 'podcast:item:guid'],
  ]);
  assert.deepEqual(paired, trailing);
});

test('an item before any feed group is KEPT as an orphan, not dropped', () => {
  // This app never writes one; another writer might, and dropping it loses a
  // favorite. It cannot resolve through /episodes/byguid without a parent, but
  // it can still match a local row by its own guid.
  const { groups, orphanItemGuids } = parseSingleList([
    ['alt', LIST_ALT],
    ['i', itemId('t-loose')],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  assert.deepEqual(orphanItemGuids, ['t-loose']);
  assert.equal(groups.length, 1);
  const { tracks } = partitionSingleList({ groups, orphanItemGuids });
  assert.deepEqual(tracks, [{ itemGuid: 't-loose' }]);
});

test('an unrecognized identifier kind is never guessed at — and never dropped', () => {
  // It is not placed (it has no meaning here) but it IS carried, whole. The
  // `groups` projection deliberately excludes it: "we can't model this" and
  // "this isn't on the list" are different claims, and only the first is ours
  // to make.
  const read = parseSingleList([
    ['i', 'podcast:publisher:guid:0e8f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b'],
    ['i', 'something:else:entirely'],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  assert.deepEqual(read.groups.map((g) => g.feedGuid), [MUSIC_A]);
  assert.deepEqual(read.orphanItemGuids, []);
  assert.deepEqual(
    read.nodes.filter((n) => n.t === 'loose').map((n) => (n.t === 'loose' ? n.loose.tag : [])),
    [
      ['i', 'podcast:publisher:guid:0e8f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b'],
      ['i', 'something:else:entirely'],
    ]
  );
});

test('partition carries the group medium onto every track under it', () => {
  // Podcasting 2.0 has no per-item medium — an item's is its feed's — and the
  // reconcile needs one per track to type a new row.
  const { shows, tracks } = partitionSingleList(
    parseSingleList(buildSingleListTags([album(POD_B, 'podcast'), track('t1', POD_B, 'podcast')]))
  );
  assert.deepEqual(shows, [{ feedGuid: POD_B, medium: 'podcast' }]);
  assert.deepEqual(tracks, [{ itemGuid: 't1', feedGuid: POD_B, medium: 'podcast' }]);
});

test('a degraded read is not an empty list — parse never invents that distinction', () => {
  // The trust flag lives in `relay-read.ts`; this only pins that an event with
  // no entries parses as empty rather than throwing, so the two states stay
  // distinguishable by the caller rather than here.
  assert.deepEqual(parseSingleList([['alt', LIST_ALT]]), {
    nodes: [],
    // Null, not 'public'. An event that never said which half it lives in has
    // not said it, and a default here would make every list written before the
    // tag claim a mode nobody picked.
    visibility: null,
    foreignTags: [],
    foreignKinds: [],
    groups: [],
    orphanItemGuids: [],
  });
});

test('a group with items cannot be read as a favorited FEED — the reconcile rule', () => {
  // Pins the property `/api/favorites/sync-shared` now depends on. A group is
  // opened to place a track whether or not the feed is favorited, and nothing
  // on the wire tells the two apart, so only an ITEMLESS group is unambiguous.
  //
  // Without this the reconcile read this app's own list back and created an
  // album favorite for every track parent: 196 groups for 82 favorited feeds.
  const written = buildSingleListTags([
    album(MUSIC_A, 'music'), // favorited feed, no favorited tracks
    track('t9', MUSIC_C, 'music'), // placement only — MUSIC_C is not favorited
    album(POD_B, 'podcast'), // favorited feed AND a favorited track under it
    track('t1', POD_B, 'podcast'),
  ]);
  const { shows, tracks } = partitionSingleList(parseSingleList(written));

  const withItems = new Set(tracks.map((t) => t.feedGuid));
  const unambiguous = shows.filter((s) => !withItems.has(s.feedGuid)).map((s) => s.feedGuid);

  // Only the itemless group survives the rule. MUSIC_C is correctly excluded;
  // POD_B is the accepted cost — a real favorite this app declines to infer.
  assert.deepEqual(unambiguous, [MUSIC_A]);
  assert.equal(withItems.has(MUSIC_C), true, 'placement group is excluded');
  assert.equal(withItems.has(POD_B), true, 'ambiguous group is excluded too');
});

// --- the read-then-carry merge ---------------------------------------------

const FOREIGN_E = 'b1c2d3e4-5f60-5a7b-8c9d-0e1f2a3b4c5d';

/** What our writer would emit for these local favorites, merged onto a read. */
const mergedTags = (read: ReturnType<typeof parseSingleList>, local: FavoriteEntry[]) => {
  const merged = mergeSingleList(read, groupForSingleList(local));
  return tagsFromNodes(merged.nodes, merged.foreignTags, merged.foreignKinds);
};

test('a foreign feed group survives a republish, with its items and its position', () => {
  // THE CLOBBER CASE, and the reason this pass exists. Without it every publish
  // deletes whatever the other app holds exclusively — silently, on someone
  // else's device, with no baseline to notice it went missing.
  const read = parseSingleList([
    ['medium', 'podcast'],
    ['i', showId(FOREIGN_E)],
    ['i', itemId('their-ep')],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  const tags = mergedTags(read, [album(MUSIC_A, 'music')]);

  assert.deepEqual(seq(tags), [
    `alt:${LIST_ALT}`,
    'medium:podcast',
    `i:podcast:guid:${FOREIGN_E}`,
    'i:podcast:item:guid:their-ep',
    'medium:music',
    `i:podcast:guid:${MUSIC_A}`,
    'k:podcast:guid',
    'k:podcast:item:guid',
  ]);
});

test('an orphan item survives, still ahead of the groups', () => {
  const read = parseSingleList([
    ['i', itemId('loose')],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  const tags = mergedTags(read, [album(MUSIC_A, 'music')]);
  assert.deepEqual(seq(tags).slice(0, 2), [`alt:${LIST_ALT}`, 'i:podcast:item:guid:loose']);
});

test('a local unfavorite under a feed we hold still disappears', () => {
  // The other half. Removal has to keep working, and what makes it possible is
  // knowing we put `t2` there ourselves — without the published record an entry
  // we removed is indistinguishable from one another app added, and the
  // conservative reading (carry it) is what resurrected an unfavorited album.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', itemId('t2')],
  ]);
  const local = [album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')];
  const published = publishedRecordFrom(
    groupForSingleList([...local, track('t2', MUSIC_A, 'music')])
  );
  const merged = mergeSingleList(read, groupForSingleList(local), published);
  assert.deepEqual(
    tagsFromNodes(merged.nodes, merged.foreignTags, merged.foreignKinds)
      .filter((t) => t[0] === 'i')
      .map((t) => t[1]),
    [showId(MUSIC_A), itemId('t1')]
  );
});

test('a new local group appends to the end of its medium block, not the event', () => {
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['medium', 'podcast'],
    ['i', showId(POD_B)],
  ]);
  const tags = mergedTags(read, [
    album(MUSIC_A, 'music'),
    album(POD_B, 'podcast'),
    album(MUSIC_C, 'music'), // new
  ]);
  assert.deepEqual(seq(tags), [
    `alt:${LIST_ALT}`,
    'medium:music',
    `i:podcast:guid:${MUSIC_A}`,
    `i:podcast:guid:${MUSIC_C}`,
    'medium:podcast',
    `i:podcast:guid:${POD_B}`,
    'k:podcast:guid',
  ]);
});

test("a group's items keep their WIRE order, and a new one goes at the end — spec vector 18", () => {
  // The convergence bug. This app used to emit `mine` first, Boost Me Bitch
  // keeps what it read, so each publish put the items in ITS order and the
  // other app's next cycle put them back — the event rewritten on every load,
  // for three weeks, with every publish locally reasonable. Tag order is
  // semantic, so that was the meaningful part of the event moving.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', itemId('t2')],
    ['medium', 'podcast'],
    ['i', showId(POD_B)],
    ['i', itemId('e1')],
  ]);
  const local = [
    // Held in a different order from the wire, plus t3 which is new here.
    track('t3', MUSIC_A, 'music'),
    track('t2', MUSIC_A, 'music'),
    track('t1', MUSIC_A, 'music'),
    track('e1', POD_B, 'podcast'),
  ];
  const published = publishedRecordFrom(
    groupForSingleList([
      track('t1', MUSIC_A, 'music'),
      track('t2', MUSIC_A, 'music'),
      track('e1', POD_B, 'podcast'),
    ])
  );
  const emit = (r: ReturnType<typeof parseSingleList>) => {
    const merged = mergeSingleList(r, groupForSingleList(local), published);
    return tagsFromNodes(merged.nodes, merged.foreignTags, merged.foreignKinds);
  };
  const tags = emit(read);
  assert.deepEqual(
    tags.filter((t) => t[0] === 'i').map((t) => t[1]),
    [showId(MUSIC_A), itemId('t1'), itemId('t2'), itemId('t3'), showId(POD_B), itemId('e1')],
    'wire order kept; the new item after its own group and before the next'
  );
  // And a second pass over our own output is a fixed point — the property the
  // old order broke for the OTHER app, which this test cannot see directly.
  assert.deepEqual(emit(parseSingleList(tags)), tags);
});

test('media stay contiguous even when the read interleaved them', () => {
  // Where the spec's two ordering rules collide, contiguity wins: reordering
  // within a block reattaches nothing, while a broken block silently re-labels
  // every entry after the boundary.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['medium', 'podcast'],
    ['i', showId(POD_B)],
    ['medium', 'music'],
    ['i', showId(MUSIC_C)],
  ]);
  const tags = mergedTags(read, [
    album(MUSIC_A, 'music'),
    album(POD_B, 'podcast'),
    album(MUSIC_C, 'music'),
  ]);
  assert.equal(tags.filter((t) => t[0] === 'medium').length, 2);
  const order = seq(tags);
  assert.equal(order.indexOf('medium:podcast') > order.indexOf(`i:podcast:guid:${MUSIC_C}`), true);
});

test('a hint we did not write is not blanked by a local entry that lacks one', () => {
  const read = parseSingleList([
    ['medium', 'audiobook'],
    ['i', showId(NO_MEDIUM_D)],
  ]);
  const merged = mergeSingleList(read, groupForSingleList([album(NO_MEDIUM_D, undefined)]));
  assert.equal(merged.groups[0].medium, 'audiobook');
});

test('idempotence — merging our own output back produces byte-identical tags', () => {
  // The property that stops two apps rewriting the event against each other
  // forever, and the one a carry pass is easiest to break.
  const local = [album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music'), album(POD_B, 'podcast')];
  const first = buildSingleListTags(local);
  const second = mergedTags(parseSingleList(first), local);
  assert.deepEqual(second, first);
  const third = mergedTags(parseSingleList(second), local);
  assert.deepEqual(third, second);
});

test('an entry WE published and no longer hold is a removal, not a foreign entry', () => {
  // THE RESURRECTION CASE, and it shipped. Treating "not in our favorites" as
  // "another app's" meant an unfavorited album was carried on every republish,
  // read back by the reconcile, taken as a feed favorite because the group had
  // no items, and re-created. Unfavoriting undid itself on the next page load.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', showId(MUSIC_C)], // we published this one and have now unfavorited it
  ]);
  const published = publishedRecordFrom(
    groupForSingleList([album(MUSIC_A, 'music'), album(MUSIC_C, 'music')])
  );
  const merged = mergeSingleList(read, groupForSingleList([album(MUSIC_A, 'music')]), published);

  assert.deepEqual(merged.groups.map((g) => g.feedGuid), [MUSIC_A]);
});

test('...while an entry we never published is still carried', () => {
  // The other side of the same rule. Without it the fix above becomes a
  // clobber: everything we don't favorite would look like our own removal.
  const read = parseSingleList([
    ['medium', 'podcast'],
    ['i', showId(FOREIGN_E)],
    ['i', itemId('their-ep')],
  ]);
  // A record that claims something ELSE, so MUSIC_A is genuinely new here.
  const published = publishedRecordFrom(groupForSingleList([album(POD_B, 'podcast')]));
  const merged = mergeSingleList(read, groupForSingleList([album(MUSIC_A, 'music')]), published);

  assert.deepEqual(merged.groups.map((g) => g.feedGuid), [FOREIGN_E, MUSIC_A]);
  assert.deepEqual(merged.groups[0].itemGuids, ['their-ep']);
});

test('an entry ANOTHER app removed is not resurrected — spec vector 9', () => {
  // We hold it, our record claims it, and the relay no longer has it: the
  // other app deleted it. The append loop used to re-add it unconditionally,
  // so the favorite came back on every load, on every device, forever — the
  // second of the two ways the comparison page in PC20-Nostr said the apps
  // were rewriting the event at each other.
  const read = parseSingleList([['medium', 'music'], ['i', showId(MUSIC_A)]]);
  const local = [album(MUSIC_A, 'music'), album(MUSIC_C, 'music'), track('t9', MUSIC_C, 'music')];
  const published = publishedRecordFrom(groupForSingleList(local));
  const merged = mergeSingleList(read, groupForSingleList(local), published);
  assert.deepEqual(merged.groups.map((g) => g.feedGuid), [MUSIC_A]);

  // But a track the user has JUST favorited under that same removed feed still
  // goes up, with its group reopened to name the parent — and only that.
  const withNew = [...local, track('t10', MUSIC_C, 'music')];
  const again = mergeSingleList(read, groupForSingleList(withNew), published);
  assert.deepEqual(again.groups.map((g) => g.feedGuid), [MUSIC_A, MUSIC_C]);
  assert.deepEqual(again.groups[1].itemGuids, ['t10']);
  assert.equal(again.groups[1].favorited, false, 'reopened to place the track, not as a favorite');
});

test('an item under OUR feed that we never published survives', () => {
  // Another app favoriting a track of an album we also hold. Ours are emitted
  // first, theirs follow — dropping them would delete their data just because
  // the feed happens to be one we know.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', itemId('theirs')],
  ]);
  const published = publishedRecordFrom(
    groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')])
  );
  const merged = mergeSingleList(
    read,
    groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')]),
    published
  );
  assert.deepEqual(merged.groups[0].itemGuids, ['t1', 'theirs']);
});

test('an item we published and unfavorited is removed, not carried', () => {
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', itemId('t2')],
  ]);
  const published = publishedRecordFrom(
    groupForSingleList([
      album(MUSIC_A, 'music'),
      track('t1', MUSIC_A, 'music'),
      track('t2', MUSIC_A, 'music'),
    ])
  );
  const merged = mergeSingleList(
    read,
    groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')]),
    published
  );
  assert.deepEqual(merged.groups[0].itemGuids, ['t1']);
});

test('an empty published record treats nothing as a removal', () => {
  // First run on a new device: we have agreed to nothing, so we may delete
  // nothing. The same rule the kind:30078 baseline used for an absent baseline.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_C)],
  ]);
  const merged = mergeSingleList(read, groupForSingleList([album(MUSIC_A, 'music')]));
  assert.deepEqual(merged.groups.map((g) => g.feedGuid), [MUSIC_C, MUSIC_A]);
});

test('the published record holds OUR contribution only, never what we carried', () => {
  // A carried entry recorded as ours would be deleted on the next pass — the
  // resurrection bug inverted into a clobber.
  const record = publishedRecordFrom(
    groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')])
  );
  assert.deepEqual(record, { feeds: [MUSIC_A], items: ['t1'] });
});

// --- the inbound half of the same question ---------------------------------

test('an entry we published and removed is NOT reconciled back in', () => {
  // THE FOURTH ATTEMPT AT THE SAME BUG. Fixing the writer was not enough: the
  // order is read → reconcile → push, so between an unfavorite and its publish
  // the list still carries the entry. Reconciling it back in re-creates the
  // row, and the push then sees it as local, produces the tags already on the
  // wire, and is skipped as unchanged. Nothing propagates, ever.
  const incoming = {
    shows: [{ feedGuid: MUSIC_A }, { feedGuid: MUSIC_C }],
    tracks: [{ itemGuid: 't1' }, { itemGuid: 't2' }],
  };
  const local = groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')]);
  const published = publishedRecordFrom(
    groupForSingleList([
      album(MUSIC_A, 'music'),
      album(MUSIC_C, 'music'),
      track('t1', MUSIC_A, 'music'),
      track('t2', MUSIC_A, 'music'),
    ])
  );

  const kept = suppressOwnRemovals(incoming, local, published);
  assert.deepEqual(kept.shows.map((s) => s.feedGuid), [MUSIC_A]);
  assert.deepEqual(kept.tracks.map((t) => t.itemGuid), ['t1']);
});

test('...but a genuine inbound favorite from another app still arrives', () => {
  // The half that must not break: we never published these, so they are not
  // ours to suppress. Getting this wrong turns the app read-only.
  const incoming = {
    shows: [{ feedGuid: FOREIGN_E }],
    tracks: [{ itemGuid: 'their-ep' }],
  };
  const local = groupForSingleList([album(MUSIC_A, 'music')]);
  const published = publishedRecordFrom(local);

  const kept = suppressOwnRemovals(incoming, local, published);
  assert.deepEqual(kept.shows.map((s) => s.feedGuid), [FOREIGN_E]);
  assert.deepEqual(kept.tracks.map((t) => t.itemGuid), ['their-ep']);
});

test('an entry we published and STILL hold is left alone', () => {
  const incoming = { shows: [{ feedGuid: MUSIC_A }], tracks: [{ itemGuid: 't1' }] };
  const local = groupForSingleList([album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music')]);
  const kept = suppressOwnRemovals(incoming, local, publishedRecordFrom(local));
  assert.deepEqual(kept.shows.length, 1);
  assert.deepEqual(kept.tracks.length, 1);
});

test('an empty published record suppresses nothing', () => {
  // First run: we have agreed to nothing, so nothing on the list can be our
  // removal. Suppressing here would hide the user's own library from the
  // reconcile on a fresh device.
  const incoming = { shows: [{ feedGuid: MUSIC_C }], tracks: [{ itemGuid: 't9' }] };
  const kept = suppressOwnRemovals(incoming, [], { feeds: [], items: [] });
  assert.deepEqual(kept.shows.length, 1);
  assert.deepEqual(kept.tracks.length, 1);
});

// --- carrying what this app cannot read ------------------------------------
//
// Spec §4, "Carry what you can't read". Every fixture below is a literal WIRE
// tag array — what a relay could hand us — and never a struct rendered back
// out. A round trip built from our own fields cannot fail: we write the
// positions we know, read them back, and the comparison is vacuously true
// while everything else is silently truncated. That is exactly the shape of
// the bug these pin, so the inputs have to come from outside the model.
//
// All four failed against the implementation that preceded them.

test('a foreign tag type survives a republish, whole', () => {
  // A writer newer or older than us put something here that we have no meaning
  // for. "I can't render this" is not the same claim as "this is junk".
  const read = parseSingleList([
    ['alt', LIST_ALT],
    ['title', "Chad's favorites"],
    ['zzz', 'payload', 'second element'],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  const tags = mergedTags(read, [album(MUSIC_A, 'music')]);

  assert.deepEqual(tags, [
    ['alt', LIST_ALT],
    ['title', "Chad's favorites"],
    ['zzz', 'payload', 'second element'],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['k', 'podcast:guid'],
  ]);
});

test('a k naming a kind we never emit rides along', () => {
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['k', 'podcast:guid'],
    ['k', 'future:kind'],
  ]);
  const tags = mergedTags(read, [album(MUSIC_A, 'music')]);
  assert.deepEqual(
    tags.filter((t) => t[0] === 'k'),
    [['k', 'podcast:guid'], ['k', 'future:kind']]
  );
});

test('an unreadable i does NOT re-parent the items after it', () => {
  // The corruption case, and the reason a loose node must not close the open
  // group. `920666` is not a UUID, so it is not a feed group we can open — but
  // dropping it silently hands `t-after` to whichever feed happened to be open
  // before it, which is well-formed, invisible, and wrong.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t-before')],
    ['i', 'podcast:guid:920666'],
    ['i', itemId('t-after')],
  ]);

  // Both items stay under MUSIC_A — the entry we couldn't read moved nothing.
  assert.deepEqual(read.groups.map((g) => g.feedGuid), [MUSIC_A]);
  assert.deepEqual(read.groups[0]?.itemGuids, ['t-before', 't-after']);

  // It survives, inside its own medium block.
  //
  // KNOWN LIMITATION, and pinned as it really behaves rather than as we would
  // like: a group holds its items as a list, so a loose entry that sat BETWEEN
  // two of them is re-emitted after both. Boost Me Bitch's model is the same
  // shape and does the same thing (its own vector asserts only "still inside
  // the music block" for exactly this reason), so the two agree and the layout
  // is a fixed point after one rewrite rather than a rewrite war. Nothing is
  // lost and nothing is re-parented under the reading both apps use. Making it
  // exact means items becoming nodes in their own right.
  const tags = mergedTags(read, []);
  assert.deepEqual(seq(tags), [
    `alt:${LIST_ALT}`,
    'medium:music',
    `i:podcast:guid:${MUSIC_A}`,
    'i:podcast:item:guid:t-before',
    'i:podcast:item:guid:t-after',
    'i:podcast:guid:920666',
    'k:podcast:guid',
    'k:podcast:item:guid',
  ]);

  // Whatever its index, it is still there and still under `music`.
  const at = tags.findIndex((t) => t[1] === 'podcast:guid:920666');
  assert.ok(at > tags.findIndex((t) => t[0] === 'medium' && t[1] === 'music'));

  // And the layout it settles on is stable — one rewrite, not an argument.
  assert.deepEqual(mergedTags(parseSingleList(tags), []), tags);
});

test('the same feed twice on the wire keeps BOTH groups’ items', () => {
  // Skipping the duplicate takes its items with it: nothing else on the event
  // names their parent, so they are not recoverable from anywhere afterwards.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t2')],
  ]);
  const tags = mergedTags(read, []);
  assert.deepEqual(
    tags.filter((t) => t[0] === 'i').map((t) => t[1]),
    [showId(MUSIC_A), itemId('t1'), itemId('t2')]
  );
});

test('idempotence — merging our own output reproduces it byte for byte', () => {
  // Spec test vector 3, run over everything above at once. If this is not a
  // fixed point, two apps rewrite the event against each other forever, each
  // publish locally reasonable and the only symptom being that it never stops.
  const wire: string[][] = [
    ['alt', LIST_ALT],
    ['zzz', 'payload', 'second element'],
    ['i', showId(NO_MEDIUM_D)],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', itemId('t1')],
    ['i', 'podcast:guid:920666'],
    ['i', 'podcast:publisher:guid:0e8f6a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b'],
    ['medium', 'podcast'],
    ['i', showId(POD_B)],
    ['k', 'podcast:guid'],
    ['k', 'podcast:item:guid'],
    // We carry the publisher entry, so we also name its kind — `k` is derived
    // from the identifiers actually emitted, which is what keeps a `#k` filter
    // able to find the entry we just carried on someone else's behalf.
    ['k', 'podcast:publisher:guid'],
    ['k', 'future:kind'],
  ];
  const local = [album(MUSIC_A, 'music'), track('t1', MUSIC_A, 'music'), album(POD_B, 'podcast')];

  const once = mergedTags(parseSingleList(wire), local);
  assert.deepEqual(once, wire, 'the read is already a fixed point');

  const twice = mergedTags(parseSingleList(once), local);
  assert.deepEqual(twice, once);
});

test('the group projection still excludes what we merely carried', () => {
  // `groups` drives the reconcile, which creates DB rows. A loose entry
  // appearing there would manufacture a favorite out of a tag we admit we
  // cannot read.
  const read = parseSingleList([
    ['i', 'podcast:guid:920666'],
    ['i', 'something:else:entirely'],
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
  ]);
  assert.deepEqual(read.groups.map((g) => g.feedGuid), [MUSIC_A]);
  assert.equal(read.nodes.filter((n) => n.t === 'loose').length, 2);
});

// ---------------------------------------------------------------------------
// The three-element item entry (PC20-Nostr #34), stage 1: READ it and carry it.
// This app still WRITES the legacy two-element form; see the module header.
// ---------------------------------------------------------------------------

const TRACK_1 = 'fb279ed1-10ec-4060-967d-9af45c19505f';
const TRACK_2 = 'f4cc32b4-0e1e-45a1-a6fb-64e7f8d0e0a2';

test('an item entry that names its own feed is read, and its feed comes off ITS OWN tag', () => {
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', showId(MUSIC_C), itemId(TRACK_1)],
  ]);
  // The item belongs to MUSIC_C, which is NOT the feed entry above it. Reading
  // the feed from the entry above — the legacy rule — gives MUSIC_A, and the
  // track then resolves to an album the user never saved it from.
  assert.deepEqual(
    read.nodes.map((n) => n.t),
    ['group', 'item']
  );
  const item = read.nodes.find((n) => n.t === 'item');
  assert.equal(item?.t === 'item' && item.item.feedGuid, MUSIC_C);
  assert.equal(item?.t === 'item' && item.item.itemGuid, TRACK_1);
});

test('a three-element entry is told apart by LENGTH, never by position 1', () => {
  // Both tags carry the same string at position 1. Only the element count says
  // which is the feed favorite, so a reader that branches on position 1 turns
  // one saved episode into a followed show.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', showId(MUSIC_A), itemId(TRACK_1)],
  ]);
  assert.deepEqual(read.nodes.map((n) => n.t), ['group', 'item']);
  assert.equal(read.groups.length, 1);
  assert.deepEqual(read.groups[0].itemGuids, [TRACK_1], 'the track must project under its album');
});

test('an item entry is republished WHOLE, including a position this app has no meaning for', () => {
  const NEWER = 'written-by-a-writer-newer-than-this-one';
  const tags = [
    ['medium', 'music'],
    ['i', showId(MUSIC_A), itemId(TRACK_1), NEWER],
    ['i', showId(MUSIC_C), itemId(TRACK_2)],
  ];
  const read = parseSingleList(tags);
  const out = tagsFromNodes(read.nodes, read.foreignTags, read.foreignKinds, read.visibility);
  assert.deepEqual(
    out.filter((t) => t[0] === 'i'),
    [
      ['i', showId(MUSIC_A), itemId(TRACK_1), NEWER],
      ['i', showId(MUSIC_C), itemId(TRACK_2)],
    ],
    'rebuilding an entry as [i, id] strips the feed guid that makes it resolvable'
  );
  // Idempotent: reading our own output back changes nothing.
  const again = parseSingleList(out);
  assert.deepEqual(tagsFromNodes(again.nodes, again.foreignTags, again.foreignKinds, again.visibility), out);
});

test('a position 2 we cannot read is an unreadable ENTRY, not a feed favorite', () => {
  // Only `podcast:item:guid:` is defined at position 2 today. Ignoring what we
  // do not recognise would republish this as a favorite of the whole feed.
  const read = parseSingleList([
    ['medium', 'podcast'],
    ['i', showId(POD_B), 'podcast:chapter:guid:12345'],
  ]);
  assert.deepEqual(read.nodes.map((n) => n.t), ['loose']);
  assert.deepEqual(read.groups, [], 'it must not become a feed favorite');
  const out = tagsFromNodes(read.nodes, read.foreignTags, read.foreignKinds, read.visibility);
  assert.deepEqual(
    out.filter((t) => t[0] === 'i'),
    [['i', showId(POD_B), 'podcast:chapter:guid:12345']]
  );
});

test('a three-element entry does not end an open legacy run', () => {
  // The legacy item below still belongs to the feed opened above. Closing the
  // run on an entry that is not a feed entry strands it with no feed at all.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', showId(MUSIC_C), itemId(TRACK_1)],
    ['i', itemId(TRACK_2)],
  ]);
  const a = read.groups.find((g) => g.feedGuid === MUSIC_A);
  assert.deepEqual(a?.itemGuids, [TRACK_2], 'the legacy item lost the feed above it');
});

test('a carried item entry is emitted ONCE, in the form it arrived in', () => {
  // This app holds the same track locally. Without the carried-item check the
  // merge appends its own two-element copy beneath the group as well —
  // duplicating the favorite and stripping half its address.
  const tags = [
    ['medium', 'music'],
    ['i', showId(MUSIC_A)],
    ['i', showId(MUSIC_A), itemId(TRACK_1)],
  ];
  const read = parseSingleList(tags);
  const local = groupForSingleList([album(MUSIC_A, 'music'), track(TRACK_1, MUSIC_A, 'music')]);
  const merged = mergeSingleList(read, local, publishedRecordFrom(local));
  const out = tagsFromNodes(merged.nodes, merged.foreignTags, merged.foreignKinds, merged.visibility);
  assert.deepEqual(
    out.filter((t) => t[0] === 'i'),
    [['i', showId(MUSIC_A)], ['i', showId(MUSIC_A), itemId(TRACK_1)]]
  );
});

test('an item entry with no feed entry of its own still projects under its feed', () => {
  // The case the old format could not express: a track saved from an album the
  // user never favorited. `groups` drives the reconcile, so a track missing
  // from it is a favorite that vanishes on this side.
  const read = parseSingleList([
    ['medium', 'music'],
    ['i', showId(MUSIC_C), itemId(TRACK_1)],
  ]);
  assert.deepEqual(read.groups.map((g) => [g.feedGuid, g.itemGuids, g.favorited]), [
    [MUSIC_C, [TRACK_1], false],
  ]);
  // And the projection must not have edited the node list: re-emitting carries
  // exactly one tag.
  const out = tagsFromNodes(read.nodes, read.foreignTags, read.foreignKinds, read.visibility);
  assert.deepEqual(out.filter((t) => t[0] === 'i'), [['i', showId(MUSIC_C), itemId(TRACK_1)]]);
});
