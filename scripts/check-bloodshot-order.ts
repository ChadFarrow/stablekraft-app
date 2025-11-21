import { prisma } from '../lib/prisma';

(async () => {
  try {
    const feed = await prisma.feed.findFirst({
      where: { originalUrl: { contains: 'bloodshot-lies' } },
      include: {
        Track: {
          orderBy: [{ trackOrder: 'asc' }],
          select: { trackOrder: true, title: true, publishedAt: true, createdAt: true }
        }
      }
    });

    if (feed) {
      console.log('Feed:', feed.title);
      console.log('Feed URL:', feed.originalUrl);
      console.log('\nTracks (ordered by trackOrder ASC):');
      feed.Track.forEach(t => console.log(`  ${t.trackOrder}: ${t.title}`));
    } else {
      console.log('Feed not found');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
