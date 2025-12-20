import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DuplicateSet {
  audioUrl: string;
  title: string;
  count: number;
}

interface TrackDuplicate {
  id: string;
  feedId: string;
  feedTitle: string | null;
  title: string;
  audioUrl: string;
  createdAt: Date;
  publishedAt: Date | null;
  status: string;
  hasV4v: boolean;
}

async function findDuplicates() {
  console.log("=== DUPLICATE TRACK ANALYSIS ===\n");

  // Find all duplicate sets
  const duplicateSets = await prisma.$queryRaw<DuplicateSet[]>`
    SELECT "audioUrl", "title", COUNT(*)::int as count
    FROM "Track"
    WHERE "audioUrl" != ''
    GROUP BY "audioUrl", "title"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `;

  console.log(`Found ${duplicateSets.length} sets of duplicate tracks\n`);

  // Analyze each set
  let totalDuplicates = 0;
  const recommendations: {
    keep: string;
    remove: string[];
    reason: string;
    title: string;
  }[] = [];

  for (const set of duplicateSets) {
    // Get all tracks in this duplicate set
    const tracks = await prisma.$queryRaw<TrackDuplicate[]>`
      SELECT
        t.id,
        t."feedId",
        f.title as "feedTitle",
        t.title,
        t."audioUrl",
        t."createdAt",
        t."publishedAt",
        t.status,
        (t."v4vValue" IS NOT NULL) as "hasV4v"
      FROM "Track" t
      LEFT JOIN "Feed" f ON t."feedId" = f.id
      WHERE t."audioUrl" = ${set.audioUrl}
        AND t.title = ${set.title}
      ORDER BY t."createdAt" ASC
    `;

    totalDuplicates += tracks.length - 1; // -1 for the one we keep

    // Determine which to keep:
    // Priority: 1) Has v4v data, 2) status = 'active', 3) Oldest (first imported)
    let keepTrack = tracks[0];
    for (const track of tracks) {
      if (track.hasV4v && !keepTrack.hasV4v) {
        keepTrack = track;
      } else if (track.status === "active" && keepTrack.status !== "active") {
        keepTrack = track;
      }
    }

    const removeIds = tracks.filter((t) => t.id !== keepTrack.id).map((t) => t.id);

    recommendations.push({
      keep: keepTrack.id,
      remove: removeIds,
      reason: keepTrack.hasV4v
        ? "has v4v data"
        : keepTrack.status === "active"
          ? "is active"
          : "oldest",
      title: set.title,
    });
  }

  console.log(`Total duplicate tracks to remove: ${totalDuplicates}\n`);

  // Show first 20 examples with details
  console.log("=== FIRST 20 DUPLICATE SETS ===\n");
  for (let i = 0; i < Math.min(20, recommendations.length); i++) {
    const rec = recommendations[i];
    console.log(`${i + 1}. "${rec.title}"`);
    console.log(`   Keep: ${rec.keep} (${rec.reason})`);
    console.log(`   Remove: ${rec.remove.join(", ")}\n`);
  }

  // Check for references to duplicate tracks
  console.log("=== CHECKING REFERENCES TO DUPLICATES ===\n");

  const allRemoveIds = recommendations.flatMap((r) => r.remove);

  // Check SystemPlaylistTrack
  const systemPlaylistRefs = await prisma.systemPlaylistTrack.count({
    where: { trackId: { in: allRemoveIds } },
  });
  console.log(`SystemPlaylistTrack references: ${systemPlaylistRefs}`);

  // Check FavoriteTrack
  const favoriteRefs = await prisma.favoriteTrack.count({
    where: { trackId: { in: allRemoveIds } },
  });
  console.log(`FavoriteTrack references: ${favoriteRefs}`);

  // Check NostrPost
  const nostrPostRefs = await prisma.nostrPost.count({
    where: { trackId: { in: allRemoveIds } },
  });
  console.log(`NostrPost references: ${nostrPostRefs}`);

  // Check BoostEvent
  const boostRefs = await prisma.boostEvent.count({
    where: { trackId: { in: allRemoveIds } },
  });
  console.log(`BoostEvent references: ${boostRefs}`);

  console.log("\n=== SUMMARY ===");
  console.log(`Duplicate sets: ${duplicateSets.length}`);
  console.log(`Tracks to archive: ${totalDuplicates}`);
  console.log(`References to update: ${systemPlaylistRefs + favoriteRefs + nostrPostRefs + boostRefs}`);

  // Export recommendations for cleanup script
  console.log("\n=== GENERATING CLEANUP DATA ===");
  const cleanupData = {
    generatedAt: new Date().toISOString(),
    summary: {
      duplicateSets: duplicateSets.length,
      tracksToRemove: totalDuplicates,
      referencesToUpdate:
        systemPlaylistRefs + favoriteRefs + nostrPostRefs + boostRefs,
    },
    recommendations: recommendations.map((r) => ({
      keep: r.keep,
      remove: r.remove,
      reason: r.reason,
    })),
  };

  // Write to file for review
  const fs = await import("fs");
  fs.writeFileSync(
    "scripts/duplicate-cleanup-data.json",
    JSON.stringify(cleanupData, null, 2)
  );
  console.log("Wrote cleanup data to scripts/duplicate-cleanup-data.json");

  await prisma.$disconnect();
}

findDuplicates().catch((e) => {
  console.error(e);
  process.exit(1);
});
