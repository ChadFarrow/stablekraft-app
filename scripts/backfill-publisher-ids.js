const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfillPublisherIds() {
  // Get all publishers
  const publishers = await prisma.feed.findMany({
    where: { type: 'publisher', status: 'active' },
    select: { id: true, title: true, artist: true }
  });

  console.log('Found', publishers.length, 'publishers');
  let updated = 0;

  for (const pub of publishers) {
    const artistName = pub.artist || pub.title;
    if (!artistName) continue;

    // Find albums by artist name that don't have publisherId set
    const albums = await prisma.feed.findMany({
      where: {
        type: 'album',
        status: 'active',
        publisherId: null,
        artist: { equals: artistName, mode: 'insensitive' }
      },
      select: { id: true, title: true, artist: true }
    });

    if (albums.length > 0) {
      console.log(`Linking ${albums.length} albums to publisher: ${artistName}`);

      for (const album of albums) {
        await prisma.feed.update({
          where: { id: album.id },
          data: { publisherId: pub.id }
        });
        console.log(`  - ${album.title}`);
        updated++;
      }
    }
  }

  console.log(`\nTotal updated: ${updated}`);
}

backfillPublisherIds()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
