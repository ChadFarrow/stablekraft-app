import { prisma } from '../lib/prisma';

async function main() {
  const feeds = await prisma.feed.findMany({
    where: {
      OR: [
        { id: { contains: '707bc821' } },
        { title: { contains: 'Charlie Crown' } },
        { artist: { contains: 'Charlie Crown' } },
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

  console.log('Found feeds:', JSON.stringify(feeds, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
