import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

async function testRelevancePublisherDetection() {
  try {
    const feedUrl = 'https://feeds.fountain.fm/EYndOSwMiLnUqsXGJbcs';

    console.log('🔍 Testing publisher feed detection for relevance album...\n');

    const parsedFeed = await parseRSSFeedWithSegments(feedUrl);

    console.log('📋 Feed Info:');
    console.log('Title:', parsedFeed.title);
    console.log('Artist:', parsedFeed.artist);

    console.log('\n🎤 Publisher Feed Info:');
    if (parsedFeed.publisherFeed) {
      console.log('✅ Publisher feed detected!');
      console.log('Title:', parsedFeed.publisherFeed.title);
      console.log('Feed URL:', parsedFeed.publisherFeed.feedUrl);
      console.log('Feed GUID:', parsedFeed.publisherFeed.feedGuid);
      console.log('Medium:', parsedFeed.publisherFeed.medium);
    } else {
      console.log('❌ No publisher feed detected - this is the bug!');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testRelevancePublisherDetection();
