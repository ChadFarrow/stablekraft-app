#!/usr/bin/env node
// Search Podcast Index for Lightning Thrashes placeholder tracks using text search

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
function loadEnvLocal() {
  try {
    const envPath = path.join(__dirname, '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf8');
    
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    });
    
    console.log('✅ Loaded .env.local');
  } catch (error) {
    console.log('⚠️ Could not load .env.local:', error.message);
  }
}

loadEnvLocal();

async function searchPodcastIndex(query, maxResults = 10) {
  try {
    const apiKey = process.env.PODCAST_INDEX_API_KEY;
    const apiSecret = process.env.PODCAST_INDEX_API_SECRET;
    
    if (!apiKey || !apiSecret) {
      console.log('❌ Missing Podcast Index API credentials');
      return null;
    }

    const crypto = require('crypto');
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash('sha1');
    hash.update(apiKey + apiSecret + apiHeaderTime);
    const hashString = hash.digest('hex');

    const headers = {
      'X-Auth-Key': apiKey,
      'X-Auth-Date': apiHeaderTime.toString(),
      'Authorization': hashString,
      'User-Agent': 're.podtards.com'
    };

    // Search for episodes by term
    const searchUrl = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(query)}&max=${maxResults}`;
    console.log(`🔍 Searching for: "${query}"`);
    
    const response = await fetch(searchUrl, { headers });
    const data = await response.json();
    
    if (data.status !== 'true' || !data.feeds) {
      console.log(`❌ No results for: "${query}"`);
      return null;
    }
    
    console.log(`📊 Found ${data.feeds.length} results for: "${query}"`);
    return data.feeds;
    
  } catch (error) {
    console.error(`❌ Error searching for ${query}:`, error.message);
    return null;
  }
}

async function searchForPlaceholderTracks() {
  console.log('🔍 Searching Podcast Index for Lightning Thrashes placeholder tracks...');
  
  try {
    const dataPath = path.join(__dirname, 'public', 'music-tracks.json');
    const dataContent = fs.readFileSync(dataPath, 'utf8');
    const parsedData = JSON.parse(dataContent);
    const musicTracksData = parsedData.musicTracks || [];
    
    // Find Lightning Thrashes tracks with 5-minute placeholders
    const placeholderTracks = musicTracksData.filter(track => 
      track.feedUrl?.includes('lightning-thrashes') &&
      track.duration === 300 &&
      track.valueForValue?.resolved === false &&
      track.title?.includes('Lightning Thrashes Track')
    );
    
    console.log(`📊 Found ${placeholderTracks.length} Lightning Thrashes placeholder tracks to search for`);
    
    for (const track of placeholderTracks) {
      console.log(`\n🔍 Searching for: ${track.title} (${track.valueForValue?.feedGuid})`);
      
      // Try different search queries
      const searchQueries = [
        track.valueForValue?.feedGuid, // Search by GUID
        `Lightning Thrashes ${track.playlistInfo?.episodeNumber}`, // Episode number
        `Lightning Thrashes Episode ${track.playlistInfo?.episodeNumber}`, // Full episode title
      ];
      
      for (const query of searchQueries) {
        if (!query) continue;
        
        const results = await searchPodcastIndex(query, 5);
        
        if (results && results.length > 0) {
          console.log(`✅ Found ${results.length} potential matches for "${query}":`);
          results.forEach((feed, index) => {
            console.log(`  ${index + 1}. "${feed.title}" by "${feed.author}" (ID: ${feed.id})`);
            console.log(`     URL: ${feed.url}`);
            console.log(`     Description: ${feed.description?.substring(0, 100)}...`);
          });
          break; // Found results, no need to try other queries
        }
        
        // Wait between searches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
  } catch (error) {
    console.error('❌ Error searching for placeholder tracks:', error);
  }
}

searchForPlaceholderTracks().catch(console.error);