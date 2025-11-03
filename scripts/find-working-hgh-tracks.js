#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const fs = require('fs').promises;
const path = require('path');

// Configuration
const HGH_REMOTE_ITEMS_FILE = 'data/hgh-analysis/hgh-remote-items.json';
const OUTPUT_DIR = 'data/hgh-resolved-tracks';
const BATCH_SIZE = 25; // Process in small batches to find working tracks quickly

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

async function checkIfTrackIsIndexed(feedGuid, itemGuid) {
  const headers = generateAuthHeaders();
  
  try {
    // Check if the podcast is indexed
    const podcastUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;
    const podcastResponse = await fetch(podcastUrl, { headers });
    
    if (!podcastResponse.ok) {
      return { 
        status: 'api_error', 
        error: `API call failed: ${podcastResponse.status}`,
        feedGuid,
        itemGuid
      };
    }
    
    const podcastData = await podcastResponse.json();
    
    if (!podcastData.feed || podcastData.feed.length === 0) {
      return { 
        status: 'not_indexed', 
        feedGuid,
        itemGuid,
        description: podcastData.description || 'No feeds match this guid'
      };
    }
    
    const podcast = podcastData.feed[0];
    
    // Now check if we can get episodes from this feed
    const episodesUrl = `https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${podcast.id}&max=200`;
    const episodesResponse = await fetch(episodesUrl, { headers });
    
    if (!episodesResponse.ok) {
      return { 
        status: 'episodes_fetch_failed', 
        feedGuid,
        itemGuid,
        podcast,
        error: `Episodes fetch failed: ${episodesResponse.status}`
      };
    }
    
    const episodesData = await episodesResponse.json();
    
    // Look for our specific itemGuid
    const targetEpisode = episodesData.items?.find(ep => ep.guid === itemGuid);
    
    if (!targetEpisode) {
      return { 
        status: 'episode_not_found', 
        feedGuid,
        itemGuid,
        podcast,
        episodesCount: episodesData.items?.length || 0
      };
    }
    
    // Success! This track is fully indexed and resolvable
    return {
      status: 'fully_indexed',
      feedGuid,
      itemGuid,
      podcast,
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
    
    console.log(`\n🔍 [${trackIndex}/${tracks.length}] Checking: ${track.feedGuid.substring(0, 8)}...`);
    
    const result = await checkIfTrackIsIndexed(track.feedGuid, track.itemGuid);
    results.push(result);
    
    // Log the result
    if (result.status === 'fully_indexed') {
      console.log(`   ✅ FULLY INDEXED: ${result.episode.title}`);
      console.log(`      Podcast: ${result.podcast.title}`);
      console.log(`      Feed ID: ${result.podcast.id}`);
    } else if (result.status === 'not_indexed') {
      console.log(`   ❌ NOT INDEXED: ${result.description}`);
    } else if (result.status === 'episode_not_found') {
      console.log(`   ⚠️  PODCAST INDEXED, EPISODE NOT FOUND`);
      console.log(`      Podcast: ${result.podcast.title}`);
    } else {
      console.log(`   💥 ${result.status.toUpperCase()}: ${result.error}`);
    }
    
    // Add delay between requests
    if (i < batch.length - 1) {
      await delay(1000);
    }
  }
  
  return results;
}

async function main() {
  console.log('🔍 Finding Working HGH Tracks (Indexed in Podcast Index)...\n');
  
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
  
  console.log(`📊 Found ${allTracks.length} tracks to check\n`);
  
  if (allTracks.length === 0) {
    console.log('❌ No tracks found to check');
    return;
  }
  
  const allResults = [];
  const totalBatches = Math.ceil(allTracks.length / BATCH_SIZE);
  
  console.log(`🔄 Processing ${allTracks.length} tracks in ${totalBatches} batches of ${BATCH_SIZE}`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIndex = batchIndex * BATCH_SIZE;
    const batchResults = await processBatch(allTracks, startIndex);
    allResults.push(...batchResults);
    
    // Save batch results
    const batchFile = path.join(OUTPUT_DIR, `batch-${batchIndex + 1}-results.json`);
    await fs.writeFile(batchFile, JSON.stringify(batchResults, null, 2));
    console.log(`💾 Saved batch ${batchIndex + 1} results`);
    
    // Add delay between batches (except for the last batch)
    if (batchIndex < totalBatches - 1) {
      console.log(`\n⏳ Waiting 2 seconds before next batch...`);
      await delay(2000);
    }
  }
  
  // Create final summary
  const summary = {
    totalTracks: allResults.length,
    fullyIndexed: allResults.filter(r => r.status === 'fully_indexed').length,
    notIndexed: allResults.filter(r => r.status === 'not_indexed').length,
    episodeNotFound: allResults.filter(r => r.status === 'episode_not_found').length,
    apiErrors: allResults.filter(r => r.status === 'api_error').length,
    otherErrors: allResults.filter(r => !['fully_indexed', 'not_indexed', 'episode_not_found', 'api_error'].includes(r.status)).length,
    timestamp: new Date().toISOString()
  };
  
  // Save all results
  const allResultsFile = path.join(OUTPUT_DIR, 'all-tracks-indexing-status.json');
  await fs.writeFile(allResultsFile, JSON.stringify({
    summary,
    results: allResults,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  // Save only the working tracks
  const workingTracks = allResults.filter(r => r.status === 'fully_indexed');
  const workingTracksFile = path.join(OUTPUT_DIR, 'working-indexed-tracks.json');
  await fs.writeFile(workingTracksFile, JSON.stringify(workingTracks, null, 2));
  
  console.log('\n📊 Final Results Summary:');
  console.log(`Total Tracks Checked: ${summary.totalTracks}`);
  console.log(`✅ Fully Indexed (Ready to Process): ${summary.fullyIndexed}`);
  console.log(`❌ Not Indexed: ${summary.notIndexed}`);
  console.log(`⚠️  Podcast Indexed, Episode Not Found: ${summary.episodeNotFound}`);
  console.log(`💥 API Errors: ${summary.apiErrors}`);
  console.log(`💥 Other Errors: ${summary.otherErrors}`);
  console.log(`\n📁 All results saved to: ${allResultsFile}`);
  console.log(`📁 Working tracks saved to: ${workingTracksFile}`);
  
  if (summary.fullyIndexed > 0) {
    console.log(`\n🎉 Found ${summary.fullyIndexed} tracks that can be processed!`);
    console.log('💡 Next steps:');
    console.log('1. Use the working tracks from working-indexed-tracks.json');
    console.log('2. Process them using your proven method');
    console.log('3. For non-indexed tracks, consider manual feed discovery');
    
    // Show some examples
    console.log('\n📋 Examples of working tracks:');
    workingTracks.slice(0, 3).forEach((track, i) => {
      console.log(`   ${i + 1}. ${track.episode.title} - ${track.podcast.title}`);
    });
  } else {
    console.log('\n⚠️  No tracks are fully indexed in Podcast Index.');
    console.log('💡 This suggests the current HGH playlist contains all new tracks.');
    console.log('   You may need to wait for Podcast Index to crawl these feeds,');
    console.log('   or manually discover the original RSS feed URLs.');
  }
}

main().catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});
