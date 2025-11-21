import { prisma } from '../lib/prisma';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

async function updateScootV4V() {
  try {
    // Find the scoot album
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { title: { contains: 'scoot', mode: 'insensitive' } },
          { originalUrl: { contains: 'DsIzE8JF79ZiGmlen8uC' } }
        ]
      }
    });

    if (!feed) {
      console.log('❌ Feed not found');
      return;
    }

    console.log('📋 Found feed:', feed.title);
    console.log('🔗 URL:', feed.originalUrl);

    // Parse the feed to get v4v info
    console.log('\n🔍 Parsing feed to extract v4v information...');
    const parsedFeed = await parseRSSFeedWithSegments(feed.originalUrl);

    console.log('\n📊 Parsed v4v information:');
    console.log('v4vRecipient:', parsedFeed.v4vRecipient);
    console.log('v4vValue:', JSON.stringify(parsedFeed.v4vValue, null, 2));

    if (!parsedFeed.v4vRecipient) {
      console.log('\n⚠️  No v4v information found in feed');
      return;
    }

    // Update the feed with v4v info
    console.log('\n💾 Updating feed in database...');
    await prisma.feed.update({
      where: { id: feed.id },
      data: {
        v4vRecipient: parsedFeed.v4vRecipient,
        v4vValue: parsedFeed.v4vValue
      }
    });

    console.log('✅ Feed updated successfully!');

    // Verify the update
    const updatedFeed = await prisma.feed.findUnique({
      where: { id: feed.id },
      select: {
        title: true,
        v4vRecipient: true,
        v4vValue: true
      }
    });

    console.log('\n✅ Verified update:');
    console.log('Title:', updatedFeed?.title);
    console.log('v4vRecipient:', updatedFeed?.v4vRecipient);
    console.log('v4vValue:', JSON.stringify(updatedFeed?.v4vValue, null, 2));

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateScootV4V();
