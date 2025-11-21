import { prisma } from '../lib/prisma';

async function checkScootV4V() {
  try {
    // Find the scoot album
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { title: { contains: 'scoot', mode: 'insensitive' } },
          { originalUrl: { contains: 'DsIzE8JF79ZiGmlen8uC' } }
        ]
      },
      select: {
        id: true,
        title: true,
        artist: true,
        originalUrl: true,
        v4vRecipient: true,
        v4vValue: true
      }
    });

    if (!feed) {
      console.log('Feed not found');
      return;
    }

    console.log('Feed found:');
    console.log('ID:', feed.id);
    console.log('Title:', feed.title);
    console.log('Artist:', feed.artist);
    console.log('URL:', feed.originalUrl);
    console.log('v4vRecipient:', feed.v4vRecipient);
    console.log('v4vValue:', JSON.stringify(feed.v4vValue, null, 2));

    if (!feed.v4vRecipient) {
      console.log('\n⚠️  Feed is missing v4v information - needs to be re-imported or updated');
    } else {
      console.log('\n✅ Feed has v4v information');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkScootV4V();
