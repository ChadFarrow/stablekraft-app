import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder, detectTrackMediaType } from '@/lib/rss-parser-db';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';

export async function GET() {
  try {
    console.log('🔍 Admin Feeds API: Getting all feeds from database');
    
    // Get all feeds from database
    const feeds = await prisma.feed.findMany({
      include: {
        _count: {
          select: {
            Track: true
          }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    // Transform to match expected admin format
    const adminFeeds = feeds.map(feed => ({
      id: feed.id,
      originalUrl: feed.originalUrl,
      type: feed.type,
      title: feed.title,
      artist: feed.artist,
      priority: feed.priority,
      status: feed.status,
      image: feed.image,
      description: feed.description,
      language: feed.language,
      category: feed.category,
      explicit: feed.explicit,
      trackCount: feed._count.Track,
      createdAt: feed.createdAt,
      updatedAt: feed.updatedAt,
      lastFetched: feed.lastFetched,
      lastError: feed.lastError
    }));
    
    console.log(`✅ Admin Feeds API: Returning ${adminFeeds.length} feeds from database`);
    
    return NextResponse.json({
      success: true,
      feeds: adminFeeds,
      count: adminFeeds.length
    });
  } catch (error) {
    console.error('Error fetching feeds from database:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, type = 'album', priority = 'low' } = body;

    console.log(`🔍 Admin Feeds API: Adding new feed ${url} (${type})`);

    // Validate inputs
    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    if (!['album', 'publisher'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Type must be "album" or "publisher"' },
        { status: 400 }
      );
    }

    if (!['core', 'high', 'normal', 'low'].includes(priority)) {
      return NextResponse.json(
        { success: false, error: 'Priority must be "core", "high", "normal", or "low"' },
        { status: 400 }
      );
    }

    // Check if feed already exists in database
    const existingFeed = await prisma.feed.findFirst({
      where: { originalUrl: url }
    });

    if (existingFeed) {
      return NextResponse.json(
        { success: false, error: 'Feed already exists' },
        { status: 409 }
      );
    }

    // Generate a unique ID from the URL
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/\./g, '-');
    const pathname = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const baseId = `${hostname}-${pathname}`.toLowerCase();
    
    // Ensure unique ID by checking database
    let id = baseId;
    let counter = 1;
    while (await prisma.feed.findUnique({ where: { id } })) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    // Create new feed entry in database
    const newFeed = await prisma.feed.create({
      data: {
        id,
        originalUrl: url,
        type,
        title: `Feed from ${urlObj.hostname}`,
        priority,
        status: 'active',
        updatedAt: new Date()
      }
    });

    console.log(`✅ Added new RSS feed to database: ${url} (${type}) with ID: ${id}`);

    // Immediately parse the feed to populate metadata and tracks
    let parseResult = { success: false, newTracks: 0, error: '' };
    try {
      console.log(`🔄 Parsing feed: ${url}`);
      const parsedFeed = await parseRSSFeedWithSegments(url);

      // Update feed metadata from parsed content
      await prisma.feed.update({
        where: { id },
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
          v4vRecipient: parsedFeed.v4vRecipient,
          v4vValue: parsedFeed.v4vValue,
          ...channelPersonsFields(parsedFeed),
          lastFetched: new Date(),
          status: 'active',
          lastError: null
        }
      });

      // Add tracks if any
      if (parsedFeed.items && parsedFeed.items.length > 0) {
        const tracksData = parsedFeed.items.map((item, index) => {
          const order = item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1;
          return {
            id: `${id}-${item.guid || `track-${index}-${Date.now()}`}`,
            feedId: id,
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
            trackOrder: order,
            updatedAt: new Date()
          };
        });

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        parseResult = { success: true, newTracks: tracksData.length, error: '' };
        console.log(`✅ Parsed feed and added ${tracksData.length} tracks`);
      } else {
        parseResult = { success: true, newTracks: 0, error: '' };
        console.log(`✅ Parsed feed (no tracks - likely a publisher feed)`);
      }
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
      console.error(`⚠️ Failed to parse feed: ${errorMessage}`);
      parseResult = { success: false, newTracks: 0, error: errorMessage };

      // Update feed with error but keep it active
      await prisma.feed.update({
        where: { id },
        data: {
          lastError: errorMessage,
          lastFetched: new Date()
        }
      });
    }

    // Get the updated feed
    const updatedFeed = await prisma.feed.findUnique({
      where: { id },
      include: { _count: { select: { Track: true } } }
    });

    return NextResponse.json({
      success: true,
      message: parseResult.success
        ? `Feed added and parsed successfully (${parseResult.newTracks} tracks)`
        : `Feed added but parsing failed: ${parseResult.error}`,
      feed: {
        id: updatedFeed?.id || id,
        originalUrl: updatedFeed?.originalUrl || url,
        type: updatedFeed?.type || type,
        title: updatedFeed?.title || `Feed from ${urlObj.hostname}`,
        artist: updatedFeed?.artist,
        priority: updatedFeed?.priority || priority,
        status: updatedFeed?.status || 'active',
        trackCount: updatedFeed?._count.Track || 0,
        createdAt: updatedFeed?.createdAt || new Date(),
        updatedAt: updatedFeed?.updatedAt || new Date()
      },
      parsed: parseResult.success,
      tracksAdded: parseResult.newTracks
    });
  } catch (error) {
    console.error('Error adding feed to database:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to add feed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}