const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  position: number;
}

async function checkFeedOrder() {
  try {
    console.log('📥 Fetching MMM playlist XML...\n');
    const response = await fetch(MMM_PLAYLIST_URL);
    const xmlText = await response.text();

    // Extract remote items in order
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"/g;
    const remoteItems: RemoteItem[] = [];
    let match;
    let position = 0;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      remoteItems.push({
        feedGuid: match[1],
        itemGuid: match[2],
        position: position++
      });
    }

    console.log(`Found ${remoteItems.length} items in feed\n`);
    console.log('First 20 items in feed order:\n');

    remoteItems.slice(0, 20).forEach(item => {
      console.log(`${item.position + 1}. Item GUID: ${item.itemGuid.substring(0, 20)}...`);
    });

    console.log('\n\nLast 20 items in feed order:\n');

    remoteItems.slice(-20).forEach(item => {
      console.log(`${item.position + 1}. Item GUID: ${item.itemGuid.substring(0, 20)}...`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkFeedOrder();
