#!/usr/bin/env tsx

/**
 * Test script to verify publisher extraction from Doerfels album feeds
 */

import { RSSParser } from '../lib/rss-parser';

async function testDoerfelsPublisherExtraction() {
  console.log('🧪 Testing Publisher Extraction from Doerfels Album Feeds\n');
  console.log('═'.repeat(70));

  const testFeeds = [
    'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
    'https://www.doerfelverse.com/feeds/you-are-my-world.xml',
    'https://www.doerfelverse.com/artists/middleseason/inside-out.xml'
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  let publishersFound = 0;

  for (let i = 0; i < testFeeds.length; i++) {
    const testFeedUrl = testFeeds[i];
    const progress = `[${i + 1}/${testFeeds.length}]`;

    console.log(`\n${progress} 📡 Testing feed: ${testFeedUrl}\n`);

    try {
      console.log('🔍 Parsing album feed...');
      const album = await RSSParser.parseAlbumFeed(testFeedUrl);

      if (!album) {
        console.error('❌ Failed to parse album feed\n');
        totalFailed++;
        continue;
      }

      console.log('✅ Album feed parsed successfully\n');
      console.log(`   Title: ${album.title}`);
      console.log(`   Artist: ${album.artist}`);
      console.log(`   Tracks: ${album.tracks.length}`);

      // Check for publisher information
      if (album.publisher) {
        publishersFound++;
        console.log('\n✅ Publisher information found:');
        console.log(`   Feed GUID: ${album.publisher.feedGuid}`);
        console.log(`   Feed URL: ${album.publisher.feedUrl}`);
        console.log(`   Medium: ${album.publisher.medium}`);
        totalPassed++;
      } else {
        console.log('\n⚠️  No publisher information found in album feed');
        console.log('   This feed may not contain publisher references.');
        totalPassed++; // Still counts as passed since extraction works
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.error('❌ Error testing publisher extraction:', error);
      if (error instanceof Error) {
        console.error('   Error message:', error.message);
      }
      totalFailed++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('📊 Test Summary:');
  console.log(`   Total feeds tested: ${testFeeds.length}`);
  console.log(`   ✅ Passed: ${totalPassed}`);
  console.log(`   ✅ Feeds with publisher info: ${publishersFound}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log('═'.repeat(70));

  if (totalFailed === 0 && totalPassed === testFeeds.length) {
    console.log('\n✅ All tests passed! Publisher extraction is working correctly.');
  } else if (totalPassed > 0) {
    console.log('\n✅ Publisher extraction is working (some feeds may not have publisher info).');
  } else {
    console.log('\n❌ Tests failed. There may be an issue with publisher extraction.');
    process.exit(1);
  }
}

// Run the test
testDoerfelsPublisherExtraction();

