#!/usr/bin/env node

/**
 * Test script to identify missing albums by testing RSS feed reliability
 * This will help us identify which feeds are failing and causing missing albums
 */

// Simple RSS feed test using basic fetch and XML parsing
const https = require('https');
const http = require('http');

// Get ALL feed URLs from the main page configuration (complete list of 74 feeds)
const feedUrlMappings = [
  // Core Doerfels feeds - verified working
  ['https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/music-from-the-doerfelverse.xml'],
  ['https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/bloodshot-lies-album.xml'],
  ['https://www.doerfelverse.com/feeds/intothedoerfelverse.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/intothedoerfelverse.xml'],
  ['https://www.doerfelverse.com/feeds/wrath-of-banjo.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wrath-of-banjo.xml'],
  ['https://www.doerfelverse.com/feeds/ben-doerfel.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/ben-doerfel.xml'],
  
  // Additional Doerfels albums and projects - all verified working
  ['https://www.doerfelverse.com/feeds/18sundays.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/18sundays.xml'],
  ['https://www.doerfelverse.com/feeds/alandace.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/alandace.xml'],
  ['https://www.doerfelverse.com/feeds/autumn.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/autumn.xml'],
  ['https://www.doerfelverse.com/feeds/christ-exalted.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/christ-exalted.xml'],
  ['https://www.doerfelverse.com/feeds/come-back-to-me.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/come-back-to-me.xml'],
  ['https://www.doerfelverse.com/feeds/dead-time-live-2016.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/dead-time-live-2016.xml'],
  ['https://www.doerfelverse.com/feeds/dfbv1.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/dfbv1.xml'],
  ['https://www.doerfelverse.com/feeds/dfbv2.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/dfbv2.xml'],
  ['https://www.doerfelverse.com/feeds/disco-swag.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/disco-swag.xml'],
  ['https://www.doerfelverse.com/feeds/first-married-christmas.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/first-married-christmas.xml'],
  ['https://www.doerfelverse.com/feeds/generation-gap.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/generation-gap.xml'],
  ['https://www.doerfelverse.com/feeds/heartbreak.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/heartbreak.xml'],
  ['https://www.doerfelverse.com/feeds/merry-christmix.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/merry-christmix.xml'],
  ['https://www.doerfelverse.com/feeds/middle-season-let-go.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/middle-season-let-go.xml'],
  ['https://www.doerfelverse.com/feeds/phatty-the-grasshopper.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/phatty-the-grasshopper.xml'],
  ['https://www.doerfelverse.com/feeds/possible.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/possible.xml'],
  ['https://www.doerfelverse.com/feeds/pour-over.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/pour-over.xml'],
  ['https://www.doerfelverse.com/feeds/psalm-54.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/psalm-54.xml'],
  ['https://www.doerfelverse.com/feeds/sensitive-guy.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/sensitive-guy.xml'],
  ['https://www.doerfelverse.com/feeds/they-dont-know.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/they-dont-know.xml'],
  ['https://www.doerfelverse.com/feeds/think-ep.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/think-ep.xml'],
  ['https://www.doerfelverse.com/feeds/underwater-single.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/underwater-single.xml'],
  ['https://www.doerfelverse.com/feeds/unsound-existence.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/unsound-existence.xml'],
  ['https://www.doerfelverse.com/feeds/you-are-my-world.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/you-are-my-world.xml'],
  ['https://www.doerfelverse.com/feeds/you-feel-like-home.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/you-feel-like-home.xml'],
  ['https://www.doerfelverse.com/feeds/your-chance.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/your-chance.xml'],
  ['https://www.doerfelverse.com/artists/opus/opus/opus.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/opus.xml'],
  
  // Ed Doerfel (Shredward) projects - verified working
  ['https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/nostalgic.xml'],
  ['https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/CityBeach.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/citybeach.xml'],
  ['https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/kurtisdrums-v1.xml'],
  
  // TJ Doerfel projects - verified working
  ['https://www.thisisjdog.com/media/ring-that-bell.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/ring-that-bell.xml'],
  
  // External artists - verified working
  ['https://ableandthewolf.com/static/media/feed.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/ableandthewolf-feed.xml'],
  ['https://static.staticsave.com/mspfiles/deathdreams.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/deathdreams.xml'],
  ['https://static.staticsave.com/mspfiles/waytogo.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/waytogo.xml'],
  // Temporarily disabled due to NetworkError issues
  // ['https://feed.falsefinish.club/Vance%20Latta/Vance%20Latta%20-%20Love%20In%20Its%20Purest%20Form/love%20in%20its%20purest%20form.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/vance-latta-love-in-its-purest-form.xml'],
  ['https://music.behindthesch3m3s.com/wp-content/uploads/c_kostra/now%20i%20feel%20it.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/c-kostra-now-i-feel-it.xml'],
  ['https://music.behindthesch3m3s.com/wp-content/uploads/Mellow%20Cassette/Pilot/pilot.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/mellow-cassette-pilot.xml'],
  ['https://music.behindthesch3m3s.com/wp-content/uploads/Mellow%20Cassette/Radio_Brigade/radio_brigade.xml', 'https://re-podtards-cdn-new.b-cdn.net/feeds/mellow-cassette-radio-brigade.xml'],
  
  // Wavlake feeds - verified working
  ['https://wavlake.com/feed/music/d677db67-0310-4813-970e-e65927c689f1', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-d677db67-0310-4813-970e-e65927c689f1.xml'],
  ['https://wavlake.com/feed/artist/aa909244-7555-4b52-ad88-7233860c6fb4', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-artist-aa909244-7555-4b52-ad88-7233860c6fb4.xml'],
  ['https://wavlake.com/feed/music/e678589b-5a9f-4918-9622-34119d2eed2c', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-e678589b-5a9f-4918-9622-34119d2eed2c.xml'],
  ['https://wavlake.com/feed/music/3a152941-c914-43da-aeca-5d7c58892a7f', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-3a152941-c914-43da-aeca-5d7c58892a7f.xml'],
  ['https://wavlake.com/feed/music/a97e0586-ecda-4b79-9c38-be9a9effe05a', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-a97e0586-ecda-4b79-9c38-be9a9effe05a.xml'],
  ['https://wavlake.com/feed/music/0ed13237-aca9-446f-9a03-de1a2d9331a3', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-0ed13237-aca9-446f-9a03-de1a2d9331a3.xml'],
  ['https://wavlake.com/feed/music/ce8c4910-51bf-4d5e-a0b3-338e58e5ee79', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-ce8c4910-51bf-4d5e-a0b3-338e58e5ee79.xml'],
  ['https://wavlake.com/feed/music/acb43f23-cfec-4cc1-a418-4087a5378129', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-acb43f23-cfec-4cc1-a418-4087a5378129.xml'],
  ['https://wavlake.com/feed/music/d1a871a7-7e4c-4a91-b799-87dcbb6bc41d', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-d1a871a7-7e4c-4a91-b799-87dcbb6bc41d.xml'],
  ['https://wavlake.com/feed/music/3294d8b5-f9f6-4241-a298-f04df818390c', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-3294d8b5-f9f6-4241-a298-f04df818390c.xml'],
  ['https://wavlake.com/feed/music/d3145292-bf71-415f-a841-7f5c9a9466e1', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-d3145292-bf71-415f-a841-7f5c9a9466e1.xml'],
  ['https://wavlake.com/feed/music/91367816-33e6-4b6e-8eb7-44b2832708fd', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-91367816-33e6-4b6e-8eb7-44b2832708fd.xml'],
  ['https://wavlake.com/feed/music/8c8f8133-7ef1-4b72-a641-4e1a6a44d626', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-8c8f8133-7ef1-4b72-a641-4e1a6a44d626.xml'],
  ['https://wavlake.com/feed/music/9720d58b-22a5-4047-81de-f1940fec41c7', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-9720d58b-22a5-4047-81de-f1940fec41c7.xml'],
  ['https://wavlake.com/feed/music/21536269-5192-49e7-a819-fab00f4a159e', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-21536269-5192-49e7-a819-fab00f4a159e.xml'],
  ['https://wavlake.com/feed/music/624b19ac-5d8b-4fd6-8589-0eef7bcb9c9e', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-624b19ac-5d8b-4fd6-8589-0eef7bcb9c9e.xml'],
  ['https://wavlake.com/feed/music/997060e3-9dc1-4cd8-b3c1-3ae06d54bb03', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-997060e3-9dc1-4cd8-b3c1-3ae06d54bb03.xml'],
  ['https://wavlake.com/feed/music/b54b9a19-b6ed-46c1-806c-7e82f7550edc', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-b54b9a19-b6ed-46c1-806c-7e82f7550edc.xml'],
  
  // Joe Martin (Wavlake) - verified working
  ['https://wavlake.com/feed/music/95ea253a-4058-402c-8503-204f6d3f1494', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-95ea253a-4058-402c-8503-204f6d3f1494.xml'],
  ['https://wavlake.com/feed/artist/18bcbf10-6701-4ffb-b255-bc057390d738', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-artist-18bcbf10-6701-4ffb-b255-bc057390d738.xml'],
  
  // IROH (Wavlake) - verified working
  ['https://wavlake.com/feed/artist/8a9c2e54-785a-4128-9412-737610f5d00a', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-artist-8a9c2e54-785a-4128-9412-737610f5d00a.xml'],
  ['https://wavlake.com/feed/music/1c7917cc-357c-4eaf-ab54-1a7cda504976', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-1c7917cc-357c-4eaf-ab54-1a7cda504976.xml'],
  ['https://wavlake.com/feed/music/e1f9dfcb-ee9b-4a6d-aee7-189043917fb5', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-e1f9dfcb-ee9b-4a6d-aee7-189043917fb5.xml'],
  ['https://wavlake.com/feed/music/d4f791c3-4d0c-4fbd-a543-c136ee78a9de', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-d4f791c3-4d0c-4fbd-a543-c136ee78a9de.xml'],
  ['https://wavlake.com/feed/music/51606506-66f8-4394-b6c6-cc0c1b554375', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-51606506-66f8-4394-b6c6-cc0c1b554375.xml'],
  ['https://wavlake.com/feed/music/6b7793b8-fd9d-432b-af1a-184cd41aaf9d', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-6b7793b8-fd9d-432b-af1a-184cd41aaf9d.xml'],
  ['https://wavlake.com/feed/music/0bb8c9c7-1c55-4412-a517-572a98318921', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-0bb8c9c7-1c55-4412-a517-572a98318921.xml'],
  ['https://wavlake.com/feed/music/16e46ed0-b392-4419-a937-a7815f6ca43b', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-16e46ed0-b392-4419-a937-a7815f6ca43b.xml'],
  ['https://wavlake.com/feed/music/2cd1b9ea-9ef3-4a54-aa25-55295689f442', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-2cd1b9ea-9ef3-4a54-aa25-55295689f442.xml'],
  ['https://wavlake.com/feed/music/33eeda7e-8591-4ff5-83f8-f36a879b0a09', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-33eeda7e-8591-4ff5-83f8-f36a879b0a09.xml'],
  ['https://wavlake.com/feed/music/32a79df8-ec3e-4a14-bfcb-7a074e1974b9', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-32a79df8-ec3e-4a14-bfcb-7a074e1974b9.xml'],
  ['https://wavlake.com/feed/music/06376ab5-efca-459c-9801-49ceba5fdab1', 'https://re-podtards-cdn-new.b-cdn.net/feeds/wavlake-06376ab5-efca-459c-9801-49ceba5fdab1.xml'],
];

// Use original URLs for testing (first element of each mapping)
const testFeeds = feedUrlMappings.map(mapping => mapping[0]);

async function fetchFeed(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const startTime = Date.now();
    
    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        const duration = Date.now() - startTime;
        resolve({ data, duration, statusCode: response.statusCode });
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function testSingleFeed(feedUrl) {
  console.log(`\n🧪 Testing feed: ${feedUrl}`);
  try {
    const startTime = Date.now();
    const result = await fetchFeed(feedUrl);
    
    // Basic validation
    if (!result.data || result.data.trim().length === 0) {
      console.log(`❌ FAILED (${result.duration}ms): Empty response`);
      return { success: false, feedUrl, error: 'Empty response', duration: result.duration };
    }
    
    if (!result.data.includes('<rss') && !result.data.includes('<channel')) {
      console.log(`❌ FAILED (${result.duration}ms): Not valid RSS format`);
      return { success: false, feedUrl, error: 'Not valid RSS format', duration: result.duration };
    }
    
    // Extract basic info
    const titleMatch = result.data.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[([^\]]+)\]\]>/, '$1').trim() : 'Unknown';
    
    // Count items
    const itemMatches = result.data.match(/<item[^>]*>/g);
    const itemCount = itemMatches ? itemMatches.length : 0;
    
    console.log(`✅ SUCCESS (${result.duration}ms): "${title}" - ${itemCount} items`);
    return { success: true, feedUrl, title, itemCount, duration: result.duration };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`❌ ERROR (${duration}ms): ${error.message}`);
    return { success: false, feedUrl, error: error.message, duration };
  }
}

async function testAllFeeds() {
  console.log('🔍 Testing RSS feed reliability to identify missing album causes...\n');
  console.log(`📊 Testing ${testFeeds.length} feeds...\n`);
  
  const results = [];
  let successCount = 0;
  let failureCount = 0;
  
  // Test feeds in batches to avoid overwhelming servers (reduced batch size for comprehensive test)
  const batchSize = 5;
  for (let i = 0; i < testFeeds.length; i += batchSize) {
    const batch = testFeeds.slice(i, i + batchSize);
    console.log(`\n📦 Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(testFeeds.length / batchSize)}:`);
    
    const batchPromises = batch.map(testSingleFeed);
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);
    
    // Count successes and failures
    batchResults.forEach(result => {
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    });
    
    // Small delay between batches (increased for comprehensive test)
    if (i + batchSize < testFeeds.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Summary report
  console.log('\n' + '='.repeat(60));
  console.log('📊 RSS FEED RELIABILITY REPORT');
  console.log('='.repeat(60));
  console.log(`✅ Successful feeds: ${successCount}/${testFeeds.length} (${Math.round(successCount/testFeeds.length*100)}%)`);
  console.log(`❌ Failed feeds: ${failureCount}/${testFeeds.length} (${Math.round(failureCount/testFeeds.length*100)}%)`);
  
  if (failureCount > 0) {
    console.log('\n🚨 FAILED FEEDS:');
    const failures = results.filter(r => !r.success);
    failures.forEach((failure, index) => {
      console.log(`${index + 1}. ${failure.feedUrl}`);
      console.log(`   Error: ${failure.error}`);
    });
    
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('1. Check if failed feeds have network connectivity issues');
    console.log('2. Verify failed feeds have valid XML structure');
    console.log('3. Consider implementing better retry logic for intermittent failures');
    console.log('4. Add fallback mechanisms for consistently failing feeds');
  }
  
  if (successCount > 0) {
    console.log('\n📈 PERFORMANCE ANALYSIS:');
    const successful = results.filter(r => r.success);
    const avgDuration = successful.reduce((sum, r) => sum + r.duration, 0) / successful.length;
    const slowFeeds = successful.filter(r => r.duration > 2000);
    
    console.log(`Average response time: ${Math.round(avgDuration)}ms`);
    if (slowFeeds.length > 0) {
      console.log(`Slow feeds (>2s): ${slowFeeds.length}`);
      slowFeeds.forEach(feed => {
        console.log(`  - ${feed.feedUrl} (${feed.duration}ms)`);
      });
    }
  }
  
  console.log('\n✅ Feed reliability test completed!');
  return results;
}

// Run the test
testAllFeeds().catch(console.error);