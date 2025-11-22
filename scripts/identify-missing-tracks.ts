import { resolveItemGuid } from '@/lib/feed-discovery';

const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function identifyMissingTracks() {
  try {
    console.log('🔍 Identifying missing tracks from Podcast Index API...\n');

    // Fetch MMM playlist XML
    const response = await fetch(MMM_PLAYLIST_URL);
    const xmlText = await response.text();

    // Extract remote items
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"/g;
    const remoteItems: RemoteItem[] = [];
    let match;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      remoteItems.push({
        feedGuid: match[1],
        itemGuid: match[2]
      });
    }

    // Sample 10 random missing items to identify
    const sampleItems = [
      { feedGuid: '9e3cea98-d04d-5190-88b3-46ee6030d4ea', itemGuid: 'b578c132-409e-4925-aeaf-b9930503ab49' },
      { feedGuid: '67711885-4a77-514e-ae6d-6ef3afaad41d', itemGuid: '604f333b-d131-5ac2-8dc8-64129140bba5' },
      { feedGuid: 'e197e3ab-43ef-5380-be39-71f0cb33726c', itemGuid: '53a78254-286c-4177-b1eb-960b468f6fac' },
      { feedGuid: '16e3e523-f235-550c-becb-d5faefacfcfe', itemGuid: '4cd951c6-6219-4f7a-8e4a-1eac61b4bb3e' },
      { feedGuid: '251c5c0b-1631-5193-a117-aed043a75a5e', itemGuid: '212a415c-9767-455f-a0c2-b6815a4632cd' },
    ];

    console.log('Attempting to resolve sample missing tracks:\n');

    for (const item of sampleItems) {
      console.log(`\n📻 Feed GUID: ${item.feedGuid}`);
      console.log(`🎵 Item GUID: ${item.itemGuid}`);

      try {
        const result = await resolveItemGuid(item.feedGuid, item.itemGuid);

        if (result) {
          console.log(`✅ RESOLVED!`);
          console.log(`   Title: ${result.title}`);
          console.log(`   Feed: ${result.feedTitle}`);
          console.log(`   Audio: ${result.audioUrl ? 'YES' : 'NO'}`);
        } else {
          console.log(`❌ Could not resolve - episode may have been removed from Podcast Index`);
        }
      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 200));
    }

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

identifyMissingTracks();
