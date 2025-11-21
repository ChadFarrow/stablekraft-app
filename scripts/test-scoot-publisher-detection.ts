import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

async function testPublisherDetection() {
  try {
    const feedUrl = 'https://feeds.fountain.fm/DsIzE8JF79ZiGmlen8uC';

    console.log('🔍 Testing publisher feed detection for scoot album...\n');

    const parsedFeed = await parseRSSFeedWithSegments(feedUrl);

    console.log('📋 Feed Info:');
    console.log('Title:', parsedFeed.title);
    console.log('Artist:', parsedFeed.artist);
    console.log('GUID:', parsedFeed.podcastGuid);

    console.log('\n💰 V4V Info:');
    console.log('v4vRecipient:', parsedFeed.v4vRecipient);
    console.log('v4vValue:', parsedFeed.v4vValue ? 'Present' : 'Missing');

    console.log('\n🎤 Publisher Feed Info:');
    if (parsedFeed.publisherFeed) {
      console.log('✅ Publisher feed found!');
      console.log('Title:', parsedFeed.publisherFeed.title);
      console.log('Feed URL:', parsedFeed.publisherFeed.feedUrl);
      console.log('Feed GUID:', parsedFeed.publisherFeed.feedGuid);
      console.log('Medium:', parsedFeed.publisherFeed.medium);
    } else {
      console.log('❌ No publisher feed found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testPublisherDetection();
