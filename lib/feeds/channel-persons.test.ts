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
