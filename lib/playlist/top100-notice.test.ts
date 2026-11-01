/**
 * The Top 100 page's empty state, and the old /playlist/top100-music page.
 *
 *   npx tsx --test lib/playlist/top100-notice.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { top100EmptyNotice } from './top100-notice';

// The chart's own timestamp since it went empty: 2026-08-21T10:05:01Z.
const LAST = 1787306701;

test('an empty chart names the source and the date it went empty', () => {
  assert.equal(
    top100EmptyNotice(0, 0, LAST),
    'The Podcast Index Top 100 music chart has been empty since August 21, 2026. Tracks will appear here when the chart updates again.',
  );
});

test('an empty chart with no usable timestamp still says what is empty', () => {
  assert.match(top100EmptyNotice(0, 0, 0) ?? '', /^The Podcast Index Top 100 music chart is empty right now\./);
  assert.match(top100EmptyNotice(0, 0, Number.NaN) ?? '', /is empty right now/);
});

test('a chart whose entries match no playable audio says so', () => {
  assert.equal(top100EmptyNotice(42, 0, LAST), 'None of the 42 tracks on the Podcast Index Top 100 music chart could be matched to playable audio.');
});

test('no notice while anything is playable', () => {
  assert.equal(top100EmptyNotice(100, 1, LAST), undefined);
  assert.equal(top100EmptyNotice(100, 87, LAST), undefined);
});

test('/playlist/top100-music redirects to /playlist/top100 and asks for no missing route', () => {
  const page = readFileSync(new URL('../../app/playlist/top100-music/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /permanentRedirect\('\/playlist\/top100'\)/);
  assert.equal(/apiEndpoint|PlaylistTemplateCompact/.test(page), false, 'the page must not load a playlist: /api/playlist/top100-music never existed');
  assert.equal(page.includes("'use client'"), false, 'a server redirect answers 308 before any client code loads');
});

test('the Top 100 route sends the notice and the template shows it', () => {
  const route = readFileSync(new URL('../../app/api/playlist/top100/route.ts', import.meta.url), 'utf8');
  assert.match(route, /emptyNotice: top100EmptyNotice\(data\.items\.length, tracks\.length, data\.timestamp\)/);
  const tpl = readFileSync(new URL('../../components/PlaylistTemplateCompact.tsx', import.meta.url), 'utf8');
  assert.match(tpl, /emptyNotice \|\| 'No tracks available in this playlist'/);
});
