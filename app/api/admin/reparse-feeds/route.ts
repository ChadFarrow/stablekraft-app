import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder, ParsedItem, detectTrackMediaType, applyParsedItemFields } from '@/lib/rss-parser-db';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';

/**
 * POST /api/admin/reparse-feeds
 * Bulk reparse feeds to detect new tracks
 *
 * Query parameters:
 * - type: 'album' | 'music' | 'publisher' | 'all' (default: 'album')
 * - maxAgeHours: Only reparse feeds older than X hours (default: 12)
 * - batchSize: Concurrent feeds per batch (default: 5)
 * - limit: Max feeds to process (default: 100)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'album';
    const maxAgeHours = parseInt(searchParams.get('maxAgeHours') || '12', 10);
    const batchSize = parseInt(searchParams.get('batchSize') || '5', 10);
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    console.log(`🔄 Starting bulk reparse: type=${type}, maxAgeHours=${maxAgeHours}, batchSize=${batchSize}, limit=${limit}`);

    // Calculate cutoff time
    const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000));

    // Find feeds that need reparsing
    // For publisher feeds, include even those without tracks (newly added)
    // For album/music feeds, require at least one track (already parsed)

    // Build the where clause based on type
    let whereClause: any;

    if (type === 'publisher') {
      // Publisher feeds don't need tracks - they reference albums via remoteItem
      whereClause = {
        status: 'active',
        type: 'publisher',
        OR: [
          { lastFetched: null },
          { lastFetched: { lt: cutoffTime } }
        ]
      };
    } else if (type === 'all') {
      // For 'all': publisher feeds don't need tracks, others do
      whereClause = {
        status: 'active',
        type: { in: ['album', 'music', 'publisher', 'podcast'] },
        OR: [
          { lastFetched: null },
          { lastFetched: { lt: cutoffTime } }
        ],
        // Either it's a publisher feed, or it has tracks
        AND: [
          {
            OR: [
              { type: 'publisher' },
              { Track: { some: {} } }
            ]
          }
        ]
      };
    } else {
      // album or music - require tracks
      whereClause = {
        status: 'active',
        type,
        OR: [
          { lastFetched: null },
          { lastFetched: { lt: cutoffTime } }
        ],
        Track: { some: {} }
      };
    }

    const feedsToReparse = await prisma.feed.findMany({
      where: whereClause,
      select: {
        id: true,
        title: true,
        originalUrl: true,
        type: true,
        lastFetched: true
      },
      take: limit,
      orderBy: { lastFetched: 'asc' }  // Oldest first
    });

    console.log(`📋 Found ${feedsToReparse.length} feeds to reparse`);

    if (feedsToReparse.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No feeds need reparsing',
        stats: {
          feedsProcessed: 0,
          newTracksAdded: 0,
          feedsFailed: 0
        },
        errors: [],
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`
      });
    }

    // Process stats
    const stats = {
      feedsProcessed: 0,
      newTracksAdded: 0,
      tracksUpdated: 0,
      feedsFailed: 0
    };
    const errors: Array<{ feedId: string; title: string; url: string; error: string; errorType: string }> = [];
    const errorCounts: Record<string, number> = {};

    // Split into batches
    const batches: typeof feedsToReparse[] = [];
    for (let i = 0; i < feedsToReparse.length; i += batchSize) {
      batches.push(feedsToReparse.slice(i, i + batchSize));
    }

    console.log(`📦 Processing ${batches.length} batches of ${batchSize} feeds`);

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`🔄 Processing batch ${batchIndex + 1}/${batches.length}`);

      const results = await Promise.all(
        batch.map(feed => reparseSingleFeed(feed))
      );

      // Aggregate results
      for (const result of results) {
        if (result.success) {
          stats.feedsProcessed++;
          stats.newTracksAdded += result.newTracks;
          stats.tracksUpdated += result.updatedTracks;
        } else {
          stats.feedsFailed++;
          const errorType = categorizeError(result.error);
          errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
          errors.push({
            feedId: result.feedId,
            title: result.title,
            url: result.url,
            error: result.error,
            errorType
          });
        }
      }

      // Delay between batches (except after last batch)
      if (batchIndex < batches.length - 1) {
        await delay(500);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Log error summary
    if (Object.keys(errorCounts).length > 0) {
      console.log(`⚠️ Error breakdown:`);
      for (const [type, count] of Object.entries(errorCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${type}: ${count}`);
      }
    }

    console.log(`✅ Bulk reparse completed in ${duration}s: ${stats.feedsProcessed} feeds processed, ${stats.newTracksAdded} new tracks added, ${stats.feedsFailed} failed`);

    return NextResponse.json({
      success: true,
      message: `Reparsed ${stats.feedsProcessed} feeds`,
      stats,
      errorSummary: Object.keys(errorCounts).length > 0 ? errorCounts : undefined,
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined, // Limit to first 50 errors
      duration: `${duration}s`
    });

  } catch (error) {
    console.error('Error in bulk reparse:', error);
    return NextResponse.json(
      {
        error: 'Failed to reparse feeds',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Reparse a single feed and return results
 */
