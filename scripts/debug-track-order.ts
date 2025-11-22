const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';
const API_URL = 'https://stablekraft.app/api/playlist/mmm';

async function debugTrackOrder() {
  try {
    console.log('📥 Fetching data...\n');

    const [feedResponse, apiResponse] = await Promise.all([
      fetch(MMM_PLAYLIST_URL),
      fetch(API_URL)
    ]);

    const xmlText = await feedResponse.text();
    const apiData = await apiResponse.json();

    // Extract feed items
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"/g;
    const feedItems: string[] = [];
    let match;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      feedItems.push(match[2]); // itemGuid
    }

    const apiTracks = apiData.albums?.[0]?.tracks || [];

    console.log(`Feed: ${feedItems.length} items`);
    console.log(`API: ${apiTracks.length} tracks\n`);

    // Create position maps
    const feedPositions = new Map(feedItems.map((guid, i) => [guid, i]));
    const apiItemGuids = apiTracks.map((t: any) => t.itemGuid);

    // Find where order breaks
    console.log('🔍 Looking for where order breaks...\n');

    for (let i = 0; i < Math.min(50, apiTracks.length); i++) {
      const track = apiTracks[i];
      const feedPos = feedPositions.get(track.itemGuid);
      const delta = feedPos !== undefined ? feedPos - i : 'N/A';

      if (feedPos !== i) {
        console.log(`Position ${i + 1}:`);
        console.log(`   Title: ${track.title}`);
        console.log(`   Feed position: ${feedPos !== undefined ? feedPos + 1 : 'NOT FOUND'}`);
        console.log(`   Delta: ${delta}`);
        console.log('');
      }
    }

    // Check for sequential relative order (ignoring gaps)
    console.log('\n🔍 Checking if tracks maintain relative order...\n');

    let prevFeedPos = -1;
    let inRelativeOrder = 0;
    let outOfRelativeOrder = 0;

    for (const track of apiTracks) {
      const feedPos = feedPositions.get(track.itemGuid);
      if (feedPos !== undefined) {
        if (feedPos > prevFeedPos) {
          inRelativeOrder++;
          prevFeedPos = feedPos;
        } else {
          outOfRelativeOrder++;
        }
      }
    }

    console.log(`Tracks maintaining relative order: ${inRelativeOrder}`);
    console.log(`Tracks breaking relative order: ${outOfRelativeOrder}`);
    console.log(`Relative order preserved: ${((inRelativeOrder / apiTracks.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugTrackOrder();
