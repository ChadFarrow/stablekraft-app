import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { searchMusicFeedsByArtist, mintAlbumFromPiFeed } from '@/lib/album-import';

/**
 * POST /api/admin/publishers/import-albums
 * Import missing album feeds using Podcast Index API search by artist name.
 * No direct Wavlake fetching — all lookups go through PI API.
 * Body: { publisherId?: string } - optional, if not provided imports for all publishers
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { publisherId } = body;

    // Get publishers to process. Music-show-only publishers are excluded —
    // their albums must be imported via the playlist resolver (only when a
    // curated music show references them), not via this PI-API sweep.
    const publishers = await prisma.feed.findMany({
      where: {
        type: 'publisher',
        status: 'active',
        musicShowOnly: false,
        ...(publisherId ? { id: publisherId } : {})
      },
      select: {
        id: true,
        title: true,
        artist: true,
        originalUrl: true
      }
    });

    if (publishers.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No publishers found'
      }, { status: 404 });
    }

    console.log(`🚀 Processing ${publishers.length} publisher(s) for album import via PI API`);

    // Artist-level MSO gate: any artist with at least one MSO publisher row
    // is off-limits to PI-search-based album imports, even if duplicate
    // non-MSO publisher rows exist for the same artist. Without this, the
    // cron PI-searched the unflagged duplicate and re-minted every album
    // the user just deleted.
    const msoPublishers = await prisma.feed.findMany({
      where: { type: 'publisher', musicShowOnly: true },
      select: { artist: true, title: true },
    });
    const msoArtistKeys = new Set<string>();
    for (const p of msoPublishers) {
      const key = (p.artist || p.title || '').trim().toLowerCase();
      if (key) msoArtistKeys.add(key);
    }

    // Deduplicate PI API searches: multiple publishers may share the same artist name
    const searchedArtists = new Set<string>();

    const results: Array<{
      publisherId: string;
      title: string;
      piResults: number;
      imported: number;
      importedFeedIds: string[];
      skipped: number;
      failed: number;
      errors: string[];
      skippedDetails: string[];
    }> = [];

    for (const publisher of publishers) {
      const result = {
        publisherId: publisher.id,
        title: publisher.title || publisher.id,
        piResults: 0,
        imported: 0,
        importedFeedIds: [] as string[],
        skipped: 0,
        failed: 0,
        errors: [] as string[],
        skippedDetails: [] as string[]
      };

      const artistName = publisher.artist || publisher.title;
      if (!artistName) {
        result.errors.push('No artist name');
        results.push(result);
        continue;
      }

      const artistKeyMso = artistName.trim().toLowerCase();
      if (artistKeyMso && msoArtistKeys.has(artistKeyMso)) {
        console.log(`   ⏭️ Artist "${artistName}" has MSO publisher row elsewhere — skipping`);
        result.skippedDetails.push(`mso-artist:${artistName}`);
        result.skipped++;
        results.push(result);
        continue;
      }

      try {
        console.log(`\n📋 Processing: ${publisher.title} (artist: "${artistName}")`);

        // Deduplicate: skip PI search if we already searched this artist
        const artistKey = artistName.toLowerCase();
        let piFeeds: any[] = [];

        if (searchedArtists.has(artistKey)) {
          console.log(`   ⏭️ Already searched PI for "${artistName}", skipping search`);
        } else {
          searchedArtists.add(artistKey);
          piFeeds = await searchMusicFeedsByArtist(artistName);
          result.piResults = piFeeds.length;
          console.log(`   Found ${piFeeds.length} music feeds on PI for "${artistName}"`);
        }

        // Process each PI result via the shared minting helper.
        for (const piFeed of piFeeds) {
          try {
            const mint = await mintAlbumFromPiFeed(piFeed, { publisherId: publisher.id });
            if (mint.status === 'imported') {
              console.log(`   ✅ ${mint.detail}`);
              result.imported++;
              result.importedFeedIds.push(mint.feedId);
              await new Promise(r => setTimeout(r, 100));
            } else if (mint.status === 'skipped') {
              result.skippedDetails.push(mint.detail);
              result.skipped++;
            }
          } catch (error) {
            result.failed++;
            result.errors.push(`${piFeed.title}: ${error instanceof Error ? error.message : 'Unknown'}`);
          }
        }

        // Link existing unlinked albums by artist name
        if (artistName) {
          await prisma.feed.updateMany({
            where: {
              artist: { equals: artistName, mode: 'insensitive' },
              type: { in: ['album', 'music', 'podcast'] },
              publisherId: null
            },
            data: { publisherId: publisher.id }
          });
        }

      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      }

      results.push(result);
    }

    const totals = {
      publishers: results.length,
      imported: results.reduce((s, r) => s + r.imported, 0),
      skipped: results.reduce((s, r) => s + r.skipped, 0),
      failed: results.reduce((s, r) => s + r.failed, 0)
    };

    console.warn(`\n✅ Complete: ${totals.imported} imported, ${totals.skipped} skipped, ${totals.failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Processed ${totals.publishers} publishers: ${totals.imported} albums imported`,
      totals,
      // Flat list of feed IDs created this run — the nightly workflow's
      // Step 5c reparses each one from its real RSS (PI API misses
      // podcast:episode track order, chapters, and VTS).
      importedFeedIds: results.flatMap(r => r.importedFeedIds),
      results
    });

  } catch (error) {
    console.error('Error importing publisher albums:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
