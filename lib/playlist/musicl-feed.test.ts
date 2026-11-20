/**
 * npx tsx --test lib/playlist/musicl-feed.test.ts
 *
 * Each test replays one fault from #309 against the shared playlist writer
 * and reader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  PODCAST_NS,
  buildMinimalPlaylistXml,
  cdata,
  isListMedium,
  isUuid,
  readXmlAttr,
  remoteItemTracks,
} from './musicl-feed';
import { playlistGuid, podcastGuidFromUrl } from './musicl-guid';

const GUID = '11111111-2222-5333-8444-555555555555';
const base = {
  guid: GUID,
  title: 'T',
  author: 'A',
  description: 'D',
  link: 'https://x.example/',
  tracks: [{ feedGuid: 'f1', itemGuid: 'i1' }],
};

test('the namespace is podcastindex.org/namespace/1.0', () => {
  const xml = buildMinimalPlaylistXml(base);
  assert.ok(xml.includes(`xmlns:podcast="${PODCAST_NS}"`));
  assert.equal(PODCAST_NS, 'https://podcastindex.org/namespace/1.0');
});

test('an HTML description is CDATA, so & and an unclosed <br> stay valid XML', () => {
  for (const html of ['Songs from Mutton, Mead & Music', 'line<br>two', 'a ]]> b', '<p>ok</p>']) {
    const xml = buildMinimalPlaylistXml({ ...base, descriptionHtml: html });
    assert.equal(XMLValidator.validate(xml), true, html);
    const parsed = new XMLParser({ cdataPropName: '__cdata' }).parse(xml);
    const d = parsed.rss.channel.description;
    const text = Array.isArray(d.__cdata) ? d.__cdata.join('') : d.__cdata;
    assert.equal(text, html);
  }
  assert.equal(cdata('a]]>b'), '<![CDATA[a]]]]><![CDATA[>b]]>');
});

test('a guid is required, any UUID version is kept, and it is never minted', () => {
  assert.throws(() => buildMinimalPlaylistXml({ ...base, guid: '' }), /podcast:guid/);
  const v7 = '0190f3a2-7b1c-7cde-8f00-123456789abc';
  assert.equal(isUuid(v7), true);
  assert.equal(playlistGuid(v7), v7);
  assert.equal(playlistGuid(null, null), null);
  assert.equal(playlistGuid('', 'https://example.com/pl.xml'), podcastGuidFromUrl('https://example.com/pl.xml'));
  assert.equal(playlistGuid('', 'https://example.com/pl.xml'), playlistGuid('', 'https://example.com/pl.xml'));
});

test('podcastGuidFromUrl matches the podcast:guid spec vector', () => {
  assert.equal(podcastGuidFromUrl('https://podnews.net/rss'), '9b024349-ccf0-5f69-a609-6b82873eab3c');
});

test('the publisher back-link is written and is not a track', () => {
  const pub = 'aaaaaaaa-0000-5000-8000-000000000000';
  const xml = buildMinimalPlaylistXml({ ...base, publisher: { feedGuid: pub, feedUrl: 'https://p.example/pub.xml' } });
  assert.ok(xml.includes(`<podcast:remoteItem medium="publisher" feedGuid="${pub}" feedUrl="https://p.example/pub.xml"/>`));
  assert.equal(remoteItemTracks(xml).length, 1);
  assert.throws(() => buildMinimalPlaylistXml({ ...base, publisher: { feedGuid: 'nope' } }), /publisher/);
});

test('remoteItems are read by name, in any order and with either quote', () => {
  const xml = `<podcast:remoteItem feedGuid="F1" itemGuid="I1"/>
    <podcast:remoteItem itemGuid="I2" feedGuid="F2"/>
    <podcast:remoteItem feedGuid='F3' itemGuid='I3'/>
    <podcast:remoteItem medium="publisher" feedGuid="P"/>
    <podcast:remoteItem feedGuid="F4" itemGuid="https://e.example/?p=1&amp;ep=2"/>`;
  assert.deepEqual(
    remoteItemTracks(xml).map((t) => `${t.feedGuid}|${t.itemGuid}`),
    ['F1|I1', 'F2|I2', 'F3|I3', 'F4|https://e.example/?p=1&ep=2']
  );
  // An attribute name inside another one's name is not read as it.
  assert.equal(readXmlAttr('<podcast:remoteItem x-feedGuid="no" feedGuid="yes"/>', 'feedGuid'), 'yes');
});

test('list mediums are an allowlist', () => {
  assert.equal(isListMedium('musicL'), true);
  assert.equal(isListMedium('podcastL'), true);
  assert.equal(isListMedium('music'), false);
  assert.equal(isListMedium('publisher'), false);
  assert.equal(isListMedium(undefined), false);
});
