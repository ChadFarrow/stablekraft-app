#!/usr/bin/env node

/**
 * Find missing tracks in Upbeats playlist
 * Compares the original playlist XML with the resolved API response
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const UPBEATS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml';

// Parse remote items from playlist XML
function parseRemoteItems(xmlText) {
  const remoteItems = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
  
  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    const feedGuid = match[1];
    const itemGuid = match[2];
    
    if (feedGuid && itemGuid) {
      remoteItems.push({ feedGuid, itemGuid });
    }
  }
  
  return remoteItems;
}

async function findMissingTracks() {
  try {
    console.log('🔍 Analyzing missing tracks in Upbeats playlist...\n');
    
    // Step 1: Get original playlist items
    const playlistResponse = await fetch(UPBEATS_PLAYLIST_URL);
    const xmlText = await playlistResponse.text();
    const originalItems = parseRemoteItems(xmlText);
    
    console.log(`📋 Original playlist items: ${originalItems.length}`);
    
    // Step 2: Get resolved tracks from API
    const apiResponse = await fetch('http://localhost:3000/api/playlist/upbeats');
    const apiData = await apiResponse.json();
    const resolvedTracks = apiData.albums[0].tracks;
    
    console.log(`✅ API resolved tracks: ${resolvedTracks.length}`);
    
    // Step 3: Create a map of resolved itemGuids
    const resolvedItemGuids = new Set(resolvedTracks.map(track => track.itemGuid));
    
    // Step 4: Find missing items
    const missingItems = originalItems.filter(item => !resolvedItemGuids.has(item.itemGuid));
    
    console.log(`❌ Missing tracks: ${missingItems.length}\n`);
    
    if (missingItems.length > 0) {
      console.log('🔍 MISSING TRACKS ANALYSIS:\n');
      
      // Group by feedGuid to see patterns
      const missingByFeed = {};
      missingItems.forEach(item => {
        if (!missingByFeed[item.feedGuid]) {
          missingByFeed[item.feedGuid] = [];
        }
        missingByFeed[item.feedGuid].push(item.itemGuid);
      });
      
      // Show missing tracks grouped by feed
      const feedGuids = Object.keys(missingByFeed);
      console.log(`📊 Missing tracks spread across ${feedGuids.length} unique feeds:\n`);
      
      for (const [feedGuid, itemGuids] of Object.entries(missingByFeed)) {
        console.log(`Feed: ${feedGuid.slice(0, 32)}...`);
        console.log(`  Missing items: ${itemGuids.length}`);
        console.log(`  Sample item GUIDs: ${itemGuids.slice(0, 3).map(g => g.slice(0, 16) + '...').join(', ')}`);
        console.log('');
      }
      
      // Sample specific missing items for manual investigation
      console.log('🔬 SAMPLE MISSING ITEMS FOR INVESTIGATION:\n');
      const sampleMissing = missingItems.slice(0, 5);
      
      for (const [i, item] of sampleMissing.entries()) {
        console.log(`${i + 1}. Feed GUID: ${item.feedGuid}`);
        console.log(`   Item GUID: ${item.itemGuid}`);
        console.log(`   Podcast Index Feed URL: https://podcastindex.org/podcast/${item.feedGuid}`);
        console.log('');
      }
      
      // Save missing items to file for further analysis
      const outputPath = path.join(process.cwd(), 'data/missing-upbeats-tracks.json');
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const missingData = {
        timestamp: new Date().toISOString(),
        totalOriginal: originalItems.length,
        totalResolved: resolvedTracks.length,
        totalMissing: missingItems.length,
        missingPercentage: ((missingItems.length / originalItems.length) * 100).toFixed(1),
        missingItems: missingItems,
        missingByFeed: missingByFeed
      };
      
      fs.writeFileSync(outputPath, JSON.stringify(missingData, null, 2));
      console.log(`💾 Detailed missing tracks data saved to: ${outputPath}`);
      
      console.log('\n' + '='.repeat(60));
      console.log('📊 SUMMARY:');
      console.log(`   Original playlist items: ${originalItems.length}`);
      console.log(`   Successfully resolved: ${resolvedTracks.length} (${((resolvedTracks.length/originalItems.length)*100).toFixed(1)}%)`);
      console.log(`   Missing/unresolved: ${missingItems.length} (${((missingItems.length/originalItems.length)*100).toFixed(1)}%)`);
      console.log(`   Unique feeds with missing tracks: ${feedGuids.length}`);
      console.log('='.repeat(60));
      
    } else {
      console.log('🎉 No missing tracks found! All playlist items are resolved.');
    }
    
  } catch (error) {
    console.error('❌ Error analyzing missing tracks:', error);
    process.exit(1);
  }
}

// Run the analysis
if (require.main === module) {
  findMissingTracks();
}

module.exports = { findMissingTracks };