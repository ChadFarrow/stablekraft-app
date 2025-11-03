#!/usr/bin/env node

/**
 * Recover missing tracks by retrying failed resolutions with better error handling
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Generate required headers for Podcast Index API
async function generateHeaders(apiKey, apiSecret) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  
  // Generate SHA1 hash for authentication
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft-Track-Recovery/1.0'
  };
}

// Enhanced resolve function with better error handling
async function resolveItemGuidEnhanced(feedGuid, itemGuid) {
  try {
    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    // Approach 1: Try to resolve via feed GUID first
    const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (feedResponse.ok) {
      const feedData = await feedResponse.json();
      
      // Handle different response structures
      let feed = null;
      if (feedData.status === 'true') {
        feed = feedData.feed || (feedData.feeds && feedData.feeds[0]);
      }
      
      if (feed && feed.id) {
        const feedId = feed.id;
        const feedTitle = feed.title;
        
        // Get episodes from this feed with larger limit
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feedId}&max=1000`, {
          headers
        });
        
        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();
          if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
            
            // Find the specific episode by GUID
            const episode = episodesData.items.find((ep) => ep.guid === itemGuid);
            if (episode) {
              return {
                guid: episode.guid,
                title: episode.title,
                description: episode.description || '',
                audioUrl: episode.enclosureUrl || '',
                duration: episode.duration || 0,
                image: episode.image || feed.image || '/placeholder-podcast.jpg',
                publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),
                feedGuid: feedGuid,
                feedTitle: feedTitle,
                feedImage: feed.image,
                method: 'feed_lookup'
              };
            }
          }
        }
      }
    }
    
    // Approach 2: Direct episode GUID lookup as fallback
    const episodeResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${encodeURIComponent(itemGuid)}`, {
      headers
    });
    
    if (episodeResponse.ok) {
      const episodeData = await episodeResponse.json();
      if (episodeData.status === 'true' && episodeData.episode) {
        const episode = episodeData.episode;
        return {
          guid: episode.guid,
          title: episode.title,
          description: episode.description || '',
          audioUrl: episode.enclosureUrl || '',
          duration: episode.duration || 0,
          image: episode.image || '/placeholder-podcast.jpg',
          publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),
          feedGuid: episode.feedGuid || feedGuid,
          feedTitle: episode.feedTitle || 'Unknown Feed',
          feedImage: episode.feedImage,
          method: 'direct_lookup'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error resolving ${itemGuid}:`, error.message);
    return null;
  }
}

async function recoverMissingTracks() {
  try {
    console.log('🔄 Attempting to recover missing tracks from Upbeats playlist...\n');
    
    // Load missing tracks data
    const missingDataPath = path.join(process.cwd(), 'data/missing-upbeats-tracks.json');
    if (!fs.existsSync(missingDataPath)) {
      throw new Error('Missing tracks data not found. Run find-missing-upbeats-tracks.js first.');
    }
    
    const missingData = JSON.parse(fs.readFileSync(missingDataPath, 'utf8'));
    const missingItems = missingData.missingItems;
    
    console.log(`📋 Attempting to recover ${missingItems.length} missing tracks...`);
    
    const recoveredTracks = [];
    const stillMissing = [];
    
    // Process in smaller batches to avoid rate limiting
    const batchSize = 5;
    const totalBatches = Math.ceil(missingItems.length / batchSize);
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, missingItems.length);
      const batch = missingItems.slice(start, end);
      
      console.log(`\n📦 Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} items)...`);
      
      for (const item of batch) {
        const result = await resolveItemGuidEnhanced(item.feedGuid, item.itemGuid);
        
        if (result && result.audioUrl && result.audioUrl.length > 0) {
          recoveredTracks.push({
            ...item,
            resolvedData: result
          });
          console.log(`  ✅ Recovered: "${result.title}" (${result.method})`);
        } else {
          stillMissing.push(item);
          console.log(`  ❌ Still missing: ${item.itemGuid.slice(0, 16)}...`);
        }
        
        // Small delay between items to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Longer delay between batches
      if (batchIndex < totalBatches - 1) {
        console.log(`  ⏳ Waiting 2s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Results
    console.log('\n' + '='.repeat(60));
    console.log('📊 RECOVERY RESULTS:');
    console.log(`   Original missing: ${missingItems.length}`);
    console.log(`   Successfully recovered: ${recoveredTracks.length} (${((recoveredTracks.length / missingItems.length) * 100).toFixed(1)}%)`);
    console.log(`   Still missing: ${stillMissing.length} (${((stillMissing.length / missingItems.length) * 100).toFixed(1)}%)`);
    
    if (recoveredTracks.length > 0) {
      console.log('\n🎉 RECOVERED TRACKS:');
      recoveredTracks.forEach((track, i) => {
        console.log(`  ${i + 1}. "${track.resolvedData.title}" by ${track.resolvedData.feedTitle}`);
      });
    }
    
    // Update original missing data and new resolution rate
    const originalTotal = missingData.totalOriginal;
    const newResolvedCount = missingData.totalResolved + recoveredTracks.length;
    const newMissingCount = originalTotal - newResolvedCount;
    const newResolutionRate = ((newResolvedCount / originalTotal) * 100).toFixed(1);
    
    console.log('\n📈 UPDATED PLAYLIST STATISTICS:');
    console.log(`   Total tracks in playlist: ${originalTotal}`);
    console.log(`   Previously resolved: ${missingData.totalResolved} (${((missingData.totalResolved / originalTotal) * 100).toFixed(1)}%)`);
    console.log(`   Newly recovered: ${recoveredTracks.length}`);
    console.log(`   Total now resolved: ${newResolvedCount} (${newResolutionRate}%)`);
    console.log(`   Still missing: ${newMissingCount} (${((newMissingCount / originalTotal) * 100).toFixed(1)}%)`);
    
    console.log('='.repeat(60));
    
    // Save recovery results
    const recoveryResultsPath = path.join(process.cwd(), 'data/track-recovery-results.json');
    const recoveryResults = {
      timestamp: new Date().toISOString(),
      originalMissing: missingItems.length,
      recovered: recoveredTracks.length,
      stillMissing: stillMissing.length,
      recoveredTracks: recoveredTracks,
      stillMissingItems: stillMissing,
      updatedStats: {
        totalOriginal: originalTotal,
        totalResolved: newResolvedCount,
        resolutionRate: parseFloat(newResolutionRate)
      }
    };
    
    fs.writeFileSync(recoveryResultsPath, JSON.stringify(recoveryResults, null, 2));
    console.log(`💾 Recovery results saved to: ${recoveryResultsPath}`);
    
    // If we recovered tracks, suggest next steps
    if (recoveredTracks.length > 0) {
      console.log(`\n💡 NEXT STEPS:`);
      console.log(`   1. Clear playlist cache: /api/playlist/upbeats?refresh=true`);
      console.log(`   2. The recovered tracks should now appear in the playlist`);
      console.log(`   3. Run feed discovery to ensure these feeds are in the database`);
    }
    
  } catch (error) {
    console.error('❌ Error recovering missing tracks:', error);
    process.exit(1);
  }
}

// Run the recovery
if (require.main === module) {
  recoverMissingTracks();
}

module.exports = { recoverMissingTracks };