/**
 * npx tsx --test lib/feeds/channel-persons.test.ts
 *
 * `Feed.persons` is where a feed's own Nostr keys live — the `<podcast:person>`
 * entries and the npubs carried by `<podcast:txt>` at channel level. They
 * become the `p` tags on a boost note, so a row without them boosts to nobody.
 *
 * It used to have ONE writer, `importFeedToDatabase`, which only the import
 * path reaches. Every refresh route parses through `parseRSSFeedWithSegments`,
 * wrote every other channel field — title, artist, guid, medium, podcastImages
 * — and left this one alone, so a key added to a feed already in the catalog
 * could never land however often the feed was reparsed. There are THIRTEEN such
 * writes across eight routes.
 *
 * That is the field-written-from-N-places family CLAUDE.md warns about, and the
 * reason for a source scan: a missed call site is a refresh path that keeps
 * dropping the key, it type-checks perfectly, and no unit test of the helper
 * would ever notice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { channelPersonsFields } from './channel-persons';

test('a parse that found people yields the field', () => {
  const persons = [{ name: 'Nat Hills', npub: 'npub1abc' }];
  assert.deepEqual(channelPersonsFields({ persons }), { persons });
});

test('a parse that found nobody yields NOTHING, not an empty list', () => {
  // The spread must be a no-op. Writing [] would erase what an earlier parse
  // stored, and a feed that declares nobody is indistinguishable here from one
  // whose tag this parser could not reach.
  assert.deepEqual(channelPersonsFields({ persons: [] }), {});
  assert.deepEqual(channelPersonsFields({}), {});
  assert.deepEqual(channelPersonsFields(null), {});
  assert.deepEqual(channelPersonsFields(undefined), {});
});

test('a non-array value is refused rather than written through', () => {
  assert.deepEqual(channelPersonsFields({ persons: 'nope' as any }), {});
});

// --- the scan -------------------------------------------------------------

const PARSER = join(process.cwd(), 'lib/rss-parser-db.ts');
const parserSource = readFileSync(PARSER, 'utf8');

test('the parse result carries channel persons at all', () => {
  // Without this the spread below has nothing to spread, on every route at once.
  assert.match(parserSource, /persons\?: ParsedPerson\[\];/, 'ParsedFeed lost its persons field');
  assert.match(
    parserSource,
    /persons: channelPersons\.length > 0 \? channelPersons : undefined/,
    'parseRSSFeed no longer returns the channel persons it parsed'
  );
});

function routeFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) routeFiles(path, found);
    else if (entry.endsWith('.ts')) found.push(path);
  }
  return found;
}

/** The balanced `{ … }` that starts at or after `from`. */
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

/**
 * Every `prisma.feed.create/update/upsert` whose written data comes from a
 * parse — identified by `title: <something parsed>.title`, the field every one
 * of them writes and nothing else does.
 */
function feedWritesFedByAParse() {
  const sites: { file: string; variable: string; guarded: boolean }[] = [];
  for (const file of routeFiles(join(process.cwd(), 'app/api'))) {
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
        const guards = body.split(`channelPersonsFields(${variable})`).length - 1;
        for (let i = 0; i < wanted; i++) {
          sites.push({ file, variable, guarded: guards > i });
        }
      }
    }
  }
  return sites;
}

test('the scan finds the write sites it is meant to guard', () => {
  const sites = feedWritesFedByAParse();
  assert.ok(
    sites.length >= 13,
    `expected at least 13 parse-fed feed writes, found ${sites.length} — the scan has stopped seeing them, ` +
      'so every assertion below would pass vacuously'
  );
});

test('EVERY feed write fed by a parse also writes the channel persons', () => {
  const missing = feedWritesFedByAParse()
    .filter(site => !site.guarded)
    .map(site => `${site.file.replace(process.cwd() + '/', '')} (${site.variable})`);
  assert.deepEqual(
    missing,
    [],
    'these feed writes take their metadata from a parse but drop persons — ' +
      'add `...channelPersonsFields(<parsed>)` to each:\n' + missing.join('\n')
  );
});