async function reparseSingleFeed(feed: {
  id: string;
  title: string | null;
  originalUrl: string;
  type: string | null;
}): Promise<{
  success: boolean;
  feedId: string;
  title: string;
  url: string;
  newTracks: number;
  updatedTracks: number;
  error: string;
}> {
  const feedTitle = feed.title || 'Unknown';
  const feedUrl = feed.originalUrl;

  try {
    // Parse the RSS feed from the original URL
    let parsedFeed;
    try {
      parsedFeed = await parseRSSFeedWithSegments(feed.originalUrl);
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';

      // Update feed with error status
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          status: 'error',
          lastError: errorMessage,
          lastFetched: new Date()
        }
      });

      return {
        success: false,
        feedId: feed.id,
        title: feedTitle,
        url: feedUrl,
        newTracks: 0,
        updatedTracks: 0,
        error: errorMessage
      };
    }

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

    // Create a map of all parsed items by GUID for order lookup
    const parsedItemsByGuid = new Map<string | undefined, { item: ParsedItem; order: number }>(
      parsedFeed.items.map((item, index) => [item.guid, {
        item,
        order: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1
      }])
    );

    // Update trackOrder AND v4v data for ALL existing tracks
    const updatePromises: Promise<unknown>[] = [];
    let tracksUpdated = 0;

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
          order = matchedItem.episode
            ? calculateTrackOrder(matchedItem.episode, matchedItem.season)
            : matchingIndex + 1;
        }
      }

      if (order !== null) {
        const updateData: Record<string, unknown> = {
          trackOrder: order,
          podcastCategories: parsedFeed.podcastCategories || []
        };

        // Update v4v data, chapters, VTS, and media metadata from the parsed feed item
        applyParsedItemFields(updateData, matchedItem);
        if (matchedItem) {
          if (matchedItem.mimeType) {
            updateData.mimeType = matchedItem.mimeType;
          }
          if (matchedItem.alternateEnclosures?.length) {
            updateData.alternateEnclosures = JSON.parse(JSON.stringify(matchedItem.alternateEnclosures));
          }
          updateData.mediaType = detectTrackMediaType(matchedItem);
        }

        updatePromises.push(
          prisma.track.update({
            where: { id: track.id },
            data: updateData
          })
        );
        tracksUpdated++;
      }
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }

    // Update feed-level v4v data if present
    if (parsedFeed.v4vRecipient || parsedFeed.v4vValue) {
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          v4vRecipient: parsedFeed.v4vRecipient,
          v4vValue: parsedFeed.v4vValue
        }
      });
    }

    // Filter out tracks that already exist
    const newItems = parsedFeed.items.filter(item =>
      !item.guid || !existingGuids.has(item.guid)
    );

    // Add new tracks with proper trackOrder
    let newTracksAdded = 0;
    if (newItems.length > 0) {
      const maxOrder = Math.max(
        ...Array.from(parsedItemsByGuid.values()).map(p => p.order),
        0
      );

      const tracksData = newItems.map((item, index) => {
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

      newTracksAdded = newItems.length;
      console.log(`  ✅ ${feedTitle}: +${newTracksAdded} new tracks`);
    }

    return {
      success: true,
      feedId: feed.id,
      title: feedTitle,
      url: feedUrl,
      newTracks: newTracksAdded,
      updatedTracks: tracksUpdated,
      error: ''
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`  ❌ ${feedTitle} (${feedUrl}): ${errorMessage}`);

    // Try to update feed with error status
    try {
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          status: 'error',
          lastError: errorMessage,
          lastFetched: new Date()
        }
      });
    } catch {
      // Ignore secondary errors
    }

    return {
      success: false,
      feedId: feed.id,
      title: feedTitle,
      url: feedUrl,
      newTracks: 0,
      updatedTracks: 0,
      error: errorMessage
    };
  }
}

/**
 * Categorize an error message into a type
 */
function categorizeError(error: string): string {
  const errorLower = error.toLowerCase();

  if (errorLower.includes('enotfound') || errorLower.includes('getaddrinfo')) {
    return 'DNS_LOOKUP_FAILED';
  }
  if (errorLower.includes('econnrefused')) {
    return 'CONNECTION_REFUSED';
  }
  if (errorLower.includes('econnreset') || errorLower.includes('socket hang up')) {
    return 'CONNECTION_RESET';
  }
  if (errorLower.includes('etimedout') || errorLower.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (errorLower.includes('404') || errorLower.includes('not found')) {
    return 'NOT_FOUND_404';
  }
  if (errorLower.includes('403') || errorLower.includes('forbidden')) {
    return 'FORBIDDEN_403';
  }
  if (errorLower.includes('500') || errorLower.includes('internal server')) {
    return 'SERVER_ERROR_5XX';
  }
  if (errorLower.includes('ssl') || errorLower.includes('certificate') || errorLower.includes('cert')) {
    return 'SSL_ERROR';
  }
  if (errorLower.includes('parse') || errorLower.includes('xml') || errorLower.includes('invalid')) {
    return 'PARSE_ERROR';
  }
  if (errorLower.includes('no items') || errorLower.includes('empty')) {
    return 'EMPTY_FEED';
  }

  return 'OTHER';
}

/**
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
