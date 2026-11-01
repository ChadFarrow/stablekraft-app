/**
 * Whether a route paints its own opaque full-bleed background over the layout's
 * rocket wallpaper (`/stablekraft-rocket.webp`, app/layout.tsx).
 *
 * The album/podcast page (AlbumDetailClient) and every PlaylistTemplateCompact
 * page paint `buildPageBackgroundStyle` at z-1 over the rocket at z-0, and that
 * layer is opaque in every state — lib/page-background-style.ts, issue #201. So
 * on those routes the rocket is never seen, yet the layout still made every
 * visitor download it: 203 KB, sent with `max-age=0`, measured 2026-11-01. The
 * album page is the second most visited route.
 *
 * On a covered route the layout renders the same element without the image, so
 * the browser never requests it. Nothing visible changes.
 *
 * Dependency-free: the layout's background component and its test import it.
 */

/** Playlist pages that render PlaylistTemplateCompact. lib/layout-background.test.ts keeps this in step with app/playlist. */
export const PLAYLIST_TEMPLATE_PAGES = [
  'b4ts',
  'flowgnar',
  'greatest-hits',
  'hgh',
  'hgh-rss',
  'iam',
  'itdv',
  'itdv-music',
  'itdv-rss',
  'lt',
  'mmm',
  'mmt',
  'sas',
  'tft',
  'upbeats',
] as const;

export function coversLayoutBackground(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (/^\/(album|podcast)\/[^/]+/.test(path)) return true;
  if (path === '/playlist') return true;
  const playlist = path.match(/^\/playlist\/([^/]+)$/);
  return !!playlist && (PLAYLIST_TEMPLATE_PAGES as readonly string[]).includes(playlist[1]);
}
