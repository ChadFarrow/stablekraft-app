/**
 * npx tsx --test lib/feeds/channel-funding.test.ts
 *
 * `Feed.funding` holds a feed's `<podcast:funding>` links. A channel field is
 * written from every route that parses a feed — thirteen writes across eight
 * routes, the same set `channel-persons.test.ts` guards — and one route that
 * drops it is a refresh path that never lands the link. That type-checks
 * perfectly, so the guard is a source scan, as it is for persons.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { channelFundingFields } from './channel-funding';

const PAYPAL = 'https://www.paypal.com/donate/?hosted_button_id=ATL9BD9EQRSNN';

test('a parse that found links yields the field', () => {
  const funding = [{ url: PAYPAL, message: 'Support our music' }];
  assert.deepEqual(channelFundingFields({ funding }), { funding });
});

test('a parse that found none yields NOTHING, not an empty list', () => {
  assert.deepEqual(channelFundingFields({ funding: [] }), {});
  assert.deepEqual(channelFundingFields({}), {});
  assert.deepEqual(channelFundingFields(null), {});
  assert.deepEqual(channelFundingFields(undefined), {});
  assert.deepEqual(channelFundingFields({ funding: 'nope' as any }), {});
});

// --- the scan -------------------------------------------------------------

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const parserSource = read('lib/rss-parser-db.ts');

test('the parse result carries channel and item funding at all', () => {
  assert.match(parserSource, /const channelFunding = parseChannelFundingFromXML\(xmlText\);/);
  assert.match(parserSource, /funding: channelFunding\.length > 0 \? channelFunding : undefined/);
  assert.match(parserSource, /parsedItem\.funding = itemFunding;/, 'parseRSSFeed no longer keeps item-level funding');
  assert.match(
    parserSource,
    /if \(matchedItem\.funding && matchedItem\.funding\.length > 0\) updateData\.funding = matchedItem\.funding;/,
    'applyParsedItemFields no longer writes Track.funding, so no reparse lands it'
  );
});

test('the import path writes it too', () => {
  const importer = read('lib/feed-parsing.ts');
  assert.equal(
    importer.split('...channelFundingFields({ funding: channelFunding })').length - 1,
    2,
    'importFeedToDatabase must write funding on both the create and the update half of its upsert'
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

/** Every feed create/update/upsert whose data comes from a parse (see channel-persons.test.ts). */
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
        const guards = body.split(`channelFundingFields(${variable})`).length - 1;
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

test('EVERY feed write fed by a parse also writes the channel funding', () => {
  const missing = feedWritesFedByAParse()
    .filter(site => !site.guarded)
    .map(site => `${site.file.replace(process.cwd() + '/', '')} (${site.variable})`);
  assert.deepEqual(missing, [], 'add `...channelFundingFields(<parsed>)` to each:\n' + missing.join('\n'));
});

// --- the read side ----------------------------------------------------------
//
// `/api/albums/[slug]` builds its own album shape (CLAUDE.md: two album shapes),
// and it used to hard-code `funding: null` — which is why the album page's
// "More Ways to Support" block never rendered.

const albumRouteSource = read('app/api/albums/[slug]/route.ts');

function blockAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `could not find \`${marker}\``);
  const span = braceBlock(source, at + marker.length - 1);
  assert.ok(span);
  return source.slice(span[0], span[1] + 1);
}

test('the album route selects and returns track-level funding, re-checked', () => {
  assert.match(blockAfter(albumRouteSource, 'const TRACK_SELECT_FIELDS = {'), /\bfunding: true\b/);
  assert.match(blockAfter(albumRouteSource, 'function mapTrackToResponse('), /\bfunding: fundingFromJson\(track\.funding\)/);
});

test('EVERY album the route builds from a feed returns its funding, re-checked', () => {
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
  assert.ok(blocks.length >= 2, `expected at least 2 \`foundAlbum = {\` objects, found ${blocks.length}`);
  const missing = blocks
    .map((block, i) => ({ i, block }))
    .filter(({ block }) => !/\bfunding: fundingFromJson\(\(feed as any\)\.funding\)/.test(block))
    .map(({ i }) => `foundAlbum object #${i + 1}`);
  assert.deepEqual(missing, [], 'these album objects drop Feed.funding');
});
