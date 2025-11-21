import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

async function testPublisherDetection() {
  try {
    const feedUrl = 'https://feeds.fountain.fm/LBgNfWsH0NDMlEOTW3Lf';

    console.log('🔍 Testing publisher feed detection...\n');

    const parsedFeed = await parseRSSFeedWithSegments(feedUrl);

    console.log('📋 Feed Info:');
    console.log('Title:', parsedFeed.title);
    console.log('Artist:', parsedFeed.artist);
    console.log('GUID:', parsedFeed.podcastGuid);

    console.log('\n💰 V4V Info:');
    console.log('v4vRecipient:', parsedFeed.v4vRecipient || 'Not set');
    console.log('v4vValue:', parsedFeed.v4vValue ? 'Present' : 'Missing');

    if (parsedFeed.v4vValue?.recipients) {
      console.log('\nRecipients:');
      parsedFeed.v4vValue.recipients.forEach((r: any) => {
        console.log(`  - ${r.name} (${r.split}%): ${r.address}`);
      });
    }

    console.log('\n🎤 Publisher Feed Info:');
    if (parsedFeed.publisherFeed) {
      console.log('✅ Publisher feed detected!');
      console.log('Title:', parsedFeed.publisherFeed.title);
      console.log('Feed URL:', parsedFeed.publisherFeed.feedUrl);
      console.log('Feed GUID:', parsedFeed.publisherFeed.feedGuid);
      console.log('Medium:', parsedFeed.publisherFeed.medium);
    } else {
      console.log('❌ No publisher feed detected');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testPublisherDetection();
