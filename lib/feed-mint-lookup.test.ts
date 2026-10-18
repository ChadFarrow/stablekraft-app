/**
 * npx tsx --test lib/feed-mint-lookup.test.ts
 *
 * The paths that MINT a Feed row must resolve "does this URL already exist?"
 * through the shared ladder, not a bare `originalUrl` equality (#247).
 *
 * WHAT WENT WRONG. `POST /api/feeds` has used `findFeedIdByUrl` for its own
 * pre-existence check since PR #173 — but two *other* paths also create rows,
 * and both compared `originalUrl` exactly:
 *
 *   app/api/feeds/route.ts                        importMissingAlbums()
 *   app/api/feeds/[id]/process-remote-items       the remoteItem loop
 *
 * `normalizeUrl` ENCODES a literal space to `%20`, so for an already-encoded
 * input the "normalized" and "raw" clauses collapse to the same string and the
 * pair sees only one form. ~69 production rows store `originalUrl` with literal
 * spaces, written by paths deliberately off the ladder. A publisher listing the
 * `%20` form of such a row therefore matched nothing, and the loop minted a
 * second row for an album it already had.
 *
 * WHY THAT IS WORSE THAN A STRAY ROW. The duplicate parses the feed and takes
 * its `<podcast:guid>`. `Feed.guid` is `@unique`, so the original can never
 * reclaim it: every reparse throws `Unique constraint failed on the fields:
 * (guid)`, the route 400s, and the real row — the one holding the tracks — is
 * pinned at `status: 'error'`, which `/api/albums-fast` hides. The catalog then
 * serves the empty duplicate. Measured on production 2026-09-06: 16 albums in
 * that state, one of them ("The Northerns") holding 9 tracks nobody could see.
 * The two rows deadlock, and no reparse anywhere can break it.
 *
 * The id is the tell that this is a same-album collision rather than two feeds
 * that merely resemble each other: `generateFeedId` produced
 * `the-northerns-the-northerns` for BOTH rows — byte-identical — and the code
 * read that collision as a naming inconvenience to be suffixed with a
 * timestamp, rather than as proof the album was already there.
 *
 * A THIRD LOOP WAS MISSED. The publisher step of `feeds/refresh-by-url`
 * (`processRemoteItems`) mints from remoteItems too, and it still compared
 * `originalUrl` exactly. On 2026-10-18 the Strange Love publisher feed named
 * new.musicsideproject.com for two albums stored on msp.podtards.com, and that
 * loop minted an empty `album-<ts>` copy of each — empty because every track
 * guid already belonged to the real row — and would have again on every podping
 * of the publisher. Both remoteItem loops now share `findFeedForRemoteItem`
 * (lib/feed-lookup.ts): the ladder, plus the remoteItem's `feedGuid`, which is
 * the identity that survives a change of host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildFeedUrlLooseVariants, buildFeedUrlVariants, normalizeUrl } from './url-utils';

/** The real pair from the incident, verbatim from the production rows. */
const STORED = 'https://music.behindthesch3m3s.com/wp-content/uploads/The Northerns/the_northerns.xml';
const INCOMING = 'https://music.behindthesch3m3s.com/wp-content/uploads/The%20Northerns/the_northerns.xml';

/**
 * Every route that creates a slug-id Feed row from a URL it was handed.
 * refresh-by-url also mints, but with `album-<ts>` ids, so it has no slug to
 * collide on and is checked through REMOTE_ITEM_PATHS instead.
 */
const MINTING_PATHS = [
  'app/api/feeds/route.ts',
  'app/api/feeds/[id]/process-remote-items/route.ts',
];

/** Every loop that mints a Feed row from a `<podcast:remoteItem>`. */
const REMOTE_ITEM_PATHS = [
  'app/api/feeds/[id]/process-remote-items/route.ts',
  'app/api/feeds/refresh-by-url/route.ts',
];

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('the exact-match rung cannot see the stored row — this is the bug', () => {
  // Both clauses the old code used, spelled out. `normalizeUrl` encodes, so for
  // an already-encoded input they are the same string, and neither is STORED.
  const variants = buildFeedUrlVariants(INCOMING);
  assert.equal(
    variants.includes(STORED),
    false,
    'if the exact rung ever matches STORED this test no longer describes the bug'
  );
  assert.equal(normalizeUrl(INCOMING), INCOMING, 'an encoded URL normalizes to itself');
});

test('the loose rung DOES see it — percent-decoding is what closes the hole', () => {
  const loose = buildFeedUrlLooseVariants(INCOMING);
  assert.ok(
    loose.includes(STORED),
    `loose variants of the %20 form must include the literal-space form.\n  got: ${JSON.stringify(loose, null, 2)}`
  );
});

