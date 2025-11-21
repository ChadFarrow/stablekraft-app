const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    // Find the Satellite Spotlight feed
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: { contains: 'satspotlightsymphony' }
      },
      select: {
        id: true,
        title: true,
        originalUrl: true,
        Track: {
          select: {
            id: true,
            title: true,
            trackOrder: true,
            publishedAt: true
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' }
          ]
        }
      }
    });

    if (!feed) {
      console.log('Feed not found');
      return;
    }

    console.log(`Feed: ${feed.title}`);
    console.log(`Total tracks: ${feed.Track.length}\n`);

    // Count tracks with/without trackOrder
    const withOrder = feed.Track.filter(t => t.trackOrder !== null).length;
    const withoutOrder = feed.Track.filter(t => t.trackOrder === null).length;

    console.log(`Tracks with trackOrder: ${withOrder}`);
    console.log(`Tracks with NULL trackOrder: ${withoutOrder}\n`);

    // Show first 20 tracks
    console.log('=== First 20 Tracks ===');
    feed.Track.slice(0, 20).forEach((track, i) => {
      const order = track.trackOrder !== null ? `#${track.trackOrder}` : 'NULL';
      const date = track.publishedAt ? new Date(track.publishedAt).toISOString().split('T')[0] : 'no date';
      console.log(`${i + 1}. [${order}] ${track.title.substring(0, 60)} (${date})`);
    });

    if (feed.Track.length > 20) {
      console.log(`\n... and ${feed.Track.length - 20} more tracks`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
