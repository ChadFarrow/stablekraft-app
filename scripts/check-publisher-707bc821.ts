import { prisma } from '../lib/prisma';

async function main() {
  const publisherFeed = await prisma.feed.findUnique({
    where: {
      id: 'wavlake-publisher-707bc821'
    },
    select: {
      id: true,
      title: true,
      artist: true,
      originalUrl: true,
      type: true,
      status: true
    }
  });

  console.log('Publisher feed wavlake-publisher-707bc821:', JSON.stringify(publisherFeed, null, 2));

  // Also check for aa909244 (the wrong feed from the logs)
  const wrongFeed = await prisma.feed.findMany({
    where: {
      OR: [
        { id: { contains: 'aa909244' } },
        { originalUrl: { contains: 'aa909244' } },
      ]
    },
    select: {
      id: true,
      title: true,
      artist: true,
      originalUrl: true,
      type: true,
      status: true
    }
  });

  console.log('\nFeeds with aa909244:', JSON.stringify(wrongFeed, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
