const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const stillMissing = [
    'Allen C. Paul', 'Blue Collar Astronauts', 'R.O. Shapiro', 'Soulful Sam',
    'StonesX', 'The Cascades', 'The Midnight Dreamers', 'The Native Harvesters',
    'The Seatopians', 'Timmy Blackwell'
  ];

  for (const name of stillMissing) {
    const pub = await prisma.feed.findFirst({
      where: { type: 'publisher', title: { contains: name.replace('.', ''), mode: 'insensitive' } },
      select: { id: true, title: true, artist: true }
    });

    if (!pub) {
      console.log(`${name}: NOT FOUND IN DB`);
      continue;
    }

    const artistName = pub.artist || pub.title;
    const albums = await prisma.feed.findMany({
      where: {
        type: { in: ['album', 'music'] },
        status: 'active',
        artist: { equals: artistName, mode: 'insensitive' }
      },
      select: { title: true, image: true, _count: { select: { Track: true } } }
    });

    const albumsWithTracks = albums.filter(a => a._count.Track > 0);
    const albumWithArt = albums.find(a => a.image);

    console.log(`${name}:`);
    console.log(`  Albums: ${albums.length} (with tracks: ${albumsWithTracks.length})`);
    console.log(`  Album with art: ${albumWithArt ? albumWithArt.title : 'NONE'}`);
  }
}

check().then(() => prisma.$disconnect());
