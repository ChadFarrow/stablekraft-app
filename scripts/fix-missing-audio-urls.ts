import { PrismaClient } from '@prisma/client';
import { resolveItemGuid } from '@/lib/feed-discovery';

const prisma = new PrismaClient();

// MMM playlist XML URL
const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function fixMissingAudioUrls() {
  try {
    console.log('🔧 Starting fix for tracks with missing audioUrls...\n');

    // Fetch MMM playlist XML to get feedGuid mappings
    console.log('📥 Fetching MMM playlist XML...');
    const response = await fetch(MMM_PLAYLIST_URL);

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log(`✅ Fetched ${Math.round(xmlText.length / 1024)}KB of XML\n`);

    // Extract podcast:remoteItem elements to get feedGuid -> itemGuid mappings
    console.log('🔍 Extracting remoteItems from XML...');
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"/g;
    const remoteItems: RemoteItem[] = [];
    let match;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      remoteItems.push({
        feedGuid: match[1],
        itemGuid: match[2]
      });
    }

    console.log(`✅ Found ${remoteItems.length} remote items\n`);

    // Create a map of itemGuid -> feedGuid for quick lookup
    const itemToFeedMap = new Map(
      remoteItems.map(item => [item.itemGuid, item.feedGuid])
    );

    // Find all tracks with missing or empty audioUrl
    console.log('🔍 Finding tracks with missing audioUrls...');
    const brokenTracks = await prisma.track.findMany({
      where: {
        OR: [
          { audioUrl: '' },
          { audioUrl: { contains: 'placeholder' } }
        ]
      },
      select: {
        id: true,
        guid: true,
        title: true,
        feedId: true,
        audioUrl: true
      }
    });

    console.log(`✅ Found ${brokenTracks.length} tracks with missing audioUrls\n`);

    if (brokenTracks.length === 0) {
      console.log('🎉 All tracks have valid audioUrls!');
      await prisma.$disconnect();
      return;
    }

    // Show sample of broken tracks
    console.log('📋 Sample broken tracks:');
    brokenTracks.slice(0, 5).forEach(t => {
      console.log(`   - ${t.title} (${t.guid})`);
    });
    console.log('');

    // Resolve and fix each broken track
    console.log(`🔧 Fixing ${brokenTracks.length} tracks via Podcast Index API...\n`);

    let fixedCount = 0;
    let failedCount = 0;
    const failedItems: Array<{guid: string; title: string; reason: string}> = [];

    for (let i = 0; i < brokenTracks.length; i++) {
      const track = brokenTracks[i];

      if (i > 0 && i % 50 === 0) {
        console.log(`📊 Progress: ${i}/${brokenTracks.length} (${fixedCount} fixed, ${failedCount} failed)`);
      }

      try {
        // Get the feedGuid from our mapping
        const feedGuid = itemToFeedMap.get(track.guid) || track.feedId;

        if (!feedGuid) {
          failedItems.push({
            guid: track.guid,
            title: track.title,
            reason: 'No feedGuid found in playlist'
          });
          failedCount++;
          continue;
        }

        // Resolve via Podcast Index API
        const apiResult = await resolveItemGuid(feedGuid, track.guid);

        if (!apiResult || !apiResult.audioUrl) {
          failedItems.push({
            guid: track.guid,
            title: track.title,
            reason: 'No audio URL from API'
          });
          failedCount++;
          continue;
        }

        // Update the track with the correct audioUrl
        await prisma.track.update({
          where: { id: track.id },
          data: {
            audioUrl: apiResult.audioUrl,
            // Also update other fields if they're better
            title: apiResult.title || track.title,
            duration: apiResult.duration || undefined,
            image: apiResult.image || undefined,
            description: apiResult.description || undefined,
            updatedAt: new Date()
          }
        });

        console.log(`✅ Fixed: ${track.title} -> ${apiResult.audioUrl.substring(0, 60)}...`);
        fixedCount++;

        // Rate limiting to avoid API throttling
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Failed to fix ${track.guid}:`, error);
        failedItems.push({
          guid: track.guid,
          title: track.title,
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
        failedCount++;
      }
    }

    console.log('\n✅ Fix complete!');
    console.log(`📊 Fixed: ${fixedCount}, Failed: ${failedCount}`);

    if (failedItems.length > 0) {
      console.log(`\n❌ First 10 failures:`);
      failedItems.slice(0, 10).forEach(f => {
        console.log(`   ${f.title} (${f.guid}): ${f.reason}`);
      });
    }

    // Verify the fix
    console.log('\n🔍 Verifying fix...');
    const remainingBroken = await prisma.track.count({
      where: {
        OR: [
          { audioUrl: '' },
          { audioUrl: { contains: 'placeholder' } }
        ]
      }
    });

    console.log(`📊 Remaining tracks with missing audioUrls: ${remainingBroken}`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Run the fix
fixMissingAudioUrls();
