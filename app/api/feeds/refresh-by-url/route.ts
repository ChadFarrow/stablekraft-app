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
        feed = await prisma.feed.create({
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
        
        // For new feeds, add all tracks from parsed feed
        if (parsedFeed.items.length > 0) {
          const tracksData = parsedFeed.items.map((item, index) => ({
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
            updatedAt: new Date()
          }));
          
          await prisma.track.createMany({
            data: tracksData,
            skipDuplicates: true
          });
        }
        
        // Return early for newly created feeds
        const newFeedWithCount = await prisma.feed.findUnique({
          where: { id: feed.id },
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
      
      // Get existing track GUIDs to avoid duplicates
      const existingTracks = await prisma.track.findMany({
        where: { feedId: feed.id },
        select: { guid: true }
      });
      
      const existingGuids = new Set(existingTracks.map(t => t.guid).filter(Boolean));
      
      // Filter out tracks that already exist
      const newItems = parsedFeed.items.filter(item => 
        !item.guid || !existingGuids.has(item.guid)
      );
      
      // Add new tracks
      if (newItems.length > 0) {
        const tracksData = newItems.map((item, index) => ({
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
          updatedAt: new Date()
        }));
        
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

