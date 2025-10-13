import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments } from '@/lib/rss-parser-db';

interface RemoteItem {
  feedGuid?: string;
  feedUrl?: string;
  medium?: string;
}

/**
 * POST /api/feeds/[id]/process-remote-items
 *
 * Processes a publisher feed's podcast:remoteItem references and adds them as feeds
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Get the publisher feed
    const publisherFeed = await prisma.feed.findUnique({
      where: { id }
    });

    if (!publisherFeed) {
      return NextResponse.json(
        { error: 'Feed not found' },
        { status: 404 }
      );
    }

    if (publisherFeed.type !== 'publisher') {
      return NextResponse.json(
        { error: 'This endpoint only processes publisher feeds' },
        { status: 400 }
      );
    }

    console.log(`📡 Fetching publisher feed: ${publisherFeed.originalUrl}`);

    // Fetch the publisher feed XML
    const response = await fetch(publisherFeed.originalUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch publisher feed: HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const xml = await response.text();

    // Extract podcast:remoteItem tags
    const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
    const matches = xml.match(remoteItemRegex) || [];

    const remoteItems: RemoteItem[] = [];
    for (const match of matches) {
      const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
      const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
      const mediumMatch = match.match(/medium="([^"]+)"/);

      if (feedUrlMatch) {
        remoteItems.push({
          feedUrl: feedUrlMatch[1],
          feedGuid: feedGuidMatch?.[1],
          medium: mediumMatch?.[1] || 'music',
        });
      }
    }

    console.log(`✅ Found ${remoteItems.length} remote items in publisher feed`);

    if (remoteItems.length === 0) {
      return NextResponse.json({
        message: 'No remote items found in publisher feed',
        remoteItems: [],
        added: 0,
        skipped: 0,
        errors: []
      });
    }

    // Process each remote item
    const results = {
      added: 0,
      skipped: 0,
      errors: [] as Array<{ feedUrl: string; error: string }>
    };

    for (const remoteItem of remoteItems) {
      if (!remoteItem.feedUrl) {
        results.skipped++;
        continue;
      }

      try {
        // Check if feed already exists
        const existingFeed = await prisma.feed.findUnique({
          where: { originalUrl: remoteItem.feedUrl }
        });

        if (existingFeed) {
          console.log(`⚡ Feed already exists: ${remoteItem.feedUrl}`);
          results.skipped++;
          continue;
        }

        console.log(`🎵 Adding feed: ${remoteItem.feedUrl}`);

        // Parse the RSS feed
        const parsedFeed = await parseRSSFeedWithSegments(remoteItem.feedUrl);

        // Create feed in database
        const feed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            originalUrl: remoteItem.feedUrl,
            cdnUrl: remoteItem.feedUrl,
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

        // Create tracks in database
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

          console.log(`✅ Added "${parsedFeed.title}" with ${parsedFeed.items.length} tracks`);
          results.added++;
        } else {
          console.log(`⚠️ Feed "${parsedFeed.title}" has no tracks`);
          results.skipped++;
        }

        // Rate limiting: wait between requests
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing ${remoteItem.feedUrl}: ${errorMessage}`);
        results.errors.push({
          feedUrl: remoteItem.feedUrl,
          error: errorMessage
        });
        results.skipped++;
      }
    }

    return NextResponse.json({
      message: `Processed ${remoteItems.length} remote items from publisher feed`,
      remoteItems: remoteItems.map(item => ({
        feedUrl: item.feedUrl,
        feedGuid: item.feedGuid,
        medium: item.medium
      })),
      added: results.added,
      skipped: results.skipped,
      errors: results.errors
    });

  } catch (error) {
    console.error('Error processing remote items:', error);
    return NextResponse.json(
      { error: 'Failed to process remote items' },
      { status: 500 }
    );
  }
}
