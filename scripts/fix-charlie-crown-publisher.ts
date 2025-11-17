import { prisma } from '../lib/prisma';

async function main() {
  console.log('Creating Charlie Crown publisher feed...');

  // Check if it already exists
  const existing = await prisma.feed.findUnique({
    where: { id: 'wavlake-publisher-707bc821' }
  });

  if (existing) {
    console.log('✅ Publisher feed already exists:', JSON.stringify(existing, null, 2));
    await prisma.$disconnect();
    return;
  }

  const publisherFeed = await prisma.feed.create({
    data: {
      id: 'wavlake-publisher-707bc821',
      title: 'Charlie Crown',
      artist: 'Charlie Crown',
      originalUrl: 'https://wavlake.com/feed/artist/707bc821-489e-46b2-8b51-d0aaad856f20',
      type: 'publisher',
      status: 'active',
      description: 'Artist & Producer',
      image: 'https://d12wklypp119aj.cloudfront.net/image/707bc821-489e-46b2-8b51-d0aaad856f20.jpg',
      updatedAt: new Date()
    }
  });

  console.log('✅ Charlie Crown publisher feed created:', JSON.stringify(publisherFeed, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
