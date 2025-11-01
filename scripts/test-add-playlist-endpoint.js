/**
 * Test script for /api/add-playlist-to-database endpoint
 * Tests the migrated Prisma-based endpoint locally
 */

const testData = {
  playlistName: 'Test Playlist',
  playlistDescription: 'Test playlist for local testing',
  source: 'test',
  tracks: [
    {
      feedGuid: 'test-feed-guid-1',
      itemGuid: 'test-item-guid-1',
      title: 'Test Track 1',
      artist: 'Test Artist',
      audioUrl: 'https://example.com/track1.mp3',
      artworkUrl: 'https://example.com/artwork1.jpg',
      duration: 180,
      feedTitle: 'Test Feed',
      feedUrl: 'https://example.com/feed.xml'
    },
    {
      feedGuid: 'test-feed-guid-2',
      itemGuid: 'test-item-guid-2',
      title: 'Test Track 2',
      artist: 'Test Artist 2',
      audioUrl: 'https://example.com/track2.mp3',
      artworkUrl: 'https://example.com/artwork2.jpg',
      duration: 240,
      feedTitle: 'Test Feed 2',
      feedUrl: 'https://example.com/feed2.xml'
    }
  ]
};

async function testEndpoint() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  const endpoint = `${baseUrl}/api/add-playlist-to-database`;

  console.log('🧪 Testing /api/add-playlist-to-database endpoint...\n');
  console.log(`📍 Endpoint: ${endpoint}\n`);

  try {
    // Test POST endpoint
    console.log('📤 Sending POST request...');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('✅ POST request successful!\n');
      console.log('Response:', JSON.stringify(result, null, 2));
    } else {
      console.log('❌ POST request failed!\n');
      console.log('Status:', response.status);
      console.log('Error:', result);
    }

    // Test GET endpoint (list playlists)
    console.log('\n📤 Testing GET endpoint (list all playlists)...');
    const getResponse = await fetch(`${endpoint}`);
    const getResult = await getResponse.json();

    if (getResponse.ok) {
      console.log('✅ GET request successful!\n');
      console.log('Response:', JSON.stringify(getResult, null, 2));
    } else {
      console.log('❌ GET request failed!\n');
      console.log('Status:', getResponse.status);
      console.log('Error:', getResult);
    }

    // Test GET endpoint with specific playlist
    console.log('\n📤 Testing GET endpoint (specific playlist)...');
    const getPlaylistResponse = await fetch(`${endpoint}?playlist=${encodeURIComponent(testData.playlistName)}`);
    const getPlaylistResult = await getPlaylistResponse.json();

    if (getPlaylistResponse.ok) {
      console.log('✅ GET playlist request successful!\n');
      console.log('Response:', JSON.stringify(getPlaylistResult, null, 2));
    } else {
      console.log('❌ GET playlist request failed!\n');
      console.log('Status:', getPlaylistResponse.status);
      console.log('Error:', getPlaylistResult);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('\n💡 Make sure the dev server is running:');
    console.error('   npm run dev');
  }
}

// Run test
testEndpoint();

