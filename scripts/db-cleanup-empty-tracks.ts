import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanupEmptyTracks() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log("=== DRY RUN MODE - No changes will be made ===\n");
  }

  console.log("=== EMPTY AUDIOURL TRACK CLEANUP ===\n");

  // Find tracks with empty audioUrl
  const emptyTracks = await prisma.track.findMany({
    where: { audioUrl: "" },
    include: { Feed: { select: { title: true } } },
  });

  console.log(`Found ${emptyTracks.length} tracks with empty audioUrl\n`);

  if (emptyTracks.length === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  // Show what will be archived
  console.log("Tracks to archive:");
  emptyTracks.forEach((t, i) => {
    console.log(`  ${i + 1}. "${t.title}" from "${t.Feed?.title || "unknown feed"}"`);
  });
  console.log("");

  // Check for references
  const trackIds = emptyTracks.map((t) => t.id);

  const systemPlaylistRefs = await prisma.systemPlaylistTrack.count({
    where: { trackId: { in: trackIds } },
  });
  const favoriteRefs = await prisma.favoriteTrack.count({
    where: { trackId: { in: trackIds } },
  });

  console.log(`References to these tracks:`);
  console.log(`  SystemPlaylistTrack: ${systemPlaylistRefs}`);
  console.log(`  FavoriteTrack: ${favoriteRefs}\n`);

  // Archive tracks
  console.log("Archiving tracks...");
  let archived = 0;

  for (const track of emptyTracks) {
    if (!dryRun) {
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
          NOW(), 'empty_audioUrl', NULL
        )
      `;
    }
    archived++;
  }
  console.log(`Archived ${archived} tracks\n`);

  // Delete references first (if any)
  if (systemPlaylistRefs > 0) {
    console.log("Deleting SystemPlaylistTrack references...");
    if (!dryRun) {
      const deleted = await prisma.systemPlaylistTrack.deleteMany({
        where: { trackId: { in: trackIds } },
      });
      console.log(`Deleted ${deleted.count} playlist references\n`);
    } else {
      console.log(`Would delete ${systemPlaylistRefs} playlist references\n`);
    }
  }

  if (favoriteRefs > 0) {
    console.log("Deleting FavoriteTrack references...");
    if (!dryRun) {
      const deleted = await prisma.favoriteTrack.deleteMany({
        where: { trackId: { in: trackIds } },
      });
      console.log(`Deleted ${deleted.count} favorite references\n`);
    } else {
      console.log(`Would delete ${favoriteRefs} favorite references\n`);
    }
  }

  // Delete from Track table
  console.log("Deleting from Track table...");
  if (!dryRun) {
    const deleteResult = await prisma.track.deleteMany({
      where: { id: { in: trackIds } },
    });
    console.log(`Deleted ${deleteResult.count} tracks\n`);
  } else {
    console.log(`Would delete ${trackIds.length} tracks\n`);
  }

  console.log("=== CLEANUP COMPLETE ===");

  if (dryRun) {
    console.log("\nRun without --dry-run to apply changes.");
  }

  await prisma.$disconnect();
}

cleanupEmptyTracks().catch((e) => {
  console.error(e);
  process.exit(1);
});
