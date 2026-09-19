/**
 * npx tsx --test lib/nostr/boost-note.test.ts
 *
 * Pins the identifier block on a boost note (#237).
 *
 * The failure this guards is invisible. An `i` tag with no `k` is well-formed,
 * carries every guid, renders correctly in every client — and matches
 * `{"kinds":[1],"#k":[...]}` never. 274 notes shipped that way and no test,
 * build or lint had anything to say about it. So the assertions below are
 * mostly about the `k`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nip19 } from 'nostr-tools';

import { boostNotifiedPubkeys, clientTag, podcastIdentifierTags } from './boost-note';
import { identifierKind, itemId, publisherId, showId } from './pc20-identifiers';

// The guids from the issue's own example note — a real 333-sat boost to
// "Born To Die Young", the one that went unindexed.
const ITEM = 'd2e8e9cc-6f5d-44e6-8144-b7500545fb2d';
const FEED = '910fabab-aa66-5659-88ec-1dcc6eb52d6b';
const PUB = '18bcbf10-6701-4ffb-b255-bc057390d738';

/**
 * NIP-01 tag matching — the same three lines `scripts/local-relay.mjs` uses,
 * and the same thing every real relay does. Reproduced here rather than
 * imported so a change to the local relay can't quietly weaken these tests.
 */
const matchesTag = (tags: string[][], name: string, values: string[]) =>
  tags.some((t) => t[0] === name && values.includes(t[1]));

test('every i tag is followed by the k naming its kind', () => {
  assert.deepEqual(
    podcastIdentifierTags({ itemGuid: ITEM, feedGuid: FEED, publisherGuid: PUB }),
    [
      ['i', `podcast:item:guid:${ITEM}`],
      ['k', 'podcast:item:guid'],
      ['i', `podcast:guid:${FEED}`],
      ['k', 'podcast:guid'],
      ['i', `podcast:publisher:guid:${PUB}`],
      ['k', 'podcast:publisher:guid'],
    ]
  );
});

test('the pairs are interleaved, not grouped at the end', () => {
  // Pinned explicitly so a later tidy-up that collects the k tags into a
  // trailing block has to come here and argue for it. Both shapes work on a
  // relay; this is the one #237 asked for and the one BMB writes.
  const names = podcastIdentifierTags({
    itemGuid: ITEM,
    feedGuid: FEED,
    publisherGuid: PUB,
  }).map((t) => t[0]);
  assert.deepEqual(names, ['i', 'k', 'i', 'k', 'i', 'k']);
});

test('an i tag is never emitted without its k — any combination', () => {
  const guids = [ITEM, undefined];
  const feeds = [FEED, undefined];
  const pubs = [PUB, undefined];
  for (const itemGuid of guids) {
    for (const feedGuid of feeds) {
      for (const publisherGuid of pubs) {
        const tags = podcastIdentifierTags({ itemGuid, feedGuid, publisherGuid });
        const is = tags.filter((t) => t[0] === 'i');
        const ks = tags.filter((t) => t[0] === 'k');
        assert.equal(is.length, ks.length, JSON.stringify({ itemGuid, feedGuid, publisherGuid }));
        // And each k names the kind of the i directly above it.
        for (let n = 0; n < tags.length; n += 2) {
          assert.equal(tags[n][0], 'i');
          assert.equal(tags[n + 1][0], 'k');
          assert.equal(tags[n + 1][1], identifierKind(tags[n][1]));
        }
      }
    }
  }
});

test('the relay filter from #237 matches — the whole point of the change', () => {
  const tags = podcastIdentifierTags({ itemGuid: ITEM, feedGuid: FEED });
  // Literal strings, never the imported constants: a test written against
  // SHOW_KIND cannot catch SHOW_KIND changing out from under the filter, and
  // the filter is the contract. This is verbatim what an indexer sends.
  assert.equal(matchesTag(tags, 'k', ['podcast:guid', 'podcast:item:guid']), true);
});

test('a URL-shaped item guid does not corrupt its k tag', () => {
  // The silent-corruption case the kinds table exists for. "Everything before
  // the last colon" gives `podcast:item:guid:https` — a k no filter matches,
  // i.e. #237 all over again with nothing visibly wrong.
  const url = 'https://example.com/ep/42';
  assert.deepEqual(podcastIdentifierTags({ itemGuid: url }), [
    ['i', `podcast:item:guid:${url}`],
    ['k', 'podcast:item:guid'],
  ]);
});

test('a colon-heavy tag: URI guid does not corrupt its k tag either', () => {
  const uri = 'tag:example.com,2024:ep42';
  assert.deepEqual(podcastIdentifierTags({ itemGuid: uri }), [
    ['i', `podcast:item:guid:${uri}`],
    ['k', 'podcast:item:guid'],
  ]);
});

test('a feed-only boost — an album boost, no track', () => {
  assert.deepEqual(podcastIdentifierTags({ feedGuid: FEED }), [
    ['i', `podcast:guid:${FEED}`],
    ['k', 'podcast:guid'],
  ]);
});

test('an item-only boost — a track whose feed guid never resolved', () => {
  assert.deepEqual(podcastIdentifierTags({ itemGuid: ITEM }), [
    ['i', `podcast:item:guid:${ITEM}`],
    ['k', 'podcast:item:guid'],
  ]);
});

