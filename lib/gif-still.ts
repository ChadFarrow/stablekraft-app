/**
 * Still frames for animated (GIF) covers on grid cards.
 *
 * 17 catalogue covers were GIFs on 2026-11-01, and 12 of them were 13-41 MB
 * (Autumn Rust 40.7 MB, 12 Rods Tour Eclipse 40.3 MB, Polar Embrace 39.2 MB…).
 * AlbumCard drew each one whole in a 175 px card, so one card on the first
 * phone screen of the home page was 40 MB of the page's 47. The optimizer
 * cannot shrink an animation, so a card now shows a still first frame from
 * /api/gif-placeholder at GIF_STILL_WIDTH; the album page keeps the animation.
 *
 * That route used to refuse anything over MAX_IMAGE_BYTES (12 MB) — every big
 * cover. It may now read up to CATALOG_GIF_MAX_BYTES, but ONLY for a URL that
 * is a catalogue cover: the route fetches a caller-supplied URL, and the
 * catalogue host binding (lib/proxy-host-allowlist.ts) still ships in log mode,
 * so a bigger read for "any public host" would let anyone make this server
 * download 64 MB per request.
 *
 * Dependency-free: AlbumCard (browser) and the route both import it.
 */

/** 175 px cards at 3x ask for 525; desktop cards (≤300 px at 2x) for ≤600. */
export const GIF_STILL_WIDTH = 640;

/** Above the largest catalogue GIF on 2026-11-01 (41 MB), with headroom. */
export const CATALOG_GIF_MAX_BYTES = 64 * 1024 * 1024;

export function gifStillSrc(coverUrl: string, width: number = GIF_STILL_WIDTH): string {
  return `/api/gif-placeholder?url=${encodeURIComponent(coverUrl)}&w=${width}`;
}

/** `w` from the query: clamped to 64..1024; missing or not a positive number → null, the original size. */
export function parseStillWidth(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(1024, Math.max(64, n));
}

/** Our own ?skv=<version> (lib/feeds/image-version-url.ts) may be on either side. */
function withoutVersion(url: string): string | null {
  try {
    const u = new URL(url);
    u.searchParams.delete('skv');
    return u.toString();
  } catch {
    return null;
  }
}

export function isCatalogCover(url: string, covers: Set<string>): boolean {
  if (covers.has(url)) return true;
  const bare = withoutVersion(url);
  if (!bare) return false;
  for (const c of covers) if (withoutVersion(c) === bare) return true;
  return false;
}

/** How many bytes the still-frame route may read for this URL. */
export function gifByteCap(url: string, covers: Set<string>, defaultCap: number): number {
  return isCatalogCover(url, covers) ? CATALOG_GIF_MAX_BYTES : defaultCap;
}
