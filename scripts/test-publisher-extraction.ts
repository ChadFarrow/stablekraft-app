#!/usr/bin/env tsx

/**
 * Test script to verify publisher extraction from Wavlake album feeds
 */

import { RSSParser } from '../lib/rss-parser';

async function testPublisherExtraction() {
  console.log('🧪 Testing Publisher Extraction from Wavlake Album Feeds\n');
  console.log('═'.repeat(70));

  // Test with the feed URL the user mentioned
  const testFeedUrl = 'https://www.wavlake.com/feed/a0c0f339-bacc-45a1-aea5-1384468c7b9a';

  console.log(`📡 Testing feed: ${testFeedUrl}\n`);

  try {
    console.log('🔍 Parsing album feed...');
    const album = await RSSParser.parseAlbumFeed(testFeedUrl);

    if (!album) {
      console.error('❌ Failed to parse album feed');
      process.exit(1);
    }

    console.log('✅ Album feed parsed successfully\n');
    console.log(`   Title: ${album.title}`);
    console.log(`   Artist: ${album.artist}`);
    console.log(`   Tracks: ${album.tracks.length}`);

    // Check for publisher information
    if (album.publisher) {
      console.log('\n✅ Publisher information found:');
      console.log(`   Feed GUID: ${album.publisher.feedGuid}`);
      console.log(`   Feed URL: ${album.publisher.feedUrl}`);
      console.log(`   Medium: ${album.publisher.medium}`);
    } else {
      console.log('\n❌ No publisher information found in album feed');
      console.log('   This means the extraction is not working correctly.');
      process.exit(1);
    }

    console.log('\n✅ Test passed! Publisher extraction is working correctly.');
  } catch (error) {
    console.error('❌ Error testing publisher extraction:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testPublisherExtraction();