test('a publisher-only boost', () => {
  assert.deepEqual(podcastIdentifierTags({ publisherGuid: PUB }), [
    ['i', `podcast:publisher:guid:${PUB}`],
    ['k', 'podcast:publisher:guid'],
  ]);
});

test('item + feed, no publisher — the common case', () => {
  const tags = podcastIdentifierTags({ itemGuid: ITEM, feedGuid: FEED });
  assert.deepEqual(tags, [
    ['i', `podcast:item:guid:${ITEM}`],
    ['k', 'podcast:item:guid'],
    ['i', `podcast:guid:${FEED}`],
    ['k', 'podcast:guid'],
  ]);
  assert.equal(matchesTag(tags, 'k', ['podcast:publisher:guid']), false);
});

test('no guids at all yields no tags — not a stray k, not a throw', () => {
  // A real state: an album whose feed row has a null guid, boosted from a card
  // that has nothing else to offer.
  assert.deepEqual(podcastIdentifierTags({}), []);
});

test('blank, whitespace and null guids all count as absent', () => {
  for (const empty of [undefined, null, '', '   ']) {
    assert.deepEqual(
      podcastIdentifierTags({ itemGuid: empty, feedGuid: empty, publisherGuid: empty }),
      [],
      JSON.stringify(empty)
    );
  }
  // And a blank one beside a real one drops only itself.
  assert.deepEqual(podcastIdentifierTags({ itemGuid: '  ', feedGuid: FEED }), [
    ['i', `podcast:guid:${FEED}`],
    ['k', 'podcast:guid'],
  ]);
});

test('the client tag is the bare NIP-89 form', () => {
  assert.deepEqual(clientTag(), ['client', 'StableKraft']);
  // Length is the assertion that matters: position 2 would be a
  // 31990:<pubkey>:<d> handler address, and this app publishes no handler
  // event for one to point at.
  assert.equal(clientTag().length, 2);
});

test('the id builders and the kinds table agree', () => {
  // If these two ever drift, identifierKind returns null, the k tag silently
  // disappears, and nothing else breaks — which is how #237 happened.
  assert.equal(identifierKind(itemId('x')), 'podcast:item:guid');
  assert.equal(identifierKind(showId('x')), 'podcast:guid');
  assert.equal(identifierKind(publisherId('x')), 'podcast:publisher:guid');
});

// --- who the note names ------------------------------------------------------
//
// The keys from a real boost of "Kulture Collection" (2026-09-18). The feed
// declares Matt Finlay's npub; the booster is also the MSP 2.0 split recipient.
const ARTIST_NPUB = 'npub12znrejs4k94kp5efhyhk9rzr9jxpy6ymgrlf6py4awpkkhed7cmshs6yg6';
const ARTIST_HEX = '50a63cca15b16b60d329b92f628c432c8c12689b40fe9d0495eb836b5f2df637';
const BOOSTER_HEX = 'f7922a0adb3fa4dda5eecaa62f6f7ee6159f7f55e08036686c68e08382c34788';

/** The decoder BoostButton passes in, minus its logging. */
const decodeNpub = (npub: string): string | null => {
  try {
    const d = nip19.decode(npub);
    return d.type === 'npub' && typeof d.data === 'string' ? d.data : null;
  } catch {
    return null;
  }
};

test('the artist is named, and before the split recipients', () => {
  // Before: mentions came from the splits only, so the text read "@ChadF" and
  // Matt Finlay existed only in a p tag no client shows in the body.
  assert.deepEqual(
    boostNotifiedPubkeys([BOOSTER_HEX], [ARTIST_NPUB], decodeNpub),
    [ARTIST_HEX, BOOSTER_HEX]
  );
});

test('a person who is also a split recipient is named once', () => {
  assert.deepEqual(boostNotifiedPubkeys([ARTIST_HEX], [ARTIST_NPUB], decodeNpub), [ARTIST_HEX]);
  // And a band member listed under several roles is one person.
  assert.deepEqual(
    boostNotifiedPubkeys([], [ARTIST_NPUB, ARTIST_NPUB, ARTIST_NPUB], decodeNpub),
    [ARTIST_HEX]
  );
  assert.deepEqual(boostNotifiedPubkeys([BOOSTER_HEX, BOOSTER_HEX], [], decodeNpub), [BOOSTER_HEX]);
});

test('anything that is not a decodable npub is skipped, never passed through', () => {
  const seen: string[] = [];
  const spy = (npub: string) => (seen.push(npub), decodeNpub(npub));
  assert.deepEqual(
    boostNotifiedPubkeys(
      [],
      [undefined, null, '', 'nsec1notthis', 'https://example.com', 'npub1broken', `  ${ARTIST_NPUB.toUpperCase()}  `],
      spy
    ),
    [ARTIST_HEX]
  );
  // Only npub-prefixed values reach the decoder, normalised to lowercase.
  assert.deepEqual(seen, ['npub1broken', ARTIST_NPUB]);
});

test('a note with nobody to name names nobody', () => {
  assert.deepEqual(boostNotifiedPubkeys([], [], decodeNpub), []);
});
