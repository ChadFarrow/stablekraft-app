import { prisma } from '../lib/prisma';

async function checkAllRecentV4V() {
  try {
    // Get the 10 most recently added feeds
    const feeds = await prisma.feed.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        title: true,
        artist: true,
        originalUrl: true,
        v4vRecipient: true,
        v4vValue: true,
        createdAt: true
      }
    });

    console.log(`📋 Checking ${feeds.length} most recent feeds for v4v info:\n`);

    for (const feed of feeds) {
      console.log('─'.repeat(80));
      console.log('Title:', feed.title);
      console.log('Artist:', feed.artist);
      console.log('Added:', new Date(feed.createdAt).toLocaleString());
      console.log('v4vRecipient:', feed.v4vRecipient || '❌ MISSING');

      if (feed.v4vValue) {
        const value = feed.v4vValue as any;
        if (value.recipients) {
          console.log('\nRecipients:');
          value.recipients.forEach((r: any) => {
            const isStablekraft = r.name?.toLowerCase().includes('stablekraft') ||
                                r.address?.toLowerCase().includes('stablekraft') ||
                                r.name?.toLowerCase().includes('platform');

            console.log(`  - ${r.name} (${r.split}%)${isStablekraft ? ' ⚠️ PLATFORM FEE' : ''}`);
            console.log(`    ${r.address}`);
          });
        }
      }
      console.log();
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkAllRecentV4V();
