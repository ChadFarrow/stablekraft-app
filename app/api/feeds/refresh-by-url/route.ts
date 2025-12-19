import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder } from '@/lib/rss-parser-db';

// POST /api/feeds/refresh-by-url - Refresh a feed by its originalUrl
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalUrl } = body;
    
    if (!originalUrl) {
      return NextResponse.json(
        { error: 'originalUrl is required' },
        { status: 400 }
      );
    }
    
    // Find the feed by URL
    let feed = await prisma.feed.findFirst({
      where: { originalUrl }
    });
    
    // Parse the RSS feed first (needed whether feed exists or not)
    let parsedFeed;
    try {
      parsedFeed = await parseRSSFeedWithSegments(originalUrl);
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
      return NextResponse.json({
        error: 'Failed to parse RSS feed',
        message: errorMessage
      }, { status: 400 });
    }
    
    // If feed doesn't exist, create it
    if (!feed) {
      try {
        const newFeed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            originalUrl,
            cdnUrl: originalUrl,
            type: 'album',
            priority: 'normal',
            title: parsedFeed.title,
            description: parsedFeed.description,
            artist: parsedFeed.artist,
            image: parsedFeed.image,
            language: parsedFeed.language,
            category: parsedFeed.category,
            explicit: parsedFeed.explicit,
            lastFetched: new Date(),
            status: 'active',
            updatedAt: new Date()
          }
        });
        
        feed = newFeed; // Assign to feed variable
        
        // For new feeds, add all tracks from parsed feed
        // Use episode numbers for trackOrder if available, otherwise use RSS position
        if (parsedFeed.items.length > 0) {
          const tracksData = parsedFeed.items.map((item, index) => ({
            id: `${newFeed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
            feedId: newFeed.id,
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
            trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1, // Use season/episode if available
            updatedAt: new Date()
          }));
          
          await prisma.track.createMany({
            data: tracksData,
            skipDuplicates: true
          });
        }
        
        // Return early for newly created feeds
        const newFeedWithCount = await prisma.feed.findUnique({
          where: { id: newFeed.id },
          include: {
            _count: {
              select: { Track: true }
            }
          }
        });
        
        return NextResponse.json({
          message: 'Feed created and populated successfully',
          feed: newFeedWithCount,
          newTracks: parsedFeed.items.length,
          totalTracks: newFeedWithCount?._count.Track || 0
        });
      } catch (createError) {
        return NextResponse.json({
          error: 'Failed to create feed',
          message: createError instanceof Error ? createError.message : 'Unknown error'
        }, { status: 500 });
      }
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
      // Match tracks by GUID first, then by title+audioUrl for tracks without GUIDs
      const updatePromises: Promise<any>[] = [];
      let v4vUpdatedCount = 0;

      for (const track of existingTracks) {
        let order: number | null = null;
        let matchedItem: typeof parsedFeed.items[0] | null = null;

        // First try to match by GUID
        if (track.guid) {
          const parsedData = parsedItemsByGuid.get(track.guid);
          if (parsedData) {
            matchedItem = parsedData.item;
            // Use season/episode if available, otherwise use RSS position
            order = matchedItem.episode
              ? calculateTrackOrder(matchedItem.episode, matchedItem.season)
              : parsedData.order;
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
            // Use season/episode if available, otherwise use RSS position
            order = matchedItem.episode
              ? calculateTrackOrder(matchedItem.episode, matchedItem.season)
              : (matchingIndex + 1);
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
      } else {
        console.log(`⚠️ No tracks matched for update`);
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
        // Find the starting order for new tracks
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
          const parsedItem = fullIndex >= 0 ? parsedFeed.items[fullIndex] : null;
          // Use season/episode if available, otherwise use RSS position
          const order = parsedItem?.episode
            ? calculateTrackOrder(parsedItem.episode, parsedItem.season)
            : (fullIndex >= 0 ? fullIndex + 1 : maxOrder + index + 1);
          
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
            trackOrder: order, // Use episode number if available, otherwise use RSS position
            updatedAt: new Date()
          };
        });
        
        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });
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
      
      return NextResponse.json({
        message: 'Feed refreshed successfully',
        feed: updatedFeed,
        newTracks: newItems.length,
        totalTracks: updatedFeed?._count.Track || 0,
        updatedTracks: updatePromises.length,
        v4vUpdated: v4vUpdatedCount
      });
      
    } catch (parseError) {
      // Update feed with error status
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown error';
      
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          status: 'error',
          lastError: errorMessage,
          lastFetched: new Date()
        }
      });
      
      return NextResponse.json({
        error: 'Failed to refresh feed',
        message: errorMessage
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Error refreshing feed:', error);
    return NextResponse.json(
      { error: 'Failed to refresh feed' },
      { status: 500 }
    );
  }
}

