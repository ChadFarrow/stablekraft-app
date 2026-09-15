import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder, applyParsedItemFields, detectTrackMediaType } from '@/lib/rss-parser-db';
import { syncOldestItemPubdate } from '@/lib/feed-pubdate';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';

/**
 * POST /api/admin/feeds/[id]/reparse
 * Reparse an existing feed by fetching and reparsing its RSS feed
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the feed
    const feed = await prisma.feed.findUnique({
      where: { id },
      select: { id: true, originalUrl: true, title: true }
    });

    if (!feed) {
      return NextResponse.json(
        { error: 'Feed not found' },
        { status: 404 }
      );
    }

    // Parse the RSS feed from the original URL
    let parsedFeed;
    try {
      console.log(`🔄 Reparsing feed: ${feed.title} (${feed.originalUrl})`);
      parsedFeed = await parseRSSFeedWithSegments(feed.originalUrl);
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
      console.error(`❌ Parse error for feed ${feed.id}:`, errorMessage);

      // Update feed with error status
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          status: 'error',
          lastError: errorMessage,
          lastFetched: new Date()
        }
      });

      return NextResponse.json({
        error: 'Failed to parse RSS feed',
        message: errorMessage
      }, { status: 400 });
    }

    try {
      // Update feed metadata
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          title: parsedFeed.title,
          description: parsedFeed.description,
          artist: parsedFeed.artist,
          image: parsedFeed.image,
          language: parsedFeed.language,
          category: parsedFeed.category,
          podcastCategories: parsedFeed.podcastCategories || [],
          explicit: parsedFeed.explicit,
          ...(parsedFeed.podcastGuid && { guid: parsedFeed.podcastGuid }),
          ...(parsedFeed.medium && { medium: parsedFeed.medium.toLowerCase() }),
          ...(parsedFeed.podcastImages && { podcastImages: parsedFeed.podcastImages as any }),
          ...channelPersonsFields(parsedFeed),
          lastFetched: new Date(),
          status: 'active',
          lastError: null,
          updatedAt: new Date()
        }
      });

      // Get existing tracks to update their order
      const existingTracks = await prisma.track.findMany({
        where: { feedId: feed.id },
        select: { id: true, guid: true, title: true, audioUrl: true }
      });

      const existingGuids = new Set(existingTracks.map(t => t.guid).filter(Boolean));
      const existingTracksByGuid = new Map(existingTracks.map(t => [t.guid, t]));

      // Create a map of all parsed items by GUID for order lookup
      // Use season/episode numbers from podcast:/itunes: if available, otherwise use RSS order
      const parsedItemsByGuid = new Map(
        parsedFeed.items.map((item, index) => [item.guid, {
          item,
          order: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1
        }])
      );

      // Update trackOrder AND v4v data for ALL existing tracks based on current RSS feed
      const updatePromises: Promise<any>[] = [];
      let v4vUpdatedCount = 0;

      for (const track of existingTracks) {
        let order: number | null = null;
        let matchedItem: typeof parsedFeed.items[0] | null = null;

        // First try to match by GUID
        if (track.guid) {
          const parsedData = parsedItemsByGuid.get(track.guid);
          if (parsedData) {
            order = parsedData.order;
            matchedItem = parsedData.item;
          }
        }

        // If no GUID match, try to match by title and audioUrl
        if (order === null && track.title && track.audioUrl) {
          const matchingIndex = parsedFeed.items.findIndex(item =>
            (item.title === track.title && item.audioUrl === track.audioUrl) ||
            item.audioUrl === track.audioUrl
          );
          if (matchingIndex >= 0) {
            matchedItem = parsedFeed.items[matchingIndex];
            // Use season/episode from matched item if available, otherwise use RSS position
            order = matchedItem.episode
              ? calculateTrackOrder(matchedItem.episode, matchedItem.season)
              : matchingIndex + 1;
          }
        }

        if (order !== null) {
          // Build update data with trackOrder, v4v data, and podcast categories
          const updateData: any = {
            trackOrder: order,
            podcastCategories: parsedFeed.podcastCategories || []
          };

          // Update v4v data, chapters, and VTS from the parsed feed item
          applyParsedItemFields(updateData, matchedItem);
          if (matchedItem?.v4vRecipient) v4vUpdatedCount++;

          updatePromises.push(
            prisma.track.update({
              where: { id: track.id },
              data: updateData
            })
          );
        }
      }

      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        console.log(`✅ Updated ${updatePromises.length} existing tracks (${v4vUpdatedCount} with v4v data)`);
      }

      // Also update feed-level v4v data if present in parsed feed
      if (parsedFeed.v4vRecipient || parsedFeed.v4vValue) {
        await prisma.feed.update({
          where: { id: feed.id },
          data: {
            v4vRecipient: parsedFeed.v4vRecipient,
            v4vValue: parsedFeed.v4vValue
          }
        });
        console.log(`✅ Updated feed-level v4v data: ${parsedFeed.v4vRecipient}`);
      }

      // Filter out tracks that already exist (check GUID, then audioUrl+title for items without GUIDs)
      const existingAudioUrls = new Set(existingTracks.map(t => t.audioUrl).filter(Boolean));
      const existingTitles = new Set(existingTracks.map(t => t.title).filter(Boolean));
      const newItems = parsedFeed.items.filter(item => {
        // If item has a GUID that matches an existing track, skip it
        if (item.guid && existingGuids.has(item.guid)) return false;
        // For items without GUIDs, check if audioUrl AND title both match existing tracks
        if (!item.guid && item.audioUrl && existingAudioUrls.has(item.audioUrl) && item.title && existingTitles.has(item.title)) return false;
        return true;
      });

      // Add new tracks with proper trackOrder
      if (newItems.length > 0) {
        const maxOrder = Math.max(
          ...Array.from(parsedItemsByGuid.values()).map(p => p.order),
          0
        );

        const tracksData = newItems.map((item, index) => {
          // Use season/episode numbers if available, otherwise find position in feed
          let order: number;
          if (item.episode) {
            order = calculateTrackOrder(item.episode, item.season);
          } else {
            const fullIndex = parsedFeed.items.findIndex(i =>
              i.guid === item.guid ||
              (i.title === item.title && i.audioUrl === item.audioUrl)
            );
            order = fullIndex >= 0 ? fullIndex + 1 : maxOrder + index + 1;
          }

          return {
            id: `${feed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
            feedId: feed.id,
            guid: item.guid,
            title: item.title,
            subtitle: item.subtitle,
            description: item.description,
            artist: item.artist,
            audioUrl: item.audioUrl,
            mediaType: detectTrackMediaType(item),
            mimeType: item.mimeType,
            alternateEnclosures: item.alternateEnclosures ? JSON.parse(JSON.stringify(item.alternateEnclosures)) : undefined,
            duration: item.duration,
            explicit: item.explicit,
            image: item.image,
            publishedAt: item.publishedAt,
            itunesAuthor: item.itunesAuthor,
            itunesSummary: item.itunesSummary,
            itunesImage: item.itunesImage,
            itunesDuration: item.itunesDuration,
            itunesKeywords: item.itunesKeywords || [],
            itunesCategories: item.itunesCategories || [],
            podcastCategories: parsedFeed.podcastCategories || [],
            v4vRecipient: item.v4vRecipient,
            v4vValue: item.v4vValue,
            startTime: item.startTime,
            endTime: item.endTime,
            chaptersUrl: item.chaptersUrl,
            chapters: item.chapters || undefined,
            valueTimeSplits: item.valueTimeSplits || undefined,
            trackOrder: order,
            updatedAt: new Date()
          };
        });

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        // Mark the feed as updated with new tracks so it surfaces in "new".
        // Skip on first-time imports (no prior tracks) — Feed.createdAt already covers that case.
        if (existingTracks.length > 0) {
          try {
            await prisma.feed.update({
              where: { id: feed.id },
              data: { lastNewTrackAt: new Date() }
            });
          } catch (e) {
            console.warn(`[lastNewTrackAt] write failed for ${feed.id} — migration may be pending:`, e instanceof Error ? e.message : e);
          }
        }

        console.log(`✅ Added ${newItems.length} new tracks`);
      }

      // Refresh the release date used by the grid + "Year" sort. Runs
      // unconditionally (not just when newItems exist) because a reparse also
      // upserts existing tracks and can correct their publishedAt. Feeds added
      // before this was wired up have a null column and were falling back to
      // feed.createdAt — a reparse now repairs them.
      await syncOldestItemPubdate(feed.id);

      // Get updated feed with counts
      const updatedFeed = await prisma.feed.findUnique({
        where: { id: feed.id },
        include: {
          _count: {
            select: { Track: true }
          }
        }
      });

      console.log(`✅ Successfully reparsed feed: ${feed.title}`);

      return NextResponse.json({
        success: true,
        message: 'Feed reparsed successfully',
        feed: updatedFeed,
        newTracks: newItems.length,
        totalTracks: updatedFeed?._count.Track || 0,
        updatedTracks: updatePromises.length,
        v4vUpdated: v4vUpdatedCount
      });

    } catch (dbError) {
      const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown error';
      console.error(`❌ Database error for feed ${feed.id}:`, errorMessage);

      // Update feed with error status
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          status: 'error',
          lastError: errorMessage,
          lastFetched: new Date()
        }
      });

      return NextResponse.json({
        error: 'Failed to update feed in database',
        message: errorMessage
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error reparsing feed:', error);
    return NextResponse.json(
      {
        error: 'Failed to reparse feed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
