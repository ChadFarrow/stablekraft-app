import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

interface CleanupData {
  generatedAt: string;
  summary: {
    duplicateSets: number;
    tracksToRemove: number;
    referencesToUpdate: number;
  };
  recommendations: {
    keep: string;
    remove: string[];
    reason: string;
  }[];
}

async function cleanupDuplicates() {
  // Check for --dry-run flag
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log("=== DRY RUN MODE - No changes will be made ===\n");
  }

  console.log("=== DUPLICATE TRACK CLEANUP ===\n");

  // Load cleanup data
  const dataPath = "scripts/duplicate-cleanup-data.json";
  if (!fs.existsSync(dataPath)) {
    console.error(
      "Error: Run db-find-duplicates.ts first to generate cleanup data"
    );
    process.exit(1);
  }

  const cleanupData: CleanupData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  console.log(`Loaded cleanup data from ${cleanupData.generatedAt}`);
  console.log(`Sets to process: ${cleanupData.recommendations.length}`);
  console.log(`Tracks to remove: ${cleanupData.summary.tracksToRemove}\n`);

  const allRemoveIds = cleanupData.recommendations.flatMap((r) => r.remove);
  const keepToRemoveMap = new Map<string, string[]>();
  cleanupData.recommendations.forEach((r) => {
    keepToRemoveMap.set(r.keep, r.remove);
  });

  // Step 1: Update SystemPlaylistTrack references
  console.log("Step 1: Updating SystemPlaylistTrack references...");
  let refsUpdated = 0;

  for (const rec of cleanupData.recommendations) {
    for (const removeId of rec.remove) {
      // Find any SystemPlaylistTrack entries pointing to the duplicate
      const refs = await prisma.systemPlaylistTrack.findMany({
        where: { trackId: removeId },
      });

      for (const ref of refs) {
        // Check if the "keep" track is already in this playlist
        const existing = await prisma.systemPlaylistTrack.findFirst({
          where: {
            playlistId: ref.playlistId,
            trackId: rec.keep,
          },
        });

        if (existing) {
          // Already has the canonical track, just delete the duplicate reference
          if (!dryRun) {
            await prisma.systemPlaylistTrack.delete({
              where: { id: ref.id },
            });
          }
          console.log(
            `  Removed duplicate playlist entry for track ${removeId}`
          );
        } else {
          // Update to point to the canonical track
          if (!dryRun) {
            await prisma.systemPlaylistTrack.update({
              where: { id: ref.id },
              data: { trackId: rec.keep },
            });
          }
          console.log(
            `  Updated playlist ref: ${removeId} -> ${rec.keep}`
          );
        }
        refsUpdated++;
      }
    }
  }
  console.log(`Updated ${refsUpdated} playlist references\n`);

  // Step 2: Archive duplicate tracks
  console.log("Step 2: Archiving duplicate tracks...");

  // Get all tracks to archive
  const tracksToArchive = await prisma.track.findMany({
    where: { id: { in: allRemoveIds } },
  });

  console.log(`Found ${tracksToArchive.length} tracks to archive`);

  // Find the keep track for each remove track
  const removeToKeepMap = new Map<string, string>();
  cleanupData.recommendations.forEach((r) => {
    r.remove.forEach((removeId) => {
      removeToKeepMap.set(removeId, r.keep);
    });
  });

  let archived = 0;
  for (const track of tracksToArchive) {
    const replacedById = removeToKeepMap.get(track.id);

    if (!dryRun) {
      // Insert into archive table
      await prisma.$executeRaw`
        INSERT INTO "_ArchivedTrack" (
          "id", "feedId", "guid", "title", "description", "subtitle",
          "audioUrl", "image", "duration", "itunesDuration", "publishedAt",
          "itunesKeywords", "itunesCategories", "artist", "album", "trackOrder",
          "status", "createdAt", "updatedAt", "v4vRecipient", "v4vValue", "searchVector",
          "archivedAt", "archiveReason", "replacedById"
        ) VALUES (
          ${track.id}, ${track.feedId}, ${track.guid}, ${track.title}, ${track.description}, ${track.subtitle},
          ${track.audioUrl}, ${track.image}, ${track.duration}, ${track.itunesDuration}, ${track.publishedAt},
          ${track.itunesKeywords}, ${track.itunesCategories}, ${track.artist}, ${track.album}, ${track.trackOrder},
          ${track.status}, ${track.createdAt}, ${track.updatedAt}, ${track.v4vRecipient}, ${track.v4vValue}, ${track.searchVector},
          NOW(), 'duplicate', ${replacedById}
        )
      `;
    }
    archived++;
  }
  console.log(`Archived ${archived} tracks\n`);

  // Step 3: Delete duplicate tracks from main table
  console.log("Step 3: Deleting duplicates from Track table...");

  if (!dryRun) {
    const deleteResult = await prisma.track.deleteMany({
      where: { id: { in: allRemoveIds } },
    });
    console.log(`Deleted ${deleteResult.count} tracks\n`);
  } else {
    console.log(`Would delete ${allRemoveIds.length} tracks\n`);
  }

  // Summary
  console.log("=== CLEANUP COMPLETE ===");
  console.log(`References updated: ${refsUpdated}`);
  console.log(`Tracks archived: ${archived}`);
  console.log(`Tracks deleted: ${dryRun ? "(dry run)" : archived}`);

  if (dryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

cleanupDuplicates().catch((e) => {
  console.error(e);
  process.exit(1);
});
