import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments } from '@/lib/rss-parser-db';

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
          explicit: parsedFeed.explicit,
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
      // Preserve RSS feed order (newest-first, matching podcastindex.org)
      const parsedItemsByGuid = new Map(
        parsedFeed.items.map((item, index) => [item.guid, { item, order: index + 1 }])
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
            order = matchingIndex + 1;
            matchedItem = parsedFeed.items[matchingIndex];
          }
        }

        if (order !== null) {
          // Build update data with trackOrder and v4v data if available
          const updateData: any = { trackOrder: order };

          // Update v4v data from the parsed feed item
          if (matchedItem) {
            if (matchedItem.v4vRecipient) {
              updateData.v4vRecipient = matchedItem.v4vRecipient;
              v4vUpdatedCount++;
            }
            if (matchedItem.v4vValue) {
              updateData.v4vValue = matchedItem.v4vValue;
            }
          }

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

      // Filter out tracks that already exist
      const newItems = parsedFeed.items.filter(item =>
        !item.guid || !existingGuids.has(item.guid)
      );

      // Add new tracks with proper trackOrder
      if (newItems.length > 0) {
        const maxOrder = Math.max(
          ...Array.from(parsedItemsByGuid.values()).map(p => p.order),
          0
        );

        const tracksData = newItems.map((item, index) => {
          // Find the item's position in the full parsed feed
          const fullIndex = parsedFeed.items.findIndex(i =>
            i.guid === item.guid ||
            (i.title === item.title && i.audioUrl === item.audioUrl)
          );
          const order = fullIndex >= 0 ? fullIndex + 1 : maxOrder + index + 1;

          return {
            id: `${feed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
            feedId: feed.id,
            guid: item.guid,
            title: item.title,
            subtitle: item.subtitle,
            description: item.description,
            artist: item.artist,
            audioUrl: item.audioUrl,
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
            v4vRecipient: item.v4vRecipient,
            v4vValue: item.v4vValue,
            startTime: item.startTime,
            endTime: item.endTime,
            trackOrder: order,
            updatedAt: new Date()
          };
        });

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        console.log(`✅ Added ${newItems.length} new tracks`);
      }

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
