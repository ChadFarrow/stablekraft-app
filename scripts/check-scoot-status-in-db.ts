import { prisma } from '../lib/prisma';

async function checkScootStatus() {
  try {
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
        status: true,
        priority: true,
        originalUrl: true,
        v4vRecipient: true,
        image: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    if (!feed) {
      console.log('❌ Scoot feed not found in database');
      return;
    }

    console.log('📋 Scoot Feed Status:');
    console.log('─'.repeat(80));
    console.log('Title:', feed.title);
    console.log('Artist:', feed.artist);
    console.log('Status:', feed.status, feed.status === 'active' ? '✅' : '⚠️');
    console.log('Priority:', feed.priority);
    console.log('Tracks:', feed._count.Track);
    console.log('Image:', feed.image ? '✅ Present' : '❌ Missing');
    console.log('v4vRecipient:', feed.v4vRecipient || '❌ Missing');

    if (feed.status !== 'active') {
      console.log('\n⚠️  Feed status is NOT "active" - it won\'t show on main page!');
      console.log(`   Current status: "${feed.status}"`);
      console.log('   To fix: Update status to "active"');
    } else {
      console.log('\n✅ Feed status is "active" - it SHOULD appear on main page');
      console.log('   (Cache may take up to 2 minutes to refresh)');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkScootStatus();
