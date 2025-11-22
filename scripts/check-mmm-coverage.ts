import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function checkMMMCoverage() {
  try {
    console.log('📊 Checking MMM playlist coverage...\n');

    // Fetch MMM playlist XML
    console.log('📥 Fetching MMM playlist XML...');
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

    console.log(`✅ Feed contains ${remoteItems.length} items\n`);

    // Get unique item GUIDs
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`📋 Unique item GUIDs: ${itemGuids.length}\n`);

    // Check how many exist in database
    const existingTracks = await prisma.track.findMany({
      where: { guid: { in: itemGuids } },
      select: {
        guid: true,
        title: true,
        audioUrl: true
      }
    });

    console.log(`✅ Tracks in database: ${existingTracks.length}`);
    console.log(`❌ Missing from database: ${itemGuids.length - existingTracks.length}\n`);

    // Check how many have valid audioUrls
    const withAudio = existingTracks.filter(t => t.audioUrl && t.audioUrl.length > 0 && !t.audioUrl.includes('placeholder'));
    const withoutAudio = existingTracks.filter(t => !t.audioUrl || t.audioUrl.length === 0 || t.audioUrl.includes('placeholder'));

    console.log(`🎵 With valid audio: ${withAudio.length}`);
    console.log(`🚫 Without audio: ${withoutAudio.length}\n`);

    console.log('📊 Summary:');
    console.log(`   Total in feed: ${itemGuids.length}`);
    console.log(`   In database: ${existingTracks.length} (${((existingTracks.length/itemGuids.length)*100).toFixed(1)}%)`);
    console.log(`   Playable: ${withAudio.length} (${((withAudio.length/itemGuids.length)*100).toFixed(1)}%)`);
    console.log(`   Missing: ${itemGuids.length - existingTracks.length} (${(((itemGuids.length - existingTracks.length)/itemGuids.length)*100).toFixed(1)}%)`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkMMMCoverage();
