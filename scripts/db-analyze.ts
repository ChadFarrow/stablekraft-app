import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function analyze() {
  console.log("=== DATABASE CLEANUP ANALYSIS ===\n");

  // 1. Empty audioUrl tracks
  const emptyAudio = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM "Track" WHERE "audioUrl" = ''
  `;
  console.log("1. EMPTY audioUrl TRACKS:", emptyAudio[0].count);

  // 2. Orphaned session favorites (older than 90 days, no userId)
  const orphanTracks = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM "FavoriteTrack"
    WHERE "userId" IS NULL
    AND "createdAt" < NOW() - INTERVAL '90 days'
  `;
  const orphanAlbums = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM "FavoriteAlbum"
    WHERE "userId" IS NULL
    AND "createdAt" < NOW() - INTERVAL '90 days'
  `;
  console.log("2. ORPHANED SESSION FAVORITES (>90 days, no userId):");
  console.log("   FavoriteTrack:", orphanTracks[0].count);
  console.log("   FavoriteAlbum:", orphanAlbums[0].count);

  // 3. Duplicate tracks (same audioUrl + title)
  const dupes = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM (
      SELECT "audioUrl", "title"
      FROM "Track"
      WHERE "audioUrl" != ''
      GROUP BY "audioUrl", "title"
      HAVING COUNT(*) > 1
    ) sub
  `;
  console.log("3. DUPLICATE TRACK SETS:", dupes[0].count);

  // Show some examples of duplicates
  if (dupes[0].count > 0) {
    const dupeExamples = await prisma.$queryRaw<
      { audioUrl: string; title: string; count: number }[]
    >`
      SELECT "audioUrl", "title", COUNT(*)::int as count
      FROM "Track"
      WHERE "audioUrl" != ''
      GROUP BY "audioUrl", "title"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `;
    console.log("\n   Top duplicate examples:");
    dupeExamples.forEach((d) => {
      console.log(`   - "${d.title}" (${d.count} copies)`);
    });
  }

  // 4. Table sizes
  const sizes = await prisma.$queryRaw<
    { table_name: string; total_size: string; row_count: number }[]
  >`
    SELECT
      s.relname as table_name,
      pg_size_pretty(pg_total_relation_size(s.relid)) as total_size,
      COALESCE(t.n_live_tup, 0)::int as row_count
    FROM pg_catalog.pg_statio_user_tables s
    LEFT JOIN pg_stat_user_tables t ON s.relid = t.relid
    ORDER BY pg_total_relation_size(s.relid) DESC
  `;
  console.log("\n4. TABLE SIZES:");
  console.table(sizes);

  // 5. Unused indexes (0 scans)
  const unusedIndexes = await prisma.$queryRaw<
    { indexrelname: string; idx_scan: number; idx_tup_read: number }[]
  >`
    SELECT indexrelname, idx_scan::int, idx_tup_read::int
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
    ORDER BY indexrelname
  `;
  console.log("\n5. UNUSED INDEXES (0 scans - potential for removal):");
  if (unusedIndexes.length === 0) {
    console.log("   All indexes have been used.");
  } else {
    console.table(unusedIndexes);
  }

  // 6. Most used indexes
  const topIndexes = await prisma.$queryRaw<
    { indexrelname: string; idx_scan: number }[]
  >`
    SELECT indexrelname, idx_scan::int
    FROM pg_stat_user_indexes
    ORDER BY idx_scan DESC
    LIMIT 10
  `;
  console.log("\n6. MOST USED INDEXES:");
  console.table(topIndexes);

  // 7. Total database size
  const dbSize = await prisma.$queryRaw<{ size: string }[]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log("\n7. TOTAL DATABASE SIZE:", dbSize[0].size);

  // 8. Check for tracks with v4vValue that might need indexing
  const v4vTracks = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM "Track" WHERE "v4vValue" IS NOT NULL
  `;
  const v4vFeeds = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM "Feed" WHERE "v4vValue" IS NOT NULL
  `;
  console.log("\n8. V4V DATA (needs JSONB index for fast queries):");
  console.log("   Tracks with v4vValue:", v4vTracks[0].count);
  console.log("   Feeds with v4vValue:", v4vFeeds[0].count);

  await prisma.$disconnect();
}

analyze().catch((e) => {
  console.error(e);
  process.exit(1);
});
