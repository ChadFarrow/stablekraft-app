import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments } from '@/lib/rss-parser-db';

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
        // Preserve RSS feed order (newest-first, matching podcastindex.org)
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
            trackOrder: index + 1, // Preserve RSS feed order (1-based, newest first)
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
      
      // Update trackOrder for ALL existing tracks based on current RSS feed order
      // Match tracks by GUID first, then by title+audioUrl for tracks without GUIDs
      const updatePromises: Promise<any>[] = [];
      
      for (const track of existingTracks) {
        let order: number | null = null;
        
        // First try to match by GUID
        if (track.guid) {
          const parsedItem = parsedItemsByGuid.get(track.guid);
          if (parsedItem) {
            order = parsedItem.order;
          }
        }
        
        // If no GUID match, try to match by title and audioUrl
        if (order === null && track.title && track.audioUrl) {
          const matchingIndex = parsedFeed.items.findIndex(item => 
            (item.title === track.title && item.audioUrl === track.audioUrl) ||
            item.audioUrl === track.audioUrl
          );
          if (matchingIndex >= 0) {
            order = matchingIndex + 1; // Preserve RSS feed order (newest-first)
          }
        }
        
        if (order !== null) {
          updatePromises.push(
            prisma.track.update({
              where: { id: track.id },
              data: { trackOrder: order }
            })
          );
        }
      }
      
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        console.log(`✅ Updated trackOrder for ${updatePromises.length} existing tracks`);
      } else {
        console.log(`⚠️ No tracks matched for trackOrder update`);
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
          // Preserve RSS feed order (newest-first, matching podcastindex.org)
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
            trackOrder: order, // Preserve RSS feed order (1-based)
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
        totalTracks: updatedFeed?._count.Track || 0
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

