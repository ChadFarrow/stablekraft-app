const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: { contains: 'satspotlightsymphony' }
      },
      select: {
        Track: {
          select: {
            title: true,
            trackOrder: true,
            guid: true
          }
        }
      }
    });

    // Find track with NULL trackOrder
    const nullTrack = feed.Track.find(t => t.trackOrder === null);
    if (nullTrack) {
      console.log('=== Track with NULL trackOrder ===');
      console.log(`Title: ${nullTrack.title}`);
      console.log(`GUID: ${nullTrack.guid}\n`);
    }

    // Check for gaps in trackOrder sequence
    const orderedTracks = feed.Track
      .filter(t => t.trackOrder !== null)
      .sort((a, b) => a.trackOrder - b.trackOrder);

    console.log('=== Checking for gaps in trackOrder sequence ===');
    for (let i = 1; i < orderedTracks.length; i++) {
      const prev = orderedTracks[i - 1].trackOrder;
      const curr = orderedTracks[i].trackOrder;

      if (curr - prev > 1) {
        console.log(`Gap found: ${prev} → ${curr} (missing ${prev + 1})`);
      }
    }

    // Show tracks around the gap
    console.log('\n=== Tracks around position 5 ===');
    orderedTracks.slice(2, 8).forEach(t => {
      console.log(`#${t.trackOrder}: ${t.title}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
