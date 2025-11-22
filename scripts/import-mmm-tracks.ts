import { PrismaClient } from '@prisma/client';
import { resolveItemGuid } from '@/lib/feed-discovery';

const prisma = new PrismaClient();

// MMM playlist XML URL
const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function importMMMTracks() {
  try {
    console.log('🚀 Starting direct MMM track import via Podcast Index API...\n');

    // Fetch MMM playlist XML
    console.log('📥 Fetching MMM playlist XML...');
    const response = await fetch(MMM_PLAYLIST_URL);

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log(`✅ Fetched ${Math.round(xmlText.length / 1024)}KB of XML\n`);

    // Extract podcast:remoteItem elements
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

    // Get existing tracks
    console.log('🔍 Checking database for existing tracks...');
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    const existingTracks = await prisma.track.findMany({
      where: { guid: { in: itemGuids } },
      select: { guid: true }
    });

    const existingGuids = new Set(existingTracks.map(t => t.guid));
    const missingItems = remoteItems.filter(item => !existingGuids.has(item.itemGuid));

    console.log(`✅ Existing: ${existingTracks.length}, Missing: ${missingItems.length}\n`);

    if (missingItems.length === 0) {
      console.log('🎉 All tracks already resolved!');
      await prisma.$disconnect();
      return;
    }

    // Resolve and import missing tracks
    console.log(`📡 Resolving ${missingItems.length} tracks via Podcast Index API...\n`);

    let resolvedCount = 0;
    let failedCount = 0;
    const failedItems: Array<{feedGuid: string; itemGuid: string; reason: string}> = [];

    for (let i = 0; i < missingItems.length; i++) {
      const item = missingItems[i];

      if (i > 0 && i % 50 === 0) {
        console.log(`📊 Progress: ${i}/${missingItems.length} (${resolvedCount} resolved, ${failedCount} failed)`);
      }

      try {
        // Resolve via Podcast Index API
        const apiResult = await resolveItemGuid(item.feedGuid, item.itemGuid);

        if (!apiResult || !apiResult.audioUrl) {
          failedItems.push({
            feedGuid: item.feedGuid,
            itemGuid: item.itemGuid,
            reason: 'No audio URL from API'
          });
          failedCount++;
          continue;
        }

        // Ensure feed exists
        const feedGuid = apiResult.feedGuid || item.feedGuid;
        let feed = await prisma.feed.findUnique({ where: { id: feedGuid } });

        if (!feed) {
          feed = await prisma.feed.create({
            data: {
              id: feedGuid,
              title: apiResult.feedTitle || 'Unknown Feed',
              description: `Feed from MMM playlist`,
              originalUrl: `podcast-guid:${feedGuid}`,
              type: 'music',
              artist: apiResult.feedTitle || null,
              image: apiResult.feedImage || null,
              status: 'active',
              updatedAt: new Date()
            }
          });
        }

        // Check if track exists (race condition protection)
        const existingTrack = await prisma.track.findFirst({
          where: { guid: apiResult.guid }
        });

        if (existingTrack) {
          resolvedCount++;
          continue;
        }

        // Create track
        await prisma.track.create({
          data: {
            id: `${feed.id}-${apiResult.guid}`,
            guid: apiResult.guid,
            title: apiResult.title,
            description: apiResult.description || null,
            audioUrl: apiResult.audioUrl,
            duration: apiResult.duration || 0,
            image: apiResult.image || feed.image || null,
            publishedAt: apiResult.publishedAt || new Date(),
            feedId: feed.id,
            trackOrder: 0,
            updatedAt: new Date()
          }
        });

        resolvedCount++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Failed to resolve ${item.itemGuid}:`, error);
        failedItems.push({
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
        failedCount++;
      }
    }

    console.log('\n✅ Import complete!');
    console.log(`📊 Resolved: ${resolvedCount}, Failed: ${failedCount}`);

    if (failedItems.length > 0) {
      console.log(`\n❌ First 10 failures:`);
      failedItems.slice(0, 10).forEach(f => {
        console.log(`   ${f.itemGuid}: ${f.reason}`);
      });
    }

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Run the import
importMMMTracks();