// --- the read side ----------------------------------------------------------
//
// Writing the column is half of it. The boost note gets its `p` tags from the
// `persons` prop BoostButton is handed, and that comes from whatever album
// object the page fetched. `/api/albums/[slug]` builds its own album shape
// rather than using lib/catalog/album-shape.ts, and it returned no persons at
// all — so on 2026-09-18 an album-page boost of a feed whose row held the
// artist's npub tagged nobody but the booster. The home grid had the same gap
// one step later, in the field-by-field mapper in app/page.tsx.

const ALBUM_ROUTE = join(process.cwd(), 'app/api/albums/[slug]/route.ts');
const albumRouteSource = readFileSync(ALBUM_ROUTE, 'utf8');

function blockAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `could not find \`${marker}\` — the scan has lost its anchor`);
  const span = braceBlock(source, at + marker.length - 1);
  assert.ok(span, `no balanced block after \`${marker}\``);
  return source.slice(span[0], span[1] + 1);
}

test('the album page route selects and returns track-level persons', () => {
  assert.match(
    blockAfter(albumRouteSource, 'const TRACK_SELECT_FIELDS = {'),
    /\bpersons: true\b/,
    'TRACK_SELECT_FIELDS no longer selects persons'
  );
  assert.match(
    blockAfter(albumRouteSource, 'function mapTrackToResponse('),
    /\bpersons: track\.persons\b/,
    'mapTrackToResponse no longer returns persons'
  );
});

test('EVERY album the album page route builds from a feed carries its persons', () => {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const at = albumRouteSource.indexOf('foundAlbum = {', from);
    if (at === -1) break;
    const span = braceBlock(albumRouteSource, at);
    if (!span) break;
    blocks.push(albumRouteSource.slice(span[0], span[1] + 1));
    from = span[1];
  }
  assert.ok(
    blocks.length >= 2,
    `expected at least 2 \`foundAlbum = {\` objects, found ${blocks.length} — the scan has stopped seeing them`
  );
  const missing = blocks
    .map((block, i) => ({ i, block }))
    .filter(({ block }) => !/\bpersons: \(feed as any\)\.persons\b/.test(block))
    .map(({ i }) => `foundAlbum object #${i + 1}`);
  assert.deepEqual(missing, [], 'these album objects drop Feed.persons, so their boosts tag no artist');
});

test('the home grid mapper keeps album-level persons for AlbumCard', () => {
  const pageSource = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
  assert.match(
    blockAfter(pageSource, 'allAlbums.map((album: any): RSSAlbum => ({'),
    /\bpersons: album\.persons\b/,
    'the app/page.tsx albums mapper drops persons — bump API_VERSION when restoring it'
  );
});

// Only five of fourteen BoostButton call sites pass a persons prop. The rest —
// playlists, favorites, the now-playing bar, track cards — rely on BoostButton's
// own lookups at boost time, so those two routes must carry persons too.

test('the track lookup BoostButton makes returns persons at track and feed level', () => {
  const source = readFileSync(join(process.cwd(), 'app/api/music-tracks/[id]/route.ts'), 'utf8');
  assert.match(blockAfter(source, 'Feed: {'), /\bpersons: true\b/, 'the Feed select no longer includes persons');
  assert.match(source, /\n\s+persons: track\.persons\b/, 'the response no longer carries track persons');
  assert.match(source, /\bpersons: track\.Feed\.persons\b/, 'the response Feed no longer carries feed persons');
});

test('the feed lookup BoostButton makes returns persons', () => {
  const source = readFileSync(join(process.cwd(), 'app/api/feeds/[id]/route.ts'), 'utf8');
  assert.match(source, /\bpersons: feed\.persons\b/, '/api/feeds/[id] no longer returns persons');
});

test('BoostButton names the persons from its lookups, not only from its prop', () => {
  const source = readFileSync(join(process.cwd(), 'components/Lightning/BoostButton.tsx'), 'utf8');
  assert.match(
    source,
    /collectPersonNpubs\(\s*persons,\s*trackData\?\.persons,\s*trackData\?\.Feed\?\.persons,\s*feedPersons\s*\)/,
    'BoostButton no longer gathers persons from the track and feed lookups'
  );
  assert.match(source, /feedPersons = feedData\.persons/, 'BoostButton no longer keeps the feed lookup persons');
});
