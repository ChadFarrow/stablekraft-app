const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';
const API_URL = 'https://stablekraft.app/api/playlist/mmm';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  position: number;
}

async function compareOrder() {
  try {
    console.log('📥 Fetching MMM playlist XML...');
    const feedResponse = await fetch(MMM_PLAYLIST_URL);
    const xmlText = await feedResponse.text();

    // Extract remote items in order
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"/g;
    const feedItems: RemoteItem[] = [];
    let match;
    let position = 0;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      feedItems.push({
        feedGuid: match[1],
        itemGuid: match[2],
        position: position++
      });
    }

    console.log(`✅ Feed has ${feedItems.length} items\n`);

    // Fetch API response
    console.log('📥 Fetching API response...');
    const apiResponse = await fetch(API_URL);
    const apiData = await apiResponse.json();

    const apiTracks = apiData.albums?.[0]?.tracks || [];
    console.log(`✅ API returned ${apiTracks.length} tracks\n`);

    // Compare order
    console.log('🔍 Comparing order...\n');

    // Create a map of itemGuid to feed position
    const feedPositions = new Map(
      feedItems.map(item => [item.itemGuid, item.position])
    );

    console.log('First 10 tracks from API:\n');
    apiTracks.slice(0, 10).forEach((track: any, index: number) => {
      const feedPos = feedPositions.get(track.itemGuid);
      const inOrder = feedPos !== undefined;
      console.log(`API position ${index + 1}: ${track.title}`);
      console.log(`   Feed position: ${feedPos !== undefined ? feedPos + 1 : 'NOT FOUND'}`);
      console.log(`   ${inOrder && feedPos === index ? '✅ CORRECT ORDER' : '❌ OUT OF ORDER'}\n`);
    });

    // Check if order matches
    let outOfOrder = 0;
    let matchingPositions = 0;

    apiTracks.forEach((track: any, apiIndex: number) => {
      const feedPos = feedPositions.get(track.itemGuid);
      if (feedPos !== undefined) {
        if (feedPos === apiIndex) {
          matchingPositions++;
        } else {
          outOfOrder++;
        }
      }
    });

    console.log('\n📊 Order Analysis:');
    console.log(`   Tracks in correct position: ${matchingPositions}`);
    console.log(`   Tracks out of order: ${outOfOrder}`);
    console.log(`   Order accuracy: ${((matchingPositions / apiTracks.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

compareOrder();
