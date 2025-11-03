#!/usr/bin/env node

/**
 * Discover and add all RSS feeds from playlist references to the site
 * This ensures all tracks from RSS feeds are available on the site, not just in playlists
 */

const fs = require('fs');
const path = require('path');

// Load environment variables for Podcast Index API
require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Playlist URLs
const PLAYLISTS = [
  {
    name: 'IAM',
    url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml'
  },
  {
    name: 'MMM',
    url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml'
  }
];

// Helper function to create auth headers for Podcast Index API
function createPodcastIndexAuthHeaders() {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    console.error('❌ Podcast Index API credentials not found in .env.local');
    return null;
  }
  
  const crypto = require('crypto');
  const apiTime = Math.floor(Date.now() / 1000);
  const authString = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiTime;
  const authHeader = crypto.createHash('sha1').update(authString).digest('hex');
  
  return {
    'User-Agent': 'StableKraft-FeedDiscovery/1.0',
    'X-Auth-Date': apiTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': authHeader
  };
}

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

// Get feed info from Podcast Index API
async function getFeedInfo(feedGuid) {
  const headers = createPodcastIndexAuthHeaders();
  if (!headers) return null;
  
  try {
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (!response.ok) {
      console.log(`  ❌ Failed to lookup feed ${feedGuid}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    if (data.status === 'true' && data.feed) {
      return {
        id: data.feed.id,
        title: data.feed.title,
        author: data.feed.author,
        description: data.feed.description,
        feedUrl: data.feed.url,
        image: data.feed.image || data.feed.artwork,
        category: data.feed.categories ? Object.keys(data.feed.categories)[0] : 'Music',
        guid: feedGuid
      };
    }
    
    return null;
  } catch (error) {
    console.log(`  ❌ Error looking up feed ${feedGuid}: ${error.message}`);
    return null;
  }
}

// Add feed to local database via API
async function addFeedToDatabase(feedInfo) {
  try {
    const response = await fetch('http://localhost:3000/api/feeds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: feedInfo.title,
        artist: feedInfo.author || 'Various Artists',
        description: feedInfo.description || `Music feed: ${feedInfo.title}`,
        originalUrl: feedInfo.feedUrl,
        type: 'album',
        priority: 'normal',
        status: 'active',
        image: feedInfo.image
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log(`  ✅ Added feed to database: ${feedInfo.title} (ID: ${result.feed?.id})`);
      return result.feed?.id;
    } else {
      const error = await response.text();
      if (error.includes('already exists') || error.includes('duplicate')) {
        console.log(`  ⚡ Feed already exists: ${feedInfo.title}`);
        return null; // Not an error, just already exists
      } else {
        console.log(`  ❌ Failed to add feed: ${response.status} - ${error}`);
        return null;
      }
    }
  } catch (error) {
    console.log(`  ❌ Error adding feed to database: ${error.message}`);
    return null;
  }
}

// Parse feed RSS data
async function parseFeedRSS(feedId) {
  try {
    const response = await fetch(`http://localhost:3000/api/parse-feeds?action=parse-single&feedId=${feedId}`, {
      method: 'POST'
    });
    
    if (response.ok) {
      console.log(`  ✅ RSS parsing completed for feed ${feedId}`);
    } else {
      console.log(`  ⚠️ RSS parsing failed for feed ${feedId}: ${response.status}`);
    }
  } catch (error) {
    console.log(`  ❌ Error parsing RSS for feed ${feedId}: ${error.message}`);
  }
}

async function discoverAllPlaylistFeeds() {
  try {
    console.log('🎵 Discovering all RSS feeds from playlists...\n');
    
    // Step 1: Get all unique feed GUIDs from all playlists
    let allRemoteItems = [];
    
    for (const playlist of PLAYLISTS) {
      console.log(`📋 Fetching ${playlist.name} playlist...`);
      
      const response = await fetch(playlist.url);
      if (!response.ok) {
        console.log(`❌ Failed to fetch ${playlist.name}: ${response.status}`);
        continue;
      }
      
      const xmlText = await response.text();
      const remoteItems = parseRemoteItems(xmlText);
      allRemoteItems = allRemoteItems.concat(remoteItems);
      
      console.log(`  ✅ Found ${remoteItems.length} remote items in ${playlist.name}`);
    }
    
    // Get unique feed GUIDs
    const uniqueFeedGuids = [...new Set(allRemoteItems.map(item => item.feedGuid))];
    console.log(`\n📊 Total unique feeds to process: ${uniqueFeedGuids.length}\n`);
    
    // Step 2: Process each unique feed
    let processed = 0;
    let added = 0;
    let parsed = 0;
    
    for (const feedGuid of uniqueFeedGuids) {
      processed++;
      console.log(`[${processed}/${uniqueFeedGuids.length}] Processing feed: ${feedGuid.slice(0, 12)}...`);
      
      // Get feed info from Podcast Index
      const feedInfo = await getFeedInfo(feedGuid);
      if (!feedInfo) {
        console.log(`  ⚠️ Could not resolve feed GUID to feed info`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
        continue;
      }
      
      console.log(`  📡 Resolved: ${feedInfo.title} by ${feedInfo.author}`);
      
      // Add to database
      const feedId = await addFeedToDatabase(feedInfo);
      if (feedId) {
        added++;
        
        // Parse RSS data
        await parseFeedRSS(feedId);
        parsed++;
      }
      
      // Save progress every 10 feeds
      if (processed % 10 === 0 || processed === uniqueFeedGuids.length) {
        console.log(`  💾 Progress: ${processed}/${uniqueFeedGuids.length} (${((processed/uniqueFeedGuids.length)*100).toFixed(1)}%)\n`);
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Final summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 FEED DISCOVERY SUMMARY:');
    console.log(`   🔍 Total feeds processed: ${processed}`);
    console.log(`   ➕ New feeds added: ${added}`);
    console.log(`   📄 Feeds parsed for RSS: ${parsed}`);
    console.log(`   📚 All tracks from RSS feeds should now be available on the site!`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error discovering playlist feeds:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  discoverAllPlaylistFeeds();
}

module.exports = { discoverAllPlaylistFeeds };