import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { searchMusicFeedsByArtist, mintAlbumFromPiFeed } from '@/lib/album-import';
import { normalizeArtistName, feedUrlHost } from '@/lib/url-utils';
import { invalidateAlbumsFastCache } from '@/lib/caches/albums-fast-cache';
import { invalidateSearchCache } from '@/lib/caches/search-cache';

/**
 * POST /api/admin/artists/import-new-albums
 *
 * Auto-discover NEW album feeds from artists ALREADY on the site, even when the
 * artist has no publisher feed. This closes the gap that let self-hosted artists
 * (e.g. leuenbergmusic.com) miss new releases: Step 5b
 * (`/api/admin/publishers/import-albums`) only PI-searches artists that have a
 * `type='publisher'` row, so an artist with just album feeds is never searched.
 *
 * Mechanism: build a map of every existing artist → the set of hosts their album
 * feeds live on, PI-search each artist by name, and import a found album ONLY
 * when its feed URL host matches one the artist already uses. The host-match is
 * the disambiguator — a bare artist-name search returns multiple unrelated
 * artists, but requiring the host to match an existing album makes the mint safe
 * without a publisher feed.
 *
 * Scope: Wavlake hosts are dropped (every Wavlake album shares `wavlake.com`, so
 * host-match there is meaningless — and Wavlake artists are already covered by
 * their publisher rows in Step 5b). Artists that already have any publisher row
 * are skipped (Step 5b owns them; this also excludes music-show-only publishers,
 * whose albums must not auto-import).
 *
 * Paginated over the DISTINCT ELIGIBLE ARTIST list (the host map is always built
 * from the full catalog so an artist's hosts are never split across pages).
 * Body: { dryRun?: boolean, limit?: number (default 50, max 200), offset?: number }
 * Callers loop until `nextOffset` is null. All PI calls hit PodcastIndex
 * (search/byterm, episodes/byfeedid), never Wavlake.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PI_SEARCH_DELAY_MS = 250;
const WAVLAKE_HOST = 'wavlake.com';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun: boolean = Boolean(body?.dryRun);
    const limit: number =
      typeof body?.limit === 'number' && body.limit > 0
        ? Math.min(Math.floor(body.limit), MAX_LIMIT)
        : DEFAULT_LIMIT;
    const offset: number =
      typeof body?.offset === 'number' && body.offset > 0 ? Math.floor(body.offset) : 0;

    // --- Build artist → known-hosts map from the FULL album catalog ----------
    // Two small columns over the whole catalog is cheap, and building the map
    // from everything (not just this page) keeps an artist's host set complete
    // regardless of how the artist list is paginated below.
    const albumFeeds = await prisma.feed.findMany({
      where: {
        type: { in: ['album', 'music'] },
        status: 'active',
        markedDead: false,
        blocked: false,
        artist: { not: null },
      },
      select: { artist: true, originalUrl: true },
    });

    // key(normalized artist) -> { display: original artist string, hosts: Set }
    const artistMap = new Map<string, { display: string; hosts: Set<string> }>();
    for (const f of albumFeeds) {
      const artist = (f.artist || '').trim();
      if (!artist) continue;
      const key = normalizeArtistName(artist);
      if (!key) continue;
      let entry = artistMap.get(key);
      if (!entry) {
        entry = { display: artist, hosts: new Set<string>() };
        artistMap.set(key, entry);
      }
      const host = feedUrlHost(f.originalUrl || '');
      // Drop Wavlake and unparseable hosts from the matchable set — see the
      // scope note in the header docblock.
      if (host && host !== WAVLAKE_HOST) entry.hosts.add(host);
    }

    // --- Subtract artists that shouldn't be swept ----------------------------
    // (1) Any artist with a publisher row — Step 5b owns them, and this also
    //     excludes music-show-only publishers (MSO ⊆ publisher rows) whose
    //     albums must never auto-import.
    const publisherRows = await prisma.feed.findMany({
      where: { type: 'publisher' },
      select: { artist: true, title: true },
    });
    const publisherArtistKeys = new Set<string>();
    for (const p of publisherRows) {
      const key = normalizeArtistName(p.artist || p.title || '');
      if (key) publisherArtistKeys.add(key);
    }

    // Eligible = has ≥1 non-Wavlake host AND no publisher row. Sorted for stable
    // offset paging across calls.
    const eligibleKeys = Array.from(artistMap.entries())
      .filter(([key, entry]) => entry.hosts.size > 0 && !publisherArtistKeys.has(key))
      .map(([key]) => key)
      .sort();

    const totalArtists = eligibleKeys.length;
    const pageKeys = eligibleKeys.slice(offset, offset + limit);
    const nextOffset = offset + pageKeys.length < totalArtists ? offset + limit : null;

    // --- Sweep this page's artists -------------------------------------------
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const importedFeedIds: string[] = [];
    const wouldImport: Array<{ artist: string; title: string; feedUrl: string }> = [];
    const errors: string[] = [];
    // Guard against searching the same artist twice within a page (keys are
    // already distinct, but this mirrors Step 5b's dedup defensively).
    const searchedArtists = new Set<string>();

    for (const key of pageKeys) {
      const entry = artistMap.get(key);
      if (!entry) continue;
      if (searchedArtists.has(key)) continue;
      searchedArtists.add(key);

      try {
        const piFeeds = await searchMusicFeedsByArtist(entry.display);

        for (const piFeed of piFeeds) {
          const candHost = feedUrlHost(piFeed.url || piFeed.originalUrl || '');
          // Host-match gate: candidate must live on a host this artist already
          // uses (never Wavlake). This is what makes the name-search safe.
          if (!candHost || candHost === WAVLAKE_HOST || !entry.hosts.has(candHost)) {
            skipped++;
            continue;
          }

          try {
            const mint = await mintAlbumFromPiFeed(piFeed, { publisherId: null, dryRun });
            if (mint.status === 'imported') {
              console.log(`   ✅ ${entry.display}: ${mint.detail}`);
              imported++;
              importedFeedIds.push(mint.feedId);
              await new Promise((r) => setTimeout(r, 100));
            } else if (mint.status === 'wouldImport') {
              wouldImport.push({ artist: entry.display, title: mint.title, feedUrl: mint.feedUrl });
              imported++;
            } else {
              skipped++;
            }
          } catch (error) {
            failed++;
            errors.push(`${entry.display} / ${piFeed.title}: ${error instanceof Error ? error.message : 'Unknown'}`);
          }
        }
      } catch (error) {
        failed++;
        errors.push(`${entry.display}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }

      await delay(PI_SEARCH_DELAY_MS);
    }

    // A live run that minted anything invalidates the read-path caches, same as
    // the publisher import / mark-dead flows.
    if (!dryRun && importedFeedIds.length > 0) {
      invalidateAlbumsFastCache();
      invalidateSearchCache();
    }

    return NextResponse.json({
      success: true,
      message: `Swept ${pageKeys.length} artists (offset ${offset}/${totalArtists}): ${imported} ${dryRun ? 'would import' : 'imported'}`,
      dryRun,
      totalArtists,
      nextOffset,
      totals: { artists: pageKeys.length, imported, skipped, failed },
      // Feed IDs created this run — the nightly workflow reparses each from its
      // real RSS (Step 5c pattern) to fix track order / chapters / VTS that PI
      // misses.
      importedFeedIds,
      ...(dryRun ? { wouldImport } : {}),
      ...(errors.length ? { errors } : {}),
    });
  } catch (error) {
    console.error('Error importing new albums for existing artists:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
