const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const feed = await prisma.feed.findFirst({
      where: { originalUrl: { contains: 'bloodshot-lies' } },
      select: {
        id: true,
        title: true,
        lastFetched: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (feed) {
      console.log('Feed ID:', feed.id);
      console.log('Feed:', feed.title);
      console.log('Created:', feed.createdAt);
      console.log('Last Fetched:', feed.lastFetched);
      console.log('Updated:', feed.updatedAt);

      // Get all tracks with more details
      const tracks = await prisma.track.findMany({
        where: { feedId: feed.id },
        select: {
          trackOrder: true,
          title: true,
          publishedAt: true,
          createdAt: true
        },
        orderBy: [
          { publishedAt: 'asc' },
          { createdAt: 'asc' }
        ]
      });

      console.log('\nTracks (ordered by publishedAt, createdAt - current fallback order):');
      tracks.forEach((t, i) => console.log(`  ${i+1}. ${t.title} (published: ${t.publishedAt?.toISOString()?.split('T')[0] || 'null'})`));
    } else {
      console.log('Feed not found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
