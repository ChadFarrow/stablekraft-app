// Test script to debug Stay Awhile album loading
const RSSParser = require('./lib/rss-parser.ts');

async function testStayAwhile() {
  try {
    console.log('🔍 Testing Stay Awhile album loading...');
    
    // Test the specific feed URL
    const feedUrl = 'https://ableandthewolf.com/static/media/feed.xml';
    console.log(`📡 Testing feed: ${feedUrl}`);
    
    // Test the proxy endpoint
    const proxyUrl = `https://re.podtards.com/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`;
    console.log(`🔗 Proxy URL: ${proxyUrl}`);
    
    // Fetch the RSS feed
    const response = await fetch(proxyUrl);
    console.log(`📊 Response status: ${response.status}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const xmlText = await response.text();
    console.log(`📄 XML length: ${xmlText.length} characters`);
    
    // Check if it contains the expected content
    if (xmlText.includes('Stay Awhile')) {
      console.log('✅ Found "Stay Awhile" in RSS feed');
    } else {
      console.log('❌ "Stay Awhile" not found in RSS feed');
    }
    
    if (xmlText.includes('Able and The Wolf')) {
      console.log('✅ Found "Able and The Wolf" in RSS feed');
    } else {
      console.log('❌ "Able and The Wolf" not found in RSS feed');
    }
    
    // Try to parse with RSSParser
    console.log('🔧 Attempting to parse with RSSParser...');
    const album = await RSSParser.parseAlbumFeed(feedUrl);
    
    if (album) {
      console.log('✅ Successfully parsed album:');
      console.log(`   Title: ${album.title}`);
      console.log(`   Artist: ${album.artist}`);
      console.log(`   Tracks: ${album.tracks.length}`);
      console.log(`   Cover Art: ${album.coverArt || 'None'}`);
      
      album.tracks.forEach((track, index) => {
        console.log(`   Track ${index + 1}: "${track.title}" (${track.duration}) - URL: ${track.url ? 'Found' : 'Missing'}`);
      });
    } else {
      console.log('❌ Failed to parse album');
    }
    
  } catch (error) {
    console.error('❌ Error testing Stay Awhile:', error);
  }
}

testStayAwhile(); 