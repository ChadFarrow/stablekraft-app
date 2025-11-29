const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // Get publishers without images
  const publishers = await prisma.feed.findMany({
    where: {
      type: 'publisher',
      status: 'active',
      OR: [{ image: null }, { image: '' }]
    },
    select: { id: true, title: true, artist: true }
  });

  console.log('Publishers missing art:', publishers.length);
  console.log('');

  // Get all albums
  const albums = await prisma.feed.findMany({
    where: {
      type: { in: ['album', 'music'] },
      status: 'active'
    },
    select: { title: true, artist: true, image: true, _count: { select: { Track: true } } },
    orderBy: { updatedAt: 'desc' }
  });

  let willGetArt = 0;
  let noArt = 0;

  for (const pub of publishers) {
    const publisherArtist = (pub.artist || pub.title)?.toLowerCase();

    // New matching logic: exact OR startsWith
    const matchingAlbums = albums.filter(album => {
      const albumArtist = album.artist?.toLowerCase();
      if (!publisherArtist || !albumArtist) return false;
      if (publisherArtist === albumArtist) return true;
      if (albumArtist.startsWith(publisherArtist + ' ')) return true;
      return false;
    });

    const albumsWithTracks = matchingAlbums.filter(a => a._count.Track > 0);
    const albumWithArt = matchingAlbums.find(a => a.image);

    if (albumWithArt) {
      console.log('✅ ' + pub.title + ': Will use art from "' + albumWithArt.title + '"');
      willGetArt++;
    } else if (albumsWithTracks.length > 0) {
      console.log('⚠️  ' + pub.title + ': Has ' + albumsWithTracks.length + ' albums but none have art');
      noArt++;
    } else {
      console.log('❌ ' + pub.title + ': No matching albums found');
      noArt++;
    }
  }

  console.log('');
  console.log('Summary: ' + willGetArt + ' will get art, ' + noArt + ' still without');
}

check().then(() => prisma.$disconnect());
