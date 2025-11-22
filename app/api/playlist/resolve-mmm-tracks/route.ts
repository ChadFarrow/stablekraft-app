import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveItemGuid } from '@/lib/feed-discovery';
import Parser from 'rss-parser';

const parser = new Parser();
const MMM_FEED_URL = 'https://feeds.fountain.fm/@chadf-music/chadf_music_mmm_playlist';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

export async function POST(request: Request) {
  try {
    console.log('🚀 Starting MMM track resolution process...');

    // Fetch and parse MMM playlist RSS feed
    const feed = await parser.parseURL(MMM_FEED_URL);
    const xmlResponse = await fetch(MMM_FEED_URL);
    const xmlText = await xmlResponse.text();

    // Extract podcast:remoteItem elements
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"/g;
    const remoteItems: RemoteItem[] = [];
    let match;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      remoteItems.push({
        feedGuid: match[1],
        itemGuid: match[2]
      });
    }

    console.log(`📋 Found ${remoteItems.length} remote items in MMM playlist`);

    // Get existing tracks to find which ones are missing
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    const existingTracks = await prisma.track.findMany({
      where: { guid: { in: itemGuids } },
      select: { guid: true }
    });

    const existingGuids = new Set(existingTracks.map(t => t.guid));
    const unresolvedItems = remoteItems.filter(item => !existingGuids.has(item.itemGuid));

    console.log(`🔍 ${unresolvedItems.length} tracks need resolution`);

    if (unresolvedItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All MMM tracks already resolved',
        resolved: 0,
        failed: 0
      });
    }

    // Resolve and save tracks
    let resolvedCount = 0;
    let failedCount = 0;
    const failedItems: Array<{feedGuid: string; itemGuid: string; reason: string}> = [];

    for (let i = 0; i < unresolvedItems.length; i++) {
      const item = unresolvedItems[i];

      if (i % 50 === 0) {
        console.log(`📊 Progress: ${i}/${unresolvedItems.length}`);
      }

      try {
        // Resolve via Podcast Index API
        const apiResult = await resolveItemGuid(item.feedGuid, item.itemGuid);

        if (!apiResult || !apiResult.audioUrl) {
          failedItems.push({
            feedGuid: item.feedGuid,
            itemGuid: item.itemGuid,
            reason: 'No audio URL returned from API'
          });
          failedCount++;
          continue;
        }

        // Ensure feed exists in database
        const feedGuid = apiResult.feedGuid || item.feedGuid;
        let feed = await prisma.feed.findUnique({ where: { id: feedGuid } });

        if (!feed) {
          // Create feed entry
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

        // Check if track already exists (race condition protection)
        const existingTrack = await prisma.track.findFirst({
          where: { guid: apiResult.guid }
        });

        if (existingTrack) {
          console.log(`⚡ Track already exists: ${apiResult.title}`);
          resolvedCount++;
          continue;
        }

        // Create track entry
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

        console.log(`✅ Resolved and saved: ${apiResult.title}`);
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

    console.log(`✅ Resolution complete: ${resolvedCount} resolved, ${failedCount} failed`);

    return NextResponse.json({
      success: true,
      total: unresolvedItems.length,
      resolved: resolvedCount,
      failed: failedCount,
      failures: failedItems.slice(0, 20) // Return first 20 failures for debugging
    });

  } catch (error) {
    console.error('❌ Error in MMM track resolution:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
