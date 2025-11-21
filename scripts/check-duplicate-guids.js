const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const targetGuids = [
      'b2f795fb-c9be-414d-8864-ec5bff88b774', // Doomsday
      '300f7beb-17b0-40d8-a2e4-61ca816fd10c', // Nostalgic
      '3a069c6c-7907-4d6e-b805-d0201a994b7c'  // Feel Good
    ];

    for (const guid of targetGuids) {
      const tracks = await prisma.track.findMany({
        where: { guid },
        select: {
          id: true,
          title: true,
          feedId: true,
          feed: {
            select: {
              title: true
            }
          }
        }
      });

      console.log(`\nGUID: ${guid}`);
      console.log(`Found in ${tracks.length} track(s):`);
      tracks.forEach(t => {
        console.log(`  - "${t.title}" in feed "${t.feed.title}"`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
