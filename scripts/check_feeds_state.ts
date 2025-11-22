import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const unparsedFeeds = await prisma.feed.count({
    where: {
      status: 'active',
      Track: { none: {} }
    }
  });
  
  const totalFeeds = await prisma.feed.count({ where: { status: 'active' } });
  const totalTracks = await prisma.track.count();
  
  // Get sample of unparsed feeds
  const sampleFeeds = await prisma.feed.findMany({
    where: {
      status: 'active',
      Track: { none: {} }
    },
    select: { id: true, title: true, originalUrl: true },
    take: 10
  });
  
  console.log('Total active feeds:', totalFeeds);
  console.log('Feeds without tracks:', unparsedFeeds);
  console.log('Total tracks in DB:', totalTracks);
  console.log('\nSample feeds without tracks:');
  sampleFeeds.forEach(f => console.log(`  ${f.id}: ${f.title} - ${f.originalUrl}`));
  
  await prisma.$disconnect();
}

check().catch(console.error);
