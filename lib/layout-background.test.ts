import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { coversLayoutBackground, PLAYLIST_TEMPLATE_PAGES } from './layout-background';

test('album, podcast and playlist-template pages cover the layout rocket', () => {
  for (const p of [
    '/album/054525df-0123-5647-8421-dd9083e56636',
    '/album/beach-trash/demo',
    '/podcast/homegrown-hits',
    '/playlist',
    '/playlist/hgh',
    '/playlist/itdv-music',
    '/playlist/upbeats/',
  ]) {
    assert.equal(coversLayoutBackground(p), true, p);
  }
});

// These show the rocket: they paint no background of their own.
test('the home page, list pages and everything else keep the rocket', () => {
  for (const p of ['/', '/album', '/podcast', '/playlist/index', '/playlist/maker', '/playlist/export', '/favorites', '/search', '/publisher/x', '/admin', '', null, undefined]) {
    assert.equal(coversLayoutBackground(p as any), false, String(p));
  }
});

// The list is a hand-copy of which app/playlist pages render
// PlaylistTemplateCompact. A new template page missing from it only costs bytes;
// a page wrongly ON it would lose its wallpaper — so both directions are checked.
test('PLAYLIST_TEMPLATE_PAGES matches the app/playlist pages that render PlaylistTemplateCompact', () => {
  const dir = join(process.cwd(), 'app/playlist');
  const usesTemplate = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'page.tsx')))
    .filter((d) => /PlaylistTemplateCompact/.test(readFileSync(join(dir, d.name, 'page.tsx'), 'utf8')))
    .map((d) => d.name)
    .sort();
  assert.deepEqual([...PLAYLIST_TEMPLATE_PAGES].sort(), usesTemplate);
  assert.match(readFileSync(join(dir, 'page.tsx'), 'utf8'), /PlaylistTemplateCompact/, '/playlist itself renders the template');
});

test('the album and podcast routes render AlbumDetailClient, which paints the opaque layer', () => {
  for (const f of ['app/album/[id]/page.tsx', 'app/podcast/[id]/page.tsx']) {
    assert.match(readFileSync(join(process.cwd(), f), 'utf8'), /AlbumDetailClient/, f);
  }
  assert.match(readFileSync(join(process.cwd(), 'app/album/[id]/AlbumDetailClient.tsx'), 'utf8'), /buildPageBackgroundStyle/);
  assert.match(readFileSync(join(process.cwd(), 'components/PlaylistTemplateCompact.tsx'), 'utf8'), /buildPageBackgroundStyle/);
});
