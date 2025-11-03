#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const fs = require('fs').promises;
const path = require('path');

// Configuration
const HGH_REMOTE_ITEMS_FILE = 'data/hgh-analysis/hgh-remote-items.json';
const OUTPUT_DIR = 'data/hgh-resolved-tracks';
const SAMPLE_SIZE = 50; // Test with first 50 tracks to get a sense of indexing rate

function generateAuthHeaders() {
  const apiKey = PODCAST_INDEX_API_KEY;
  const apiSecret = PODCAST_INDEX_API_SECRET;
  const unixTime = Math.floor(Date.now() / 1000);
  
  const crypto = require('crypto');
  const data4Hash = apiKey + apiSecret + unixTime;
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'X-Auth-Date': unixTime.toString(),
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft/1.0'
  };
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkPodcastIndex(feedGuid) {
  const headers = generateAuthHeaders();
  
  try {
    const podcastUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;
    const response = await fetch(podcastUrl, { headers });
    
    if (!response.ok) {
      return { 
        status: 'api_error', 
        error: `API call failed: ${response.status}`,
        feedGuid
      };
    }
    
    const data = await response.json();
    
    if (data.feed && data.feed.length > 0) {
      return { 
        status: 'indexed', 
        feedGuid,
        podcastData: data.feed[0],
        feedId: data.feed[0].id
      };
    } else {
      return { 
        status: 'not_indexed', 
        feedGuid,
        description: data.description || 'No feeds match this guid'
      };
    }
    
  } catch (error) {
    return { 
      status: 'error', 
      error: error.message,
      feedGuid
    };
  }
}

async function main() {
  console.log('🔍 Discovering which HGH tracks are indexed in Podcast Index...\n');
  
  // Check if output directory exists, create if not
  try {
    await fs.access(OUTPUT_DIR);
  } catch {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created output directory: ${OUTPUT_DIR}`);
  }
  
  // Load HGH remote items
  console.log('📖 Loading HGH remote items...');
  const hghData = JSON.parse(await fs.readFile(HGH_REMOTE_ITEMS_FILE, 'utf8'));
  const allTracks = hghData.remoteItems || hghData;
  
  // Take a sample for testing
  const tracks = allTracks.slice(0, SAMPLE_SIZE);
  
  console.log(`📊 Testing with first ${tracks.length} tracks (out of ${allTracks.length} total)\n`);
  
  const results = [];
  let indexedCount = 0;
  let notIndexedCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    console.log(`\n🔍 [${i + 1}/${tracks.length}] Checking: ${track.feedGuid.substring(0, 8)}...`);
    
    const result = await checkPodcastIndex(track.feedGuid);
    results.push({
      ...track,
      indexStatus: result
    });
    
    // Log the result
    if (result.status === 'indexed') {
      console.log(`   ✅ INDEXED: ${result.podcastData.title || 'Unknown Title'}`);
      console.log(`      Feed ID: ${result.feedId}`);
      indexedCount++;
    } else if (result.status === 'not_indexed') {
      console.log(`   ❌ NOT INDEXED: ${result.description}`);
      notIndexedCount++;
    } else {
      console.log(`   💥 ERROR: ${result.error}`);
      errorCount++;
    }
    
    // Add delay between requests
    if (i < tracks.length - 1) {
      console.log(`   ⏳ Waiting 1 second...`);
      await delay(1000);
    }
  }
  
  // Create summary
  const summary = {
    totalTracks: tracks.length,
    indexed: indexedCount,
    notIndexed: notIndexedCount,
    errors: errorCount,
    indexingRate: ((indexedCount / tracks.length) * 100).toFixed(1),
    timestamp: new Date().toISOString()
  };
  
  // Save results
  const discoveryFile = path.join(OUTPUT_DIR, 'indexing-discovery-results.json');
  await fs.writeFile(discoveryFile, JSON.stringify({
    summary,
    results,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  console.log('\n📊 Discovery Results Summary:');
  console.log(`Total Tracks Tested: ${summary.totalTracks}`);
  console.log(`✅ Indexed in Podcast Index: ${summary.indexed}`);
  console.log(`❌ Not Indexed: ${summary.notIndexed}`);
  console.log(`💥 Errors: ${summary.errors}`);
  console.log(`📈 Indexing Rate: ${summary.indexingRate}%`);
  console.log(`\n📁 Results saved to: ${discoveryFile}`);
  
  if (indexedCount > 0) {
    console.log('\n💡 Next steps for indexed tracks:');
    console.log('1. Use the bulk resolution script for indexed tracks');
    console.log('2. Create a separate process for non-indexed tracks');
    
    // Show some examples of indexed tracks
    const indexedTracks = results.filter(r => r.indexStatus.status === 'indexed');
    console.log('\n📋 Examples of indexed tracks:');
    indexedTracks.slice(0, 3).forEach((track, i) => {
      const podcast = track.indexStatus.podcastData;
      console.log(`   ${i + 1}. ${podcast.title || 'Unknown'} (Feed ID: ${track.indexStatus.feedId})`);
    });
  }
  
  if (notIndexedCount > 0) {
    console.log('\n⚠️  For non-indexed tracks, you may need to:');
    console.log('1. Find the original RSS feed URLs manually');
    console.log('2. Check if feeds are still active');
    console.log('3. Look for alternative sources');
  }
  
  // Estimate total indexed tracks
  const estimatedTotalIndexed = Math.round((indexedCount / tracks.length) * allTracks.length);
  console.log(`\n📊 Estimated total indexed tracks: ~${estimatedTotalIndexed} out of ${allTracks.length}`);
}

main().catch(error => {
  console.error('💥 Discovery script failed:', error);
  process.exit(1);
});
