/**
 * npx tsx --test lib/feeds/podcast-block.test.ts
 *
 * `<podcast:block>`: a feed that blocks StableKraft (by our slug, or a bare
 * `yes`) is not shown, a feed that adds the block later is hidden at its next
 * parse, and one that removes it comes back — without touching `markedDead`,
 * which is Chad's manual hide.
 *
 * The decision and the parser are tested directly. The rest is a source scan,
 * for the reason this file's siblings give (channel-funding.test.ts): a write
 * path or a read path that forgets the field type-checks perfectly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isBlockedFor, podcastBlockFields, STABLEKRAFT_SERVICE_SLUG, type PodcastBlock } from './podcast-block';
import { parsePodcastBlocksFromXML, parseRSSFeed } from '../rss-parser-db';

// --- the decision (spec order) -----------------------------------------------

const bare = (value: 'yes' | 'no'): PodcastBlock => ({ value });
const named = (id: string, value: 'yes' | 'no'): PodcastBlock => ({ id, value });

test('our slug is one constant, spelled once', () => {
  assert.equal(STABLEKRAFT_SERVICE_SLUG, 'stablekraft');
});

test('no block tag, or a bare no, blocks nothing', () => {
  assert.equal(isBlockedFor([]), false);
  assert.equal(isBlockedFor(null), false);
  assert.equal(isBlockedFor(undefined), false);
  assert.equal(isBlockedFor([bare('no')]), false);
});

test('a bare yes blocks every platform, us included', () => {
  assert.equal(isBlockedFor([bare('yes')]), true);
});

test('a yes naming us blocks us; a yes naming another service does not', () => {
  assert.equal(isBlockedFor([named('stablekraft', 'yes')]), true);
  assert.equal(isBlockedFor([named('google', 'yes'), named('amazon', 'yes')]), false);
});

test('a no naming us beats a bare yes (spec step 1 before step 3)', () => {
  assert.equal(isBlockedFor([bare('yes'), named('google', 'no'), named('stablekraft', 'no')]), false);
  assert.equal(isBlockedFor([bare('yes'), named('google', 'no')]), true, 'a no for another service leaves us blocked');
});

test('a no naming us beats a yes naming us (step 1 before step 2)', () => {
  assert.equal(isBlockedFor([named('stablekraft', 'yes'), named('stablekraft', 'no')]), false);
});

test('a yes naming us wins over a bare no', () => {
  assert.equal(isBlockedFor([bare('no'), named('stablekraft', 'yes')]), true);
});

test('the slug comparison ignores case and spaces on the caller side', () => {
  assert.equal(isBlockedFor([named('stablekraft', 'yes')], ' StableKraft '), true);
});

// --- the parser ----------------------------------------------------------------

const rss = (channel: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Album</title>
${channel}
  </channel>
</rss>`;

const ITEM = `<item>
      <title>Song</title>
      <guid isPermaLink="false">item-1</guid>
      <enclosure url="https://example.com/song.mp3" length="1" type="audio/mpeg"/>
    </item>`;

test('reads id and value, trimmed and lower-cased, in either quote style', () => {
  const xml = rss(`
    <podcast:block>Yes</podcast:block>
    <podcast:block id="Google"> no </podcast:block>
    <podcast:block id='stablekraft'>YES</podcast:block>`);
  assert.deepEqual(parsePodcastBlocksFromXML(xml), [
    { value: 'yes' },
    { id: 'google', value: 'no' },
    { id: 'stablekraft', value: 'yes' },
  ]);
});

test('finds block tags that sit AFTER the items (channelMetadataXml)', () => {
  const xml = rss(`    ${ITEM}\n    <podcast:block>yes</podcast:block>`);
  assert.deepEqual(parsePodcastBlocksFromXML(xml), [{ value: 'yes' }]);
});

test('ignores a block tag inside an item: the spec allows it only on <channel>', () => {
  const xml = rss(`    <item><title>x</title><podcast:block>yes</podcast:block></item>`);
  assert.deepEqual(parsePodcastBlocksFromXML(xml), []);
});

test('drops a value that is neither yes nor no, and an empty or self-closing tag', () => {
  const xml = rss(`
    <podcast:block>true</podcast:block>
    <podcast:block id="stablekraft"></podcast:block>
    <podcast:block id="stablekraft"/>`);
  assert.deepEqual(parsePodcastBlocksFromXML(xml), []);
});

test('a self-closing tag does not swallow the value of the tag after it', () => {
  const xml = rss(`
    <podcast:block id="google"/>
    <podcast:block>yes</podcast:block>`);
  assert.deepEqual(parsePodcastBlocksFromXML(xml), [{ value: 'yes' }]);
});

test('reads a CDATA value', () => {
  assert.deepEqual(parsePodcastBlocksFromXML(rss(`<podcast:block><![CDATA[yes]]></podcast:block>`)), [{ value: 'yes' }]);
});

test('does not read a different tag that merely starts with the name', () => {
  assert.deepEqual(parsePodcastBlocksFromXML(rss(`<podcast:blocked>yes</podcast:blocked>`)), []);
});

test('itunes:block is not podcast:block', () => {
  assert.deepEqual(parsePodcastBlocksFromXML(rss(`<itunes:block>Yes</itunes:block>`)), []);
});

test('no channel, no blocks', () => {
  assert.deepEqual(parsePodcastBlocksFromXML('not xml at all'), []);
});

// A real feed: HeyCitizen's test album (stablekraft.app/album/heycitizen-heycitizens-test-album),
// fetched 2026-11-21 from files.heycitizen.xyz/Songs/Albums/TestAlbum/test.xml. Trimmed to the
// channel head and one item. It declares a bare `no` (block nothing) and `<itunes:block>No`.
const HEYCITIZEN = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
    <channel>
        <podcast:block>no</podcast:block>
        <itunes:block>No</itunes:block>
        <title>HeyCitizen&apos;s Test Album</title>
        <itunes:author>HeyCitizen</itunes:author>
        <description>testing rc29 new word</description>
        <link>https://musicindex.org</link>
        <language>en</language>
        <podcast:guid>7ea30e6c-c7ba-5b81-a7be-6465c1591b7a</podcast:guid>
        <podcast:medium>music</podcast:medium>
        <item>
            <title>Test PI with itunes:block and podcast:block</title>
            <guid isPermaLink="false">c7207fae-8746-4b13-8751-a2eae6d8b4dd</guid>
            <enclosure url="https://files.heycitizen.xyz/Songs/Albums/The-Heycitizen-Experience/CheckYourPockets.mp3" length="10451106" type="audio/mpeg"/>
            <itunes:duration>00:05:16</itunes:duration>
        </item>
    </channel>
</rss>`;

test('HeyCitizen test album: a bare no blocks nothing, so the album stays', () => {
  assert.deepEqual(parsePodcastBlocksFromXML(HEYCITIZEN), [{ value: 'no' }]);
  assert.equal(isBlockedFor(parsePodcastBlocksFromXML(HEYCITIZEN)), false);
});

test('HeyCitizen test album: if it switched to a bare yes, it would be hidden', () => {
  const blocking = HEYCITIZEN.replace('<podcast:block>no</podcast:block>', '<podcast:block>yes</podcast:block>');
  assert.equal(isBlockedFor(parsePodcastBlocksFromXML(blocking)), true);
});

test('parseRSSFeed sets `blocked` on every result, false as well as true', async () => {
  const open = await parseRSSFeed('https://example.com/heycitizen.xml', HEYCITIZEN);
  assert.equal(open.blocked, false);
  const shut = await parseRSSFeed(
    'https://example.com/heycitizen.xml',
    HEYCITIZEN.replace('<podcast:block>no</podcast:block>', '<podcast:block id="stablekraft">yes</podcast:block>')
  );
  assert.equal(shut.blocked, true);
});

// --- the field ------------------------------------------------------------------

test('podcastBlockFields writes false as readily as true: removing the block un-hides', () => {
  assert.deepEqual(podcastBlockFields({ blocked: true }), { blocked: true });
  assert.deepEqual(podcastBlockFields({ blocked: false }), { blocked: false });
});

test('podcastBlockFields writes NOTHING for a shape that never looked at the feed', () => {
  assert.deepEqual(podcastBlockFields({}), {});
  assert.deepEqual(podcastBlockFields(null), {});
  assert.deepEqual(podcastBlockFields(undefined), {});
});

// --- the write side: every parse-fed feed write carries it ------------------------

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function tsFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsFiles(path, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

function braceBlock(source: string, from: number): [number, number] | null {
  const open = source.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return [open, i];
  }
  return null;
}

/** Same detector as channel-funding.test.ts: a feed write whose title comes from a parse. */
function feedWritesFedByAParse() {
  const sites: { file: string; variable: string; guarded: boolean }[] = [];
  for (const file of tsFiles(join(root, 'app/api'))) {
    const source = readFileSync(file, 'utf8');
    const call = /prisma\.feed\.(?:create|update|upsert)\s*\(/g;
    let match;
    while ((match = call.exec(source)) !== null) {
      const span = braceBlock(source, call.lastIndex);
      if (!span) continue;
      const body = source.slice(span[0], span[1] + 1);
      const titles = [...body.matchAll(/title:\s*(\w*[Pp]arsed\w*)\.title\s*,/g)];
      for (const variable of new Set(titles.map(t => t[1]))) {
        const wanted = titles.filter(t => t[1] === variable).length;
        const guards = body.split(`podcastBlockFields(${variable})`).length - 1;
        for (let i = 0; i < wanted; i++) sites.push({ file, variable, guarded: guards > i });
      }
    }
  }
  return sites;
}

test('the scan finds the write sites it is meant to guard', () => {
  const sites = feedWritesFedByAParse();
  assert.ok(sites.length >= 13, `expected at least 13 parse-fed feed writes, found ${sites.length}`);
});

test('EVERY feed write fed by a parse also writes `blocked`', () => {
  const missing = feedWritesFedByAParse()
    .filter(site => !site.guarded)
    .map(site => `${site.file.replace(root + '/', '')} (${site.variable})`);
  assert.deepEqual(missing, [], 'add `...podcastBlockFields(<parsed>)` to each:\n' + missing.join('\n'));
});

test('the import path writes it on both halves of its upsert', () => {
  const importer = read('lib/feed-parsing.ts');
  assert.equal(
    importer.split('...podcastBlockFields({ blocked: channelBlocked })').length - 1,
    2,
    'importFeedToDatabase must write `blocked` on the create and the update half'
  );
});

// --- the read side: every surface that hides markedDead hides blocked too ----------

test('every `markedDead: false` filter has a `blocked: false` beside it', () => {
  const gaps: string[] = [];
  for (const file of [...tsFiles(join(root, 'app')), ...tsFiles(join(root, 'lib'))]) {
    // Code only: a comment that names the filter is not a filter.
    const source = readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    const prismaDead = (source.match(/\bmarkedDead: false\b/g) || []).length;
    const prismaBlocked = (source.match(/\bblocked: false\b/g) || []).length;
    const sqlDead = (source.match(/"markedDead" = false/g) || []).length;
    const sqlBlocked = (source.match(/"blocked" = false/g) || []).length;
    if (prismaBlocked < prismaDead || sqlBlocked < sqlDead) {
      gaps.push(`${file.replace(root + '/', '')}: markedDead ${prismaDead}+${sqlDead}, blocked ${prismaBlocked}+${sqlBlocked}`);
    }
  }
  assert.deepEqual(gaps, [], 'hide blocked feeds wherever manual hides are hidden:\n' + gaps.join('\n'));
});

test('the album page never resolves a blocked feed, even when it is the only match', () => {
  // markedDead is collision-scoped there (an album whose only row is hidden still
  // resolves by its link). A block is the artist's choice, so every feed query in
  // the route leaves blocked rows out, and a link to one finds nothing.
  const source = read('app/api/albums/[slug]/route.ts');
  const queries = [...source.matchAll(/prisma\.feed\.find(?:First|Many)\s*\(/g)];
  assert.ok(queries.length >= 10, `expected at least 10 feed queries, found ${queries.length}`);
  const unfiltered = queries
    .map(q => {
      const span = braceBlock(source, q.index! + q[0].length);
      const body = span ? source.slice(span[0], span[1] + 1) : '';
      const where = body.match(/where:\s*\{/);
      const whereSpan = where ? braceBlock(body, where.index! + where[0].length - 1) : null;
      const whereBody = whereSpan ? body.slice(whereSpan[0], whereSpan[1] + 1) : '';
      return { line: source.slice(0, q.index).split('\n').length, ok: /\bblocked: false\b/.test(whereBody) };
    })
    .filter(q => !q.ok)
    .map(q => `line ${q.line}`);
  assert.deepEqual(unfiltered, [], 'add `blocked: false` to the where of each feed query in the album route');
});

test('the Community tab, the playlists and the nightly album import skip blocked feeds', () => {
  assert.match(read('app/api/nostr/global-favorites/route.ts'), /if \(feed\.blocked\) return true;/);
  assert.match(read('lib/album-import.ts'), /if \(existing\.markedDead \|\| existing\.blocked\)/);
  const resolver = read('lib/playlist/resolver.ts');
  assert.ok(resolver.split('Feed: { blocked: false }').length - 1 >= 1, 'the playlist resolver must not resolve a blocked feed’s tracks');
  assert.match(resolver, /\.filter\(row => !row\.Track\?\.Feed\?\.blocked\)/, 'the stored-playlist fast path must drop a blocked feed’s tracks');
});

test('track search skips a blocked feed’s tracks', () => {
  assert.match(read('lib/fuzzy-search.ts'), /AND \(f\.id IS NULL OR f\."blocked" = false\)/);
  assert.match(read('app/api/tracks/search/route.ts'), /Feed: \{ blocked: false \}/);
});

test('a podping refresh that flips the block clears the catalog and search caches', () => {
  const source = read('app/api/feeds/refresh-by-url/route.ts');
  const at = source.indexOf('if (parsedFeed.blocked !== feed.blocked) {');
  assert.notEqual(at, -1, 'refresh-by-url must notice a block that changed');
  const span = braceBlock(source, at + 'if (parsedFeed.blocked !== feed.blocked) '.length);
  const body = source.slice(span![0], span![1] + 1);
  assert.match(body, /invalidateAlbumsFastCache\(\);/);
  assert.match(body, /invalidateSearchCache\(\);/);
});

test('POST /api/feeds refuses to add a feed that blocks us', () => {
  assert.match(read('app/api/feeds/route.ts'), /if \(parsedFeed\.blocked\)/);
});
