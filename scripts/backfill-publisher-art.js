// Backfill publisher artwork from album cover art
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfillPublisherArt() {
  console.log('Backfilling publisher artwork from album covers...\n');

  // Find publishers missing images
  const publishersMissingImages = await prisma.feed.findMany({
    where: {
      type: 'publisher',
      status: 'active',
      OR: [
        { image: null },
        { image: '' }
      ]
    },
    select: {
      id: true,
      title: true,
      artist: true,
      image: true
    }
  });

  console.log(`Found ${publishersMissingImages.length} publishers missing artwork\n`);

  let updated = 0;
  let skipped = 0;

  for (const pub of publishersMissingImages) {
    const artistName = pub.artist || pub.title;

    // Find albums by this artist with cover art
    const albums = await prisma.feed.findMany({
      where: {
        type: { in: ['album', 'music'] },
        status: 'active',
        artist: { equals: artistName, mode: 'insensitive' },
        image: { not: null }
      },
      select: { title: true, image: true },
      orderBy: { updatedAt: 'desc' },
      take: 1
    });

    if (albums.length > 0 && albums[0].image) {
      // Update publisher with album cover art
      await prisma.feed.update({
        where: { id: pub.id },
        data: { image: albums[0].image }
      });
      console.log(`✅ ${pub.title}: Updated with cover from "${albums[0].title}"`);
      updated++;
    } else {
      console.log(`⚠️  ${pub.title}: No album cover found`);
      skipped++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped: ${skipped}`);

  await prisma.$disconnect();
}

backfillPublisherArt().catch(console.error);
