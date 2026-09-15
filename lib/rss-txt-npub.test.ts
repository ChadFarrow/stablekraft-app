/**
 * npx tsx --test lib/rss-txt-npub.test.ts
 *
 * Pins that a Nostr key published as `<podcast:txt>` reaches `persons`.
 *
 * Two forms carry the same fact — "this is my Nostr identity" — and only
 * `<podcast:person npub="…">` was read. A feed that stated it as
 * `<podcast:txt purpose="nostr">npub1…</podcast:txt>` therefore produced a
 * boost note with no `p` tag for its band, and nothing anywhere said so: the
 * feed parsed cleanly and simply looked like it named nobody.
 *
 * Both entry points fold it in, so the npub lands in `Feed.persons` /
 * `Track.persons` — the one store `BoostButton` already reads to build its
 * `p` tags. No new column, no migration.
 *
 * The LAYOUT half matters as much as the tag half, and is the reason these two
 * concerns share a test file. `parseChannelPersonsFromXML` used to slice
 * "everything up to the first `<item>`", and the MSP-generated music feeds —
 * which are where these npubs mostly come from — put their channel metadata
 * AFTER the last item. The tag support alone would have found nothing on the
 * feeds it was written for. See `channelMetadataXml` in rss-parser-db.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseChannelPersonsFromXML, parseItemPersonsFromXML } from './rss-parser-db';

const NPUB = 'npub19wt0r7wx4z3wev94g7j7349hjv82lmal7th344dqqj08erjmdl8q7wjus8';
const NPUB_TWO = 'npub1ru90lyadj4232h64gcnt7t87g8frgaeqdqq7qpt36qhs6f4yly2qewmkly';

const ITEMS = `
    <item>
      <title>Track one</title>
      <guid isPermaLink="false">item-guid-1</guid>
    </item>`;

const wrap = (inner: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>A feed</title>${inner}</channel></rss>`;

const npubsOf = (persons: { npub?: string }[]) => persons.map(p => p.npub).filter(Boolean);

test('a channel <podcast:txt> npub becomes a person entry', () => {
  const xml = wrap(`<podcast:txt purpose="nostr">${NPUB}</podcast:txt>${ITEMS}`);
  const persons = parseChannelPersonsFromXML(xml);
  assert.deepEqual(npubsOf(persons), [NPUB]);
});

test('a channel npub declared AFTER the items is found — the MSP layout', () => {
  // Legal RSS, and what the MSP feeds emit. The old pre-item slice returned [].
  const xml = wrap(`${ITEMS}<podcast:txt purpose="nostr">${NPUB}</podcast:txt>`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB]);
});

test('a <podcast:person> declared after the items is found too', () => {
  // Same slice, same silent miss — the person path shared the bug.
  const xml = wrap(`${ITEMS}<podcast:person npub="${NPUB}">Nat Hills</podcast:person>`);
  const persons = parseChannelPersonsFromXML(xml);
  assert.equal(persons.length, 1);
  assert.equal(persons[0].name, 'Nat Hills');
  assert.equal(persons[0].npub, NPUB);
});

test('an item-level <podcast:txt> npub becomes a person entry on that track', () => {
  const xml = wrap(`
    <item>
      <title>Track one</title>
      <podcast:txt purpose="nostr">${NPUB}</podcast:txt>
    </item>`);
  assert.deepEqual(npubsOf(parseItemPersonsFromXML(xml, 'Track one')), [NPUB]);
});

test('the txt npub does not leak from one item into another', () => {
  const xml = wrap(`
    <item><title>Track one</title><podcast:txt purpose="nostr">${NPUB}</podcast:txt></item>
    <item><title>Track two</title></item>`);
  assert.deepEqual(npubsOf(parseItemPersonsFromXML(xml, 'Track two')), []);
});

test('a key stated BOTH ways is carried once, and the named entry wins', () => {
  // Two p-tags for one pubkey is what this prevents. The person entry keeps its
  // name and role; the txt duplicate is dropped rather than appended nameless.
  const xml = wrap(`
    <podcast:person role="artist" npub="${NPUB}">Nat Hills</podcast:person>
    <podcast:txt purpose="nostr">${NPUB.toUpperCase()}</podcast:txt>${ITEMS}`);
  const persons = parseChannelPersonsFromXML(xml);
  assert.equal(persons.length, 1);
  assert.equal(persons[0].name, 'Nat Hills');
  assert.equal(persons[0].role, 'artist');
});

test('two different keys both survive, in document order', () => {
  const xml = wrap(`
    <podcast:txt purpose="nostr">${NPUB}</podcast:txt>
    <podcast:txt purpose="npub">${NPUB_TWO}</podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB, NPUB_TWO]);
});

test('the same key repeated is emitted once', () => {
  const xml = wrap(`
    <podcast:txt purpose="nostr">${NPUB}</podcast:txt>
    <podcast:txt purpose="verify">${NPUB}</podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB]);
});

test('the nostr: URI form and CDATA are both accepted', () => {
  const xml = wrap(`<podcast:txt purpose="nostr"><![CDATA[ nostr:${NPUB} ]]></podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB]);
});

test('purpose is not matched — the payload is what decides', () => {
  // `purpose` is free text and feeds spell this several ways. Matching the
  // bech32 payload instead is both wider and safer than guessing the spelling.
  const xml = wrap(`<podcast:txt purpose="some-new-word">${NPUB}</podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB]);
});

test('a txt tag that is not a key is ignored, whatever its purpose', () => {
  // Every one of these is real: our own playlists emit source-feed, and
  // verification tokens are the commonest use of podcast:txt in the wild.
  const xml = wrap(`
    <podcast:txt purpose="source-feed">https://feeds.rssblue.com/upbeats</podcast:txt>
    <podcast:txt purpose="applepodcastsverify">7a2f4c19-not-a-key</podcast:txt>
    <podcast:txt>Sample text for the feed</podcast:txt>
    <podcast:txt purpose="nostr">npub1tooshort</podcast:txt>
    <podcast:txt purpose="nostr">nsec19wt0r7wx4z3wev94g7j7349hjv82lmal7th344dqqj08erjmdl8q7wjus8</podcast:txt>${ITEMS}`);
  assert.deepEqual(parseChannelPersonsFromXML(xml), []);
});

test('a key inside a sentence is found — the value need not be bare', () => {
  // Real feeds write the tag both ways, and the artist who prompted this could
  // not be read from here to settle which. Neither shape may be assumed.
  const xml = wrap(`<podcast:txt purpose="nostr">Follow me on Nostr: ${NPUB} — boosts welcome</podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB]);
});

test('two keys in one txt value are both found', () => {
  const xml = wrap(`<podcast:txt purpose="nostr">${NPUB}, ${NPUB_TWO}</podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB, NPUB_TWO]);
});

test('an UPPERCASE key is normalised, because readers match a literal npub1', () => {
  const xml = wrap(`<podcast:txt purpose="nostr">${NPUB.toUpperCase()}</podcast:txt>${ITEMS}`);
  assert.deepEqual(npubsOf(parseChannelPersonsFromXML(xml)), [NPUB]);
});

test('an over-long bech32 run yields nothing, not a truncated key', () => {
  // A longer identifier is a DIFFERENT identifier. Taking its first 63 chars
  // would p-tag a plausible-looking pubkey that belongs to nobody.
  const xml = wrap(`<podcast:txt purpose="nostr">${NPUB}extra0longer</podcast:txt>${ITEMS}`);
  assert.deepEqual(parseChannelPersonsFromXML(xml), []);
});

test('a feed with no txt tags is unchanged', () => {
  const xml = wrap(`<podcast:person role="artist">Nat Hills</podcast:person>${ITEMS}`);
  const persons = parseChannelPersonsFromXML(xml);
  assert.equal(persons.length, 1);
  assert.equal(persons[0].npub, undefined);
});
