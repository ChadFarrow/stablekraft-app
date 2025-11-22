import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function listMissingTracks() {
  try {
    console.log('🔍 Finding missing tracks from MMM playlist...\n');

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

    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];

    // Get existing tracks
    const existingTracks = await prisma.track.findMany({
      where: { guid: { in: itemGuids } },
      select: { guid: true }
    });

    const existingGuids = new Set(existingTracks.map(t => t.guid));
    const missingItems = remoteItems.filter(item => !existingGuids.has(item.itemGuid));

    console.log(`Found ${missingItems.length} missing tracks\n`);
    console.log('Missing item GUIDs and their feed GUIDs:\n');

    // Group by feedGuid to see patterns
    const byFeed = new Map<string, string[]>();
    for (const item of missingItems) {
      const items = byFeed.get(item.feedGuid) || [];
      items.push(item.itemGuid);
      byFeed.set(item.feedGuid, items);
    }

    console.log('Grouped by Feed GUID:\n');
    for (const [feedGuid, itemGuids] of byFeed.entries()) {
      console.log(`📻 Feed: ${feedGuid}`);
      console.log(`   Missing ${itemGuids.length} items:`);
      itemGuids.slice(0, 3).forEach(guid => {
        console.log(`   - ${guid}`);
      });
      if (itemGuids.length > 3) {
        console.log(`   ... and ${itemGuids.length - 3} more`);
      }
      console.log('');
    }

    // Try to get feed names from Podcast Index for these feeds
    console.log('\n🔍 Checking Podcast Index for feed information...\n');

    const uniqueFeedGuids = Array.from(byFeed.keys()).slice(0, 10); // Check first 10

    for (const feedGuid of uniqueFeedGuids) {
      const feed = await prisma.feed.findUnique({
        where: { id: feedGuid },
        select: { title: true, artist: true }
      });

      if (feed) {
        console.log(`✅ ${feedGuid}`);
        console.log(`   Title: ${feed.title}`);
        console.log(`   Artist: ${feed.artist || 'Unknown'}`);
        console.log(`   Missing: ${byFeed.get(feedGuid)?.length} tracks\n`);
      } else {
        console.log(`❌ ${feedGuid} - Not in database\n`);
      }
    }

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

listMissingTracks();
