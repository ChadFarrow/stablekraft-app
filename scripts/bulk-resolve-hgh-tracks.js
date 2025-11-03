#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const fs = require('fs').promises;
const path = require('path');

// Configuration
const HGH_REMOTE_ITEMS_FILE = 'data/hgh-analysis/hgh-remote-items.json';
const OUTPUT_DIR = 'data/hgh-resolved-tracks';
const BATCH_SIZE = 10; // Process in batches to avoid rate limiting
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches

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

async function lookupTrack(feedGuid, itemGuid) {
  const headers = generateAuthHeaders();
  
  try {
    // First, try to find the podcast by feedGuid
    const podcastUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;
    const podcastResponse = await fetch(podcastUrl, { headers });
    
    if (!podcastResponse.ok) {
      return { 
        status: 'podcast_not_found', 
        error: `Podcast lookup failed: ${podcastResponse.status}`,
        feedGuid,
        itemGuid
      };
    }
    
    const podcastData = await podcastResponse.json();
    
    if (!podcastData.feed || !podcastData.feed.id) {
      return { 
        status: 'podcast_no_feed_id', 
        error: 'Podcast found but no feed ID',
        feedGuid,
        itemGuid,
        podcastData
      };
    }
    
    // Now try to get episodes from the feed
    const episodesUrl = `https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${podcastData.feed.id}&max=200`;
    const episodesResponse = await fetch(episodesUrl, { headers });
    
    if (!episodesResponse.ok) {
      return { 
        status: 'episodes_fetch_failed', 
        error: `Episodes fetch failed: ${episodesResponse.status}`,
        feedGuid,
        itemGuid,
        podcastData
      };
    }
    
    const episodesData = await episodesResponse.json();
    
    // Look for our specific itemGuid
    const targetEpisode = episodesData.items?.find(ep => ep.guid === itemGuid);
    
    if (!targetEpisode) {
      return { 
        status: 'episode_not_found', 
        error: 'Episode not found in feed',
        feedGuid,
        itemGuid,
        podcastData,
        episodesCount: episodesData.items?.length || 0
      };
    }
    
    // Success! Return the resolved track data
    return {
      status: 'resolved',
      feedGuid,
      itemGuid,
      podcast: podcastData.feed,
      episode: targetEpisode,
      resolvedAt: new Date().toISOString()
    };
    
  } catch (error) {
    return { 
      status: 'error', 
      error: error.message,
      feedGuid,
      itemGuid
    };
  }
}

async function processBatch(tracks, startIndex) {
  const batch = tracks.slice(startIndex, startIndex + BATCH_SIZE);
  const results = [];
  
  console.log(`\n📦 Processing batch ${Math.floor(startIndex / BATCH_SIZE) + 1} (tracks ${startIndex + 1}-${Math.min(startIndex + BATCH_SIZE, tracks.length)})`);
  
  for (let i = 0; i < batch.length; i++) {
    const track = batch[i];
    const trackIndex = startIndex + i + 1;
    
    console.log(`\n🔍 [${trackIndex}/${tracks.length}] Looking up: ${track.feedGuid.substring(0, 8)}... / ${track.itemGuid.substring(0, 8)}...`);
    
    const result = await lookupTrack(track.feedGuid, track.itemGuid);
    results.push(result);
    
    // Add a small delay between individual requests
    if (i < batch.length - 1) {
      await delay(500);
    }
    
    // Log the result
    if (result.status === 'resolved') {
      console.log(`✅ Resolved: ${result.episode.title}`);
    } else {
      console.log(`❌ ${result.status}: ${result.error}`);
    }
  }
  
  return results;
}

async function saveResults(results, batchNumber) {
  const filename = `batch-${batchNumber.toString().padStart(3, '0')}-${Date.now()}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);
  
  await fs.writeFile(filepath, JSON.stringify(results, null, 2));
  console.log(`💾 Saved batch ${batchNumber} results to: ${filepath}`);
  
  return filepath;
}

async function createSummaryReport(allResults) {
  const summary = {
    totalTracks: allResults.length,
    resolved: allResults.filter(r => r.status === 'resolved').length,
    podcastNotFound: allResults.filter(r => r.status === 'podcast_not_found').length,
    podcastNoFeedId: allResults.filter(r => r.status === 'podcast_no_feed_id').length,
    episodesFetchFailed: allResults.filter(r => r.status === 'episodes_fetch_failed').length,
    episodeNotFound: allResults.filter(r => r.status === 'episode_not_found').length,
    errors: allResults.filter(r => r.status === 'error').length,
    timestamp: new Date().toISOString(),
    statusBreakdown: {}
  };
  
  // Count by status
  allResults.forEach(result => {
    summary.statusBreakdown[result.status] = (summary.statusBreakdown[result.status] || 0) + 1;
  });
  
  // Save summary
  const summaryFile = path.join(OUTPUT_DIR, 'resolution-summary.json');
  await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2));
  
  // Save all resolved tracks
  const resolvedTracks = allResults.filter(r => r.status === 'resolved');
  const resolvedFile = path.join(OUTPUT_DIR, 'all-resolved-tracks.json');
  await fs.writeFile(resolvedFile, JSON.stringify(resolvedTracks, null, 2));
  
  console.log('\n📊 Resolution Summary:');
  console.log(`Total Tracks: ${summary.totalTracks}`);
  console.log(`✅ Resolved: ${summary.resolved}`);
  console.log(`❌ Podcast Not Found: ${summary.podcastNotFound}`);
  console.log(`❌ Podcast No Feed ID: ${summary.podcastNoFeedId}`);
  console.log(`❌ Episodes Fetch Failed: ${summary.episodesFetchFailed}`);
  console.log(`❌ Episode Not Found: ${summary.episodeNotFound}`);
  console.log(`💥 Errors: ${summary.errors}`);
  
  return summary;
}

async function main() {
  console.log('🚀 Starting bulk resolution of HGH tracks...\n');
  
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
  const tracks = hghData.remoteItems || hghData;
  
  console.log(`📊 Found ${tracks.length} tracks to resolve\n`);
  
  if (tracks.length === 0) {
    console.log('❌ No tracks found to resolve');
    return;
  }
  
  const allResults = [];
  const totalBatches = Math.ceil(tracks.length / BATCH_SIZE);
  
  console.log(`🔄 Processing ${tracks.length} tracks in ${totalBatches} batches of ${BATCH_SIZE}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIndex = batchIndex * BATCH_SIZE;
    const batchResults = await processBatch(tracks, startIndex);
    allResults.push(...batchResults);
    
    // Save batch results
    await saveResults(batchResults, batchIndex + 1);
    
    // Add delay between batches (except for the last batch)
    if (batchIndex < totalBatches - 1) {
      console.log(`\n⏳ Waiting ${DELAY_BETWEEN_BATCHES / 1000}s before next batch...`);
      await delay(DELAY_BETWEEN_BATCHES);
    }
  }
  
  // Create final summary
  console.log('\n📋 Creating final summary...');
  const summary = await createSummaryReport(allResults);
  
  console.log('\n🎉 Bulk resolution completed!');
  console.log(`📁 Results saved to: ${OUTPUT_DIR}`);
  console.log(`📊 Successfully resolved: ${summary.resolved}/${summary.totalTracks} tracks`);
  
  if (summary.resolved > 0) {
    console.log('\n💡 Next steps:');
    console.log('1. Review the resolved tracks in all-resolved-tracks.json');
    console.log('2. Use the data to add tracks to your music-tracks.json database');
    console.log('3. Investigate failed resolutions for potential issues');
  }
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

main().catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
