#!/usr/bin/env node

/**
 * Refresh all playlist feeds by fetching raw XML from GitHub and triggering API refresh
 * This ensures we get the latest feeds directly from the repository
 */

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

const PLAYLIST_FEEDS = [
  { 
    name: 'B4TS', 
    endpoint: '/api/playlist/b4ts',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml'
  },
  { 
    name: 'Flowgnar', 
    endpoint: '/api/playlist/flowgnar',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-music-playlist.xml'
  },
  { 
    name: 'HGH', 
    endpoint: '/api/playlist/hgh',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml'
  },
  { 
    name: 'IAM', 
    endpoint: '/api/playlist/iam',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml'
  },
  { 
    name: 'ITDV', 
    endpoint: '/api/playlist/itdv',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml'
  },
  { 
    name: 'MMM', 
    endpoint: '/api/playlist/mmm',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml'
  },
  { 
    name: 'MMT', 
    endpoint: '/api/playlist/mmt',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml'
  },
  { 
    name: 'SAS', 
    endpoint: '/api/playlist/sas',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml'
  },
  { 
    name: 'Upbeats', 
    endpoint: '/api/playlist/upbeats',
    rawUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml'
  },
];

async function verifyFeedExists(name, rawUrl) {
  try {
    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': 'FUCKIT-Playlist-Refresher/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const xmlText = await response.text();
    if (!xmlText || xmlText.trim().length === 0) {
      throw new Error('Empty feed');
    }
    
    // Check if it's valid XML
    if (!xmlText.includes('<?xml') && !xmlText.includes('<rss')) {
      throw new Error('Invalid XML format');
    }
    
    return { exists: true, size: xmlText.length };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

async function refreshPlaylistFeed(name, endpoint, rawUrl) {
  try {
    // First verify the raw feed exists and is accessible
    console.log(`🔍 Verifying ${name} feed exists...`);
    const verifyResult = await verifyFeedExists(name, rawUrl);
    
    if (!verifyResult.exists) {
      throw new Error(`Feed verification failed: ${verifyResult.error}`);
    }
    
    console.log(`✅ ${name} feed verified (${verifyResult.size} bytes)`);
    
    // Now trigger the API endpoint with refresh parameter
    const url = `${BASE_URL}${endpoint}?refresh=true`;
    console.log(`🔄 Refreshing ${name} playlist via API...`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'FUCKIT-Playlist-Refresher/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const trackCount = data.albums?.[0]?.tracks?.length || 
                      data.data?.tracks?.length || 
                      data.tracks?.length || 
                      0;
    
    console.log(`✅ ${name}: Refreshed successfully (${trackCount} tracks)\n`);
    return { success: true, name, trackCount };
  } catch (error) {
    console.error(`❌ ${name}: Failed to refresh -`, error.message, '\n');
    return { success: false, name, error: error.message };
  }
}

async function refreshAllPlaylists() {
  console.log(`🚀 Starting playlist feed refresh from raw GitHub feeds...`);
  console.log(`📍 Base URL: ${BASE_URL}\n`);
  console.log('='.repeat(60));

  const results = [];

  // Process playlists sequentially to avoid overwhelming the server
  for (const feed of PLAYLIST_FEEDS) {
    const result = await refreshPlaylistFeed(feed.name, feed.endpoint, feed.rawUrl);
    results.push(result);
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('='.repeat(60));
  console.log('\n📊 Refresh Summary:');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  successful.forEach(result => {
    console.log(`✅ ${result.name.padEnd(15)} ${result.trackCount} tracks`);
  });

  if (failed.length > 0) {
    console.log('\n❌ Failed:');
    failed.forEach(result => {
      console.log(`   ${result.name}: ${result.error}`);
    });
  }

  console.log(`\n✅ Successfully refreshed: ${successful.length}/${results.length} playlists`);

  if (failed.length > 0) {
    console.log(`\n⚠️  ${failed.length} playlist(s) failed to refresh`);
    process.exit(1);
  } else {
    console.log('\n🎉 All playlists refreshed successfully!');
  }
}

// Run the refresh
refreshAllPlaylists().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
