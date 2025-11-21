const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    // Count total tracks
    const totalTracks = await prisma.track.count();

    // Count tracks with null trackOrder
    const nullTrackOrder = await prisma.track.count({
      where: { trackOrder: null }
    });

    // Count tracks with trackOrder set
    const withTrackOrder = await prisma.track.count({
      where: { trackOrder: { not: null } }
    });

    console.log('=== Track Order Statistics ===');
    console.log(`Total tracks: ${totalTracks}`);
    console.log(`Tracks with trackOrder set: ${withTrackOrder} (${(withTrackOrder/totalTracks*100).toFixed(1)}%)`);
    console.log(`Tracks with trackOrder NULL: ${nullTrackOrder} (${(nullTrackOrder/totalTracks*100).toFixed(1)}%)`);

    // Get feeds with null trackOrder tracks
    const feedsWithNullOrder = await prisma.feed.findMany({
      where: {
        Track: {
          some: {
            trackOrder: null
          }
        },
        type: { notIn: ['podcast', 'test'] } // Only music feeds
      },
      select: {
        id: true,
        title: true,
        type: true,
        originalUrl: true,
        lastFetched: true,
        _count: {
          select: {
            Track: true
          }
        }
      },
      orderBy: {
        lastFetched: 'asc'
      }
    });

    console.log(`\n=== Feeds with NULL trackOrder (${feedsWithNullOrder.length} feeds) ===`);
    feedsWithNullOrder.forEach((feed, i) => {
      const lastFetched = feed.lastFetched ? new Date(feed.lastFetched).toISOString().split('T')[0] : 'never';
      console.log(`${i + 1}. ${feed.title}`);
      console.log(`   Type: ${feed.type}, Tracks: ${feed._count.Track}, Last fetched: ${lastFetched}`);
      console.log(`   URL: ${feed.originalUrl.substring(0, 60)}...`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
