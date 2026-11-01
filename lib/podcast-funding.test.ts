/**
 * npx tsx --test lib/podcast-funding.test.ts
 *
 * `<podcast:funding>` is a link the album page and the boost dialog render as an
 * `href`, so the reader is also a security boundary: only http(s) leaves it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FUNDING_LINKS_MAX,
  FUNDING_MESSAGE_MAX,
  channelFundingXml,
  fundingFromJson,
  parseChannelFundingFromXML,
  parseFundingFromBlock,
  safeFundingUrl,
} from './podcast-funding';

const PAYPAL = 'https://www.paypal.com/donate/?hosted_button_id=ATL9BD9EQRSNN';

// The Doerfels' "Bloodshot Lies - The Album" feed, trimmed: the channel's tag
// sits BEFORE the items there; MSP-made feeds put channel tags after them.
const feed = (channelTags: string, items: string, trailing = '') => `<?xml version="1.0"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel>
<title>Bloodshot Lies - The Album</title>
${channelTags}
${items}
${trailing}
</channel></rss>`;

test('reads the paired form, url and label', () => {
  const xml = feed(`<podcast:funding url="${PAYPAL}">Value for Value, Support our music CLICK HERE</podcast:funding>`, '');
  assert.deepEqual(parseChannelFundingFromXML(xml), [
    { url: PAYPAL, message: 'Value for Value, Support our music CLICK HERE' },
  ]);
});

test('reads a self-closing tag, with an empty label', () => {
  assert.deepEqual(parseFundingFromBlock(`<podcast:funding url="https://patreon.com/x"/>`), [
    { url: 'https://patreon.com/x', message: '' },
  ]);
});

test('channel tags AFTER the items are found too', () => {
  const xml = feed('', '<item><title>Track 1</title></item>', `<podcast:funding url="${PAYPAL}">Support</podcast:funding>`);
  assert.deepEqual(parseChannelFundingFromXML(xml).map(f => f.url), [PAYPAL]);
});

test("an item's tag is NOT the channel's", () => {
  const xml = feed(
    `<podcast:funding url="https://example.com/band">Band</podcast:funding>`,
    `<item><title>Track 1</title><podcast:funding url="https://example.com/track">Track</podcast:funding></item>`
  );
  assert.deepEqual(parseChannelFundingFromXML(xml).map(f => f.url), ['https://example.com/band']);
});

test("a liveItem's tag is NOT the channel's", () => {
  const xml = feed(
    '',
    `<podcast:liveItem status="live"><title>Live</title><podcast:funding url="https://example.com/live">Live</podcast:funding></podcast:liveItem>`
  );
  assert.deepEqual(parseChannelFundingFromXML(xml), []);
});

test('an unclosed item does not swallow the channel tags after it', () => {
  const xml = feed(`<podcast:funding url="https://example.com/a">A</podcast:funding>`, '<item><title>broken');
  assert.deepEqual(parseChannelFundingFromXML(xml).map(f => f.url), ['https://example.com/a']);
});

test('only http and https survive — the value becomes an href', () => {
  const hostile = [
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    // Has a hostname, so a host check alone lets it through — and as an href
    // the `//example.com/` is a comment and the line after it runs.
    'javascript://example.com/%0Aalert(1)',
    'ftp://example.com/file',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'lightning:lnurl1xyz',
    'nostr:npub1xyz',
    '//evil.example/x',
    '/relative/path',
    'not a url',
    '',
  ];
  for (const url of hostile) {
    assert.deepEqual(parseFundingFromBlock(`<podcast:funding url="${url}">x</podcast:funding>`), [], url);
  }
  // Entity-encoded scheme: decoded first, then refused.
  assert.deepEqual(parseFundingFromBlock(`<podcast:funding url="&#106;avascript:alert(1)">x</podcast:funding>`), []);
});

test('must-still-work: real support links pass unchanged, whatever the service', () => {
  // The button opens whatever the tag names — not only PayPal.
  for (const url of [
    PAYPAL,
    'https://cash.app/$TheDoerfels',
    'https://venmo.com/u/The-Doerfels',
    'https://account.venmo.com/u/The-Doerfels',
    'https://www.patreon.com/thedoerfels',
    'https://ko-fi.com/a?b=c&d=e',
    'https://buymeacoffee.com/someone',
    'https://thedoerfels.bandcamp.com/merch',
    'http://example.com/tip',
  ]) {
    const xml = `<podcast:funding url="${url.replace(/&/g, '&amp;')}">x</podcast:funding>`;
    assert.deepEqual(parseFundingFromBlock(xml).map(f => f.url), [new URL(url).toString()], url);
  }
});

test('a tag without url is skipped, never filled from its text', () => {
  // ITDV's reader falls back to the text; a label is not a link.
  assert.deepEqual(parseFundingFromBlock(`<podcast:funding>https://example.com</podcast:funding>`), []);
});

test('single quotes, CDATA, entities and inner whitespace are handled', () => {
  assert.deepEqual(
    parseFundingFromBlock(`<podcast:funding url='https://example.com/x'><![CDATA[ Tip  the
      band &amp; crew ]]></podcast:funding>`),
    [{ url: 'https://example.com/x', message: 'Tip the band & crew' }]
  );
  assert.deepEqual(parseFundingFromBlock(`<podcast:funding url="https://e.com/">Rock &amp; roll</podcast:funding>`)[0].message, 'Rock & roll');
});

test('markup in the label is removed', () => {
  assert.equal(
    parseFundingFromBlock(`<podcast:funding url="https://e.com/">Hi <b>there</b></podcast:funding>`)[0].message,
    'Hi there'
  );
});

test('a long label is cut to the namespace limit', () => {
  const [link] = parseFundingFromBlock(`<podcast:funding url="https://e.com/">${'x'.repeat(500)}</podcast:funding>`);
  assert.equal(link.message.length, FUNDING_MESSAGE_MAX);
  assert.ok(link.message.endsWith('…'));
});

test('duplicates by URL collapse to the first', () => {
  const block = `<podcast:funding url="${PAYPAL}">One</podcast:funding><podcast:funding url="${PAYPAL}">Two</podcast:funding>`;
  assert.deepEqual(parseFundingFromBlock(block), [{ url: PAYPAL, message: 'One' }]);
});

test('several distinct links keep document order, up to the cap', () => {
  const block = Array.from({ length: 12 }, (_, i) => `<podcast:funding url="https://e.com/${i}">${i}</podcast:funding>`).join('');
  const links = parseFundingFromBlock(block);
  assert.equal(links.length, FUNDING_LINKS_MAX);
  assert.deepEqual(links.map(l => l.message), ['0', '1', '2', '3', '4', '5', '6', '7']);
});

test('a look-alike tag name does not match', () => {
  assert.deepEqual(parseFundingFromBlock(`<podcast:fundingGoal url="https://e.com/">x</podcast:fundingGoal>`), []);
});

test('channelFundingXml keeps channel tags and drops item bodies', () => {
  const xml = feed('<podcast:guid>g</podcast:guid>', '<item><title>T</title><guid>i</guid></item>');
  const out = channelFundingXml(xml);
  assert.match(out, /podcast:guid/);
  assert.doesNotMatch(out, /<title>T<\/title>/);
});

// --- the read side -----------------------------------------------------------

test('fundingFromJson re-checks what the database returns', () => {
  assert.deepEqual(
    fundingFromJson([
      { url: PAYPAL, message: 'Support' },
      { url: 'javascript:alert(1)', message: 'evil' },
      { url: 42 },
      null,
      'nope',
      { url: PAYPAL, message: 'duplicate' },
      { url: 'https://e.com/no-label' },
    ]),
    [
      { url: PAYPAL, message: 'Support' },
      { url: 'https://e.com/no-label', message: '' },
    ]
  );
});

test('fundingFromJson answers undefined for nothing, so the key is omitted', () => {
  assert.equal(fundingFromJson(null), undefined);
  assert.equal(fundingFromJson(undefined), undefined);
  assert.equal(fundingFromJson([]), undefined);
  assert.equal(fundingFromJson({ url: PAYPAL }), undefined);
  assert.equal(fundingFromJson([{ url: 'javascript:x' }]), undefined);
});

test('safeFundingUrl refuses non-strings', () => {
  assert.equal(safeFundingUrl(undefined), null);
  assert.equal(safeFundingUrl({}), null);
  assert.equal(safeFundingUrl(PAYPAL), PAYPAL);
});
