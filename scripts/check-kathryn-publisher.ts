import { prisma } from '../lib/prisma';

async function checkKathrynPublisher() {
  try {
    // Find any feeds related to Kathryn
    const feeds = await prisma.feed.findMany({
      where: {
        OR: [
          { artist: { contains: 'Kathryn', mode: 'insensitive' } },
          { title: { contains: 'Kathryn', mode: 'insensitive' } },
          { originalUrl: { contains: 'kathryn', mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        title: true,
        artist: true,
        type: true,
        originalUrl: true,
        v4vRecipient: true,
        v4vValue: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    if (feeds.length === 0) {
      console.log('❌ No feeds found for Kathryn');
      return;
    }

    console.log(`\n📋 Found ${feeds.length} feed(s) for Kathryn:\n`);

    for (const feed of feeds) {
      console.log('─'.repeat(80));
      console.log('ID:', feed.id);
      console.log('Title:', feed.title);
      console.log('Artist:', feed.artist);
      console.log('Type:', feed.type);
      console.log('URL:', feed.originalUrl);
      console.log('Tracks:', feed._count.Track);
      console.log('v4vRecipient:', feed.v4vRecipient || '❌ MISSING');
      console.log('v4vValue:', feed.v4vValue ? '✅ Present' : '❌ MISSING');

      if (!feed.v4vRecipient) {
        console.log('⚠️  This feed needs v4v info');
      }
      console.log();
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkKathrynPublisher();