test('and it works in the other direction too', () => {
  // A row stored encoded, looked up by a literal-space URL. `normalizeUrl`
  // already covered this direction; pinned so a "simplification" of
  // buildFeedUrlLooseVariants cannot quietly drop one side.
  assert.ok(buildFeedUrlLooseVariants(STORED).includes(INCOMING));
});

test('every minting path resolves the URL through the shared ladder', () => {
  for (const file of [...MINTING_PATHS, ...REMOTE_ITEM_PATHS]) {
    const source = read(file);
    assert.ok(
      // findFeedForRemoteItem is the ladder plus the remoteItem's feedGuid.
      source.includes('findFeedIdByUrl(') || source.includes('findFeedForRemoteItem('),
      `${file} creates Feed rows but does not call findFeedIdByUrl — an exact ` +
        `originalUrl compare re-opens #247`
    );
    assert.ok(
      source.includes("from '@/lib/feed-lookup'"),
      `${file} must import the ladder from lib/feed-lookup`
    );
  }
});

test('the exact-originalUrl pre-existence clauses are gone for good', () => {
  // Exact literals rather than a pattern. A regex for `originalUrl: <expr>`
  // cannot tell a LOOKUP clause from the `create({ data: { originalUrl } })`
  // assignment three lines later, and flagging the assignment would make this
  // test noise. These are the two clause sets that actually shipped the bug.
  const REMOVED: Array<[string, string]> = [
    ['app/api/feeds/route.ts',
      'const conditions: any[] = [{ originalUrl: item.feedUrl }];'],
    ['app/api/feeds/[id]/process-remote-items/route.ts',
      '{ originalUrl: normalizedUrl },'],
    ['app/api/feeds/[id]/process-remote-items/route.ts',
      '{ originalUrl: remoteItem.feedUrl }'],
    ['app/api/feeds/refresh-by-url/route.ts',
      'where: { originalUrl: albumFeedUrl },'],
  ];
  for (const [file, gone] of REMOVED) {
    assert.ok(
      !read(file).includes(gone),
      `${file} contains \`${gone}\` again — an exact originalUrl compare in a ` +
        `mint path re-opens #247`
    );
  }
});

test('an id collision is no longer silent', () => {
  // The duplicate mint left no trace anywhere. `console.log` is compiled out of
  // a production build (next.config.js removeConsole, exclude error+warn), so
  // the warning has to be console.warn to exist where it matters.
  //
  // Anchored on `idExists` rather than on `Date.now()`: both files use
  // `Date.now()` elsewhere (a fallback base id, a synthetic track id), and
  // anchoring on the first one inspected the wrong site entirely.
  for (const file of MINTING_PATHS) {
    const source = read(file);
    const idx = source.indexOf('if (idExists');
    assert.notEqual(idx, -1, `${file}: expected an id-collision branch to guard`);
    const branch = source.slice(idx, idx + 900);
    assert.ok(
      branch.includes('console.warn'),
      `${file} suffixes a colliding feed id with a timestamp but logs no ` +
        `console.warn in that branch — that is how #247 stayed invisible`
    );
    assert.ok(
      branch.indexOf('console.warn') < branch.indexOf('Date.now()'),
      `${file}: warn before minting the suffixed id, not after`
    );
  }
});

test('every remoteItem loop asks findFeedForRemoteItem, with the feedGuid', () => {
  // The URL alone is not enough: a publisher feed can list an album under a host
  // the row was never stored under, and only the guid survives that.
  for (const file of REMOTE_ITEM_PATHS) {
    const call = read(file).match(/findFeedForRemoteItem\(([^)]*)\)/);
    assert.ok(call, `${file} mints from remoteItems without findFeedForRemoteItem — re-opens #247`);
    assert.match(call[1], /,\s*\S/, `${file}: pass the remoteItem's feedGuid, not just its URL`);
  }
});

test('the shared remoteItem lookup keeps both halves', () => {
  const source = read('lib/feed-lookup.ts');
  const start = source.indexOf('export async function findFeedForRemoteItem');
  assert.notEqual(start, -1, 'findFeedForRemoteItem is gone from lib/feed-lookup.ts');
  const body = source.slice(start);
  assert.ok(body.includes('findFeedIdByUrl('), 'findFeedForRemoteItem must go through the URL ladder');
  assert.ok(
    body.includes('guid: feedGuid'),
    'findFeedForRemoteItem must match the remoteItem feedGuid against Feed.guid'
  );
});
