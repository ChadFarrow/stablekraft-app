/**
 * The per-item block lookup behind every `parseItem*FromXML` (value splits,
 * persons, images, funding). The parsed title arrives DECODED, so a title the
 * feed wrote with `&apos;` or a numeric reference must still find its block —
 * it did not, and three real tracks lost their own funding link (2026-11-01).
 *
 *   npx tsx --test lib/feeds/item-block.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeXmlText, findItemBlockByTitle } from './item-block';
import {
  parseItemFundingFromXML,
  parseItemPersonsFromXML,
  parseItemPodcastImagesFromXML,
  parseItemV4VFromXML,
} from '../rss-parser-db';

const feed = (...items: string[]) => `<?xml version="1.0"?><rss><channel><title>Album</title>${items.join('')}</channel></rss>`;
const item = (rawTitle: string, body = '') => `<item><title>${rawTitle}</title><guid>${rawTitle.length}-${body.length}</guid>${body}</item>`;

test('decodeXmlText: named and numeric references, in one pass', () => {
  assert.equal(decodeXmlText('It&apos;s &quot;A&quot; &amp; B &lt;C&gt;'), `It's "A" & B <C>`);
  assert.equal(decodeXmlText('It&#39;s &#x27;x&#x27; &#8217;y&#8217;'), `It's 'x' ’y’`);
  assert.equal(decodeXmlText('&#x1F3B8;'), '\u{1F3B8}');
  assert.equal(decodeXmlText('&amp;lt;'), '&lt;', 'single pass: &amp;lt; is the text "&lt;", not "<"');
  assert.equal(decodeXmlText('&nbsp; &bogus; &#0; &#x110000;'), '&nbsp; &bogus; &#0; &#x110000;', 'unknown or out-of-range stays as written');
});

test('a title written with &apos; finds its own block (the reported bug)', () => {
  const xml = feed(item('Intro', '<a>1</a>'), item('It&apos;s All Over', '<a>2</a>'));
  assert.match(findItemBlockByTitle(xml, "It's All Over") ?? '', /<a>2<\/a>/);
});

test('every way to write an apostrophe or a quote mark', () => {
  for (const [raw, parsed] of [
    ['K&apos;as-tu fait de nous?', "K'as-tu fait de nous?"],
    ['Grand&#39;ma Is A Cyborg Now', "Grand'ma Is A Cyborg Now"],
    ['Grand&#x27;ma', "Grand'ma"],
    ['Don&#8217;t Stop', 'Don’t Stop'],
    ['Say &quot;Yes&quot;', 'Say "Yes"'],
    ["It's Plain", "It's Plain"],
  ]) {
    const xml = feed(item('Other'), item(raw, '<hit/>'));
    assert.match(findItemBlockByTitle(xml, parsed) ?? '', /<hit\/>/, raw);
  }
});

test('what the old lookup matched still matches', () => {
  const xml = feed(
    item('Rock &amp; Roll', '<a>amp</a>'),
    item('<![CDATA[It\'s CDATA & raw]]>', '<a>cdata</a>'),
    item('<![CDATA[Lit &amp; eral]]>', '<a>cdata-amp</a>'),
    item('MiXeD CaSe', '<a>case</a>'),
    item('What? (Live) [2024] $5 + tax', '<a>regex</a>'),
  );
  assert.match(findItemBlockByTitle(xml, 'Rock & Roll') ?? '', /amp/);
  assert.match(findItemBlockByTitle(xml, "It's CDATA & raw") ?? '', /<a>cdata</);
  assert.match(findItemBlockByTitle(xml, 'Lit &amp; eral') ?? '', /cdata-amp/, 'CDATA text as written');
  assert.match(findItemBlockByTitle(xml, 'Lit & eral') ?? '', /cdata-amp/, 'and decoded');
  assert.match(findItemBlockByTitle(xml, 'mixed case') ?? '', /<a>case/, 'case is ignored, as before');
  assert.match(findItemBlockByTitle(xml, 'What? (Live) [2024] $5 + tax') ?? '', /regex/, 'regex characters are text');
});

test('whitespace around the title, and no partial matches', () => {
  const xml = feed(item('\n    It&apos;s All Over\n  ', '<a>ws</a>'));
  assert.match(findItemBlockByTitle(xml, "It's All Over") ?? '', /ws/);
  assert.equal(findItemBlockByTitle(xml, "It's All"), undefined);
  assert.equal(findItemBlockByTitle(xml, "It's All Over Again"), undefined);
  assert.equal(findItemBlockByTitle(xml, 'Nothing'), undefined);
});

test('two items with one title: the first wins, as before', () => {
  const xml = feed(item('Intro', '<a>first</a>'), item('Intro', '<a>second</a>'));
  assert.match(findItemBlockByTitle(xml, 'Intro') ?? '', /first/);
});

// One feed through all four real parsers: the apostrophe track gets ITS data, not the first item's.
const realFeed = feed(
  item('Intro', [
    '<podcast:funding url="https://example.com/album">Album</podcast:funding>',
    '<podcast:person role="vocals">Band Singer</podcast:person>',
    '<podcast:image href="https://example.com/intro.jpg" width="3000"/>',
    '<podcast:value type="lightning" method="keysend"><podcast:valueRecipient name="Band" type="node" address="02aaa" split="100"/></podcast:value>',
  ].join('')),
  item('It&apos;s All Over', [
    '<podcast:funding url="https://shop.example.com/its-all-over">Buy this track</podcast:funding>',
    '<podcast:person role="guitar">Guest Player</podcast:person>',
    '<podcast:image href="https://example.com/its-all-over.jpg" width="3000"/>',
    '<podcast:value type="lightning" method="keysend"><podcast:valueRecipient name="Guest" type="node" address="03bbb" split="100"/></podcast:value>',
  ].join('')),
);
const T = "It's All Over";

test('funding: the track keeps its own link', () => {
  assert.deepEqual(parseItemFundingFromXML(realFeed, T), [{ url: 'https://shop.example.com/its-all-over', message: 'Buy this track' }]);
});

test('persons: the track keeps its own person', () => {
  assert.deepEqual(parseItemPersonsFromXML(realFeed, T).map((p) => p.name), ['Guest Player']);
});

test('images: the track keeps its own image', () => {
  assert.deepEqual(parseItemPodcastImagesFromXML(realFeed, T).map((i) => i.href), ['https://example.com/its-all-over.jpg']);
});

test('value: the track keeps its own split — before, a boost fell back to the album split', () => {
  const v4v = parseItemV4VFromXML(realFeed, T);
  assert.equal(v4v.recipient, '03bbb');
  assert.deepEqual(v4v.value?.recipients?.map((r: { name: string }) => r.name), ['Guest']);
});

test('no copy of the old re-encoding lookup is left in the parser', () => {
  const src = readFileSync(new URL('../rss-parser-db.ts', import.meta.url), 'utf8');
  assert.equal(src.includes('xmlEncodedTitle'), false, 'a parseItem*FromXML re-encodes the title again');
  assert.equal((src.match(/findItemBlockByTitle\(xmlText, itemTitle\)/g) || []).length, 4, 'value, persons, images and funding all use the shared lookup');
});
