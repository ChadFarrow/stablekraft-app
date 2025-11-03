#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const fs = require('fs').promises;
const path = require('path');

// Configuration
const HGH_REMOTE_ITEMS_FILE = 'data/hgh-analysis/hgh-remote-items.json';
const OUTPUT_DIR = 'data/hgh-resolved-tracks';
const SAMPLE_SIZE = 20; // Start with a smaller sample for investigation

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

async function searchPodcastIndexByTerm(searchTerm) {
  const headers = generateAuthHeaders();
  
  try {
    const searchUrl = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(searchTerm)}&type=music&max=10`;
    const response = await fetch(searchUrl, { headers });
    
    if (!response.ok) {
      return { 
        status: 'search_failed', 
        error: `Search failed: ${response.status}`,
        searchTerm
      };
    }
    
    const data = await response.json();
    return {
      status: 'success',
      searchTerm,
      results: data
    };
    
  } catch (error) {
    return { 
      status: 'error', 
      error: error.message,
      searchTerm
    };
  }
}

async function investigateFeedGuid(feedGuid, itemGuid) {
  console.log(`\n🔍 Investigating feedGuid: ${feedGuid}`);
  console.log(`   itemGuid: ${itemGuid}`);
  
  const investigation = {
    feedGuid,
    itemGuid,
    approaches: []
  };
  
  // Approach 1: Try to find the podcast in Podcast Index
  console.log(`   📡 Approach 1: Checking Podcast Index...`);
  const podcastUrl = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;
  const headers = generateAuthHeaders();
  
  try {
    const response = await fetch(podcastUrl, { headers });
    const data = await response.json();
    
    if (data.feed && data.feed.length > 0) {
      const podcast = data.feed[0];
      console.log(`      ✅ Found in Podcast Index: ${podcast.title}`);
      console.log(`         Feed URL: ${podcast.url}`);
      console.log(`         Feed ID: ${podcast.id}`);
      
      investigation.approaches.push({
        method: 'podcast_index_direct',
        success: true,
        data: podcast
      });
    } else {
      console.log(`      ❌ Not found in Podcast Index: ${data.description}`);
      
      investigation.approaches.push({
        method: 'podcast_index_direct',
        success: false,
        error: data.description
      });
    }
  } catch (error) {
    console.log(`      💥 Error checking Podcast Index: ${error.message}`);
    investigation.approaches.push({
      method: 'podcast_index_direct',
      success: false,
      error: error.message
    });
  }
  
  // Approach 2: Try searching for common music terms to see if we can find related feeds
  console.log(`   🔍 Approach 2: Searching for music content...`);
  const searchTerms = ['music', 'album', 'song', 'track'];
  
  for (const term of searchTerms) {
    const searchResult = await searchPodcastIndexByTerm(term);
    
    if (searchResult.status === 'success' && searchResult.results.feeds && searchResult.results.feeds.length > 0) {
      console.log(`      📋 Found ${searchResult.results.feeds.length} feeds for "${term}"`);
      
      // Look for feeds that might be related (music type, recent updates, etc.)
      const musicFeeds = searchResult.results.feeds.filter(feed => 
        feed.medium === 'music' || 
        feed.title.toLowerCase().includes('music') ||
        feed.title.toLowerCase().includes('album')
      );
      
      if (musicFeeds.length > 0) {
        console.log(`         🎵 ${musicFeeds.length} music-related feeds found`);
        investigation.approaches.push({
          method: 'music_search',
          searchTerm: term,
          success: true,
          musicFeeds: musicFeeds.slice(0, 3) // Keep top 3
        });
      }
    }
    
    await delay(500); // Small delay between searches
  }
  
  // Approach 3: Try to find the original HGH playlist to see if it has feed URLs
  console.log(`   📖 Approach 3: Checking HGH playlist source...`);
  
  try {
    const hghPlaylistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
    const playlistResponse = await fetch(hghPlaylistUrl);
    
    if (playlistResponse.ok) {
      const playlistContent = await playlistResponse.text();
      
      // Look for any feed URLs in the playlist
      const feedUrlMatches = playlistContent.match(/<link[^>]*>([^<]+)<\/link>/g);
      if (feedUrlMatches) {
        console.log(`      🔗 Found ${feedUrlMatches.length} link elements in HGH playlist`);
        investigation.approaches.push({
          method: 'hgh_playlist_links',
          success: true,
          linkCount: feedUrlMatches.length
        });
      }
      
      // Look for any URLs that might be feed URLs
      const urlMatches = playlistContent.match(/https?:\/\/[^\s"<>]+/g);
      if (urlMatches) {
        const feedUrls = urlMatches.filter(url => 
          url.includes('.xml') || 
          url.includes('feed') || 
          url.includes('rss')
        );
        console.log(`      🌐 Found ${feedUrls.length} potential feed URLs in playlist`);
        investigation.approaches.push({
          method: 'hgh_playlist_urls',
          success: true,
          feedUrls: feedUrls.slice(0, 5) // Keep top 5
        });
      }
    } else {
      console.log(`      ❌ Could not fetch HGH playlist: ${playlistResponse.status}`);
    }
  } catch (error) {
    console.log(`      💥 Error fetching HGH playlist: ${error.message}`);
  }
  
  return investigation;
}

async function main() {
  console.log('🔍 Investigating Original RSS Feeds for HGH Tracks...\n');
  
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
  
  // Take a sample for investigation
  const tracks = allTracks.slice(0, SAMPLE_SIZE);
  
  console.log(`📊 Investigating first ${tracks.length} tracks (out of ${allTracks.length} total)\n`);
  
  const investigations = [];
  
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    console.log(`\n🔍 [${i + 1}/${tracks.length}] Processing track...`);
    
    const investigation = await investigateFeedGuid(track.feedGuid, track.itemGuid);
    investigations.push(investigation);
    
    // Add delay between investigations
    if (i < tracks.length - 1) {
      console.log(`   ⏳ Waiting 2 seconds...`);
      await delay(2000);
    }
  }
  
  // Create summary
  const summary = {
    totalTracks: tracks.length,
    approaches: {
      podcast_index_direct: investigations.filter(i => 
        i.approaches.some(a => a.method === 'podcast_index_direct' && a.success)
      ).length,
      music_search: investigations.filter(i => 
        i.approaches.some(a => a.method === 'music_search' && a.success)
      ).length,
      hgh_playlist_links: investigations.filter(i => 
        i.approaches.some(a => a.method === 'hgh_playlist_links' && a.success)
      ).length,
      hgh_playlist_urls: investigations.filter(i => 
        i.approaches.some(a => a.method === 'hgh_playlist_urls' && a.success)
      ).length
    },
    timestamp: new Date().toISOString()
  };
  
  // Save results
  const investigationFile = path.join(OUTPUT_DIR, 'feed-investigation-results.json');
  await fs.writeFile(investigationFile, JSON.stringify({
    summary,
    investigations,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  console.log('\n📊 Investigation Summary:');
  console.log(`Total Tracks Investigated: ${summary.totalTracks}`);
  console.log(`✅ Found in Podcast Index: ${summary.approaches.podcast_index_direct}`);
  console.log(`🔍 Music Search Results: ${summary.approaches.music_search}`);
  console.log(`🔗 HGH Playlist Links: ${summary.approaches.hgh_playlist_links}`);
  console.log(`🌐 HGH Playlist URLs: ${summary.approaches.hgh_playlist_urls}`);
  console.log(`\n📁 Results saved to: ${investigationFile}`);
  
  // Show next steps
  console.log('\n💡 Next Steps:');
  console.log('1. Review the investigation results to understand feed patterns');
  console.log('2. Look for common feed URL patterns in the HGH playlist');
  console.log('3. Try to map feedGuid values to actual RSS feed URLs');
  console.log('4. Consider reaching out to ChadF about the feedGuid mapping');
  
  if (summary.approaches.hgh_playlist_urls > 0) {
    console.log('\n🎯 Key Finding: HGH playlist contains actual feed URLs!');
    console.log('   This suggests feedGuid values might map to these URLs.');
  }
}

main().catch(error => {
  console.error('💥 Investigation script failed:', error);
  process.exit(1);
});
