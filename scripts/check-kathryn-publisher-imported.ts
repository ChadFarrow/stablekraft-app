import { prisma } from '../lib/prisma';

async function checkPublisherImported() {
  try {
    const publisherFeedUrl = 'https://feeds.fountain.fm/jokW9pKTREMn9bhoZSRU';
    const publisherGuid = '9efcded5-19a4-56cd-ba5e-8f521c35cb23';

    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { originalUrl: publisherFeedUrl },
          { guid: publisherGuid }
        ]
      },
      select: {
        id: true,
        title: true,
        type: true,
        originalUrl: true,
        v4vRecipient: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    if (feed) {
      console.log('✅ Publisher feed is already imported!');
      console.log('ID:', feed.id);
      console.log('Title:', feed.title);
      console.log('Type:', feed.type);
      console.log('Tracks:', feed._count.Track);
      console.log('v4vRecipient:', feed.v4vRecipient || 'Missing');
    } else {
      console.log('❌ Publisher feed NOT imported yet');
      console.log('URL:', publisherFeedUrl);
      console.log('\n💡 You can import it through the admin page!');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPublisherImported();
