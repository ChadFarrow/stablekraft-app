import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder, ParsedItem, detectTrackMediaType, applyParsedItemFields } from '@/lib/rss-parser-db';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';
import { channelFundingFields } from '@/lib/feeds/channel-funding';
import { preserveImageVersion } from '@/lib/feeds/image-version-url';
import { recordRefreshFailure } from '@/lib/feeds/refresh-failure';
import { getPodcastIndexLastUpdateByGuid } from '@/lib/podcast-index-api';
import {
  BUDGET_SECONDS_DEFAULT,
  WAVLAKE_LOOKBACK_DAYS_DEFAULT,
  WAVLAKE_SPACING_MS_DEFAULT,
  categorizeReparseError,
  isWavlakeFeedUrl,
  planWavlakeLane,
} from '@/lib/feeds/reparse-plan';

/**
 * POST /api/admin/reparse-feeds
 * Bulk reparse feeds to detect new tracks (the nightly refresh-playlists.yml Step 2).
 *
 * Query parameters:
 * - type: 'album' | 'music' | 'publisher' | 'all' (default: 'album')
 * - maxAgeHours: Only reparse feeds older than X hours (default: 12)
 * - batchSize: Concurrent non-Wavlake feeds per batch (default: 5)
 * - limit: Max non-Wavlake feeds selected per call (default: 100)
 * - budgetSeconds: Start no new feed after this (default: 240). The answer then carries
 *   `remaining` > 0 and the caller calls again — Railway cuts a request at 300 s.
 * - wavlake: 'changed' (default) | 'skip'
 * - wavlakeSpacingMs: Pause between two Wavlake fetches (default: 1500)
 * - wavlakeLookbackDays: Catch-up window for Wavlake feeds whose last attempt failed (default: 60)
 *
 * Wavlake feeds never join the parallel batches. lib/feeds/reparse-plan.ts says why,
 * and decides which of them are due.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'album';
    const maxAgeHours = parseInt(searchParams.get('maxAgeHours') || '12', 10);
    const batchSize = Math.max(1, parseInt(searchParams.get('batchSize') || '5', 10) || 5);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const budgetMs = Math.max(0, Number(searchParams.get('budgetSeconds') ?? BUDGET_SECONDS_DEFAULT) || 0) * 1000;
    const wavlakeMode = searchParams.get('wavlake') === 'skip' ? 'skip' : 'changed';
    const wavlakeSpacingMs = Math.max(0, Number(searchParams.get('wavlakeSpacingMs') ?? WAVLAKE_SPACING_MS_DEFAULT) || 0);
    const lookbackMs = Math.max(0, Number(searchParams.get('wavlakeLookbackDays') ?? WAVLAKE_LOOKBACK_DAYS_DEFAULT) || 0) * 24 * 60 * 60 * 1000;
    const budgetLeft = () => Date.now() - startTime < budgetMs;

    console.log(`🔄 Starting bulk reparse: type=${type}, maxAgeHours=${maxAgeHours}, batchSize=${batchSize}, limit=${limit}, budget=${budgetMs / 1000}s, wavlake=${wavlakeMode}`);

    // Calculate cutoff time
    const cutoffTime = new Date(Date.now() - (maxAgeHours * 60 * 60 * 1000));
    const dueByAge = { OR: [{ lastFetched: null }, { lastFetched: { lt: cutoffTime } }] };
    const onWavlake = { originalUrl: { contains: 'wavlake.com', mode: 'insensitive' as const } };

    // Which feeds this type covers. For publisher feeds, include even those without
    // tracks (newly added); album/music feeds need at least one track (already parsed).
    let baseWhere: any;
    if (type === 'publisher') {
      baseWhere = { status: 'active', type: 'publisher' };
    } else if (type === 'all') {
      baseWhere = {
        status: 'active',
        type: { in: ['album', 'music', 'publisher', 'podcast'] },
        OR: [{ type: 'publisher' }, { Track: { some: {} } }],
      };
    } else {
      baseWhere = { status: 'active', type, Track: { some: {} } };
    }

    const feedSelect = { id: true, title: true, originalUrl: true, type: true, lastFetched: true, image: true } as const;

    // Lane 1 — every host but Wavlake: due by age, oldest first, in parallel batches.
    // The SQL filter is a coarse substring; isWavlakeFeedUrl is the real (dot-boundary) test.
    const hostsWhere = { AND: [baseWhere, dueByAge, { NOT: onWavlake }] };
    // Counted too, so `remaining` stays honest when `limit` is smaller than the due set.
    const hostsDueTotal = await prisma.feed.count({ where: hostsWhere });
    const hostFeeds = (await prisma.feed.findMany({
      where: hostsWhere,
      select: feedSelect,
      take: limit,
      orderBy: { lastFetched: 'asc' }, // Oldest first
    })).filter((f) => !isWavlakeFeedUrl(f.originalUrl));

    // Lane 2 — Wavlake: due by age is only the first gate; PI decides the rest.
    const wavlakeRows = await prisma.feed.findMany({
      where: { AND: [baseWhere, dueByAge, onWavlake] },
      select: { ...feedSelect, guid: true, lastError: true },
      orderBy: { lastFetched: 'asc' },
    });
    // A URL that merely CONTAINS "wavlake.com" belongs in lane 1.
    for (const f of wavlakeRows) if (!isWavlakeFeedUrl(f.originalUrl) && hostFeeds.length < limit) hostFeeds.push(f);
    const wavlakeCandidates = wavlakeRows.filter((f) => isWavlakeFeedUrl(f.originalUrl));

    console.log(`📋 Found ${hostFeeds.length} non-Wavlake feeds due, ${wavlakeCandidates.length} Wavlake candidates`);

    // Process stats
    const stats = {
      feedsProcessed: 0,
      newTracksAdded: 0,
      tracksUpdated: 0,
      feedsFailed: 0
    };
    const errors: Array<{ feedId: string; title: string; url: string; error: string; errorType: string }> = [];
    const errorCounts: Record<string, number> = {};
    const record = (result: Awaited<ReturnType<typeof reparseSingleFeed>>) => {
      if (result.success) {
        stats.feedsProcessed++;
        stats.newTracksAdded += result.newTracks;
        stats.tracksUpdated += result.updatedTracks;
      } else {
        stats.feedsFailed++;
        const errorType = categorizeReparseError(result.error);
        errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
        errors.push({ feedId: result.feedId, title: result.title, url: result.url, error: result.error, errorType });
      }
    };

    // Lane 1: batches of `batchSize`, until done or the budget is spent.
    let hostsDone = 0;
    for (let i = 0; i < hostFeeds.length; i += batchSize) {
      if (!budgetLeft()) break;
      const batch = hostFeeds.slice(i, i + batchSize);
      console.log(`🔄 Processing batch ${i / batchSize + 1}/${Math.ceil(hostFeeds.length / batchSize)}`);
      const results = await Promise.all(batch.map(feed => reparseSingleFeed(feed)));
      results.forEach(record);
      hostsDone += batch.length;
      // Delay between batches (except after last batch)
      if (i + batchSize < hostFeeds.length) await delay(500);
    }
    const hostsRemaining = Math.max(hostFeeds.length, hostsDueTotal) - hostsDone;

    // Lane 2: one PI call, then the due Wavlake feeds one at a time.
    const wavlake = {
      mode: wavlakeMode,
      candidates: wavlakeCandidates.length,
      due: 0,
      processed: 0,
      failed: 0,
      remaining: 0,
      noGuid: 0,
      notInPI: 0,
      piError: undefined as string | undefined,
    };
    // The PI lookup runs even when lane 1 spent the budget: it is one quick call, and
    // without it `remaining` would read 0 and the workflow would stop before Wavlake.
    if (wavlakeMode === 'changed' && wavlakeCandidates.length > 0) {
      let piLastUpdate: Map<string, number> | null = null;
      try {
        piLastUpdate = await getPodcastIndexLastUpdateByGuid(
          wavlakeCandidates.map((f) => f.guid || '').filter(Boolean)
        );
      } catch (piErr) {
        // Never fall back to fetching Wavlake blind: that is the burst it refuses.
        wavlake.piError = piErr instanceof Error ? piErr.message : String(piErr);
        console.warn(`⚠️ Wavlake lane skipped — Podcast Index lookup failed: ${wavlake.piError}`);
      }
      if (piLastUpdate) {
        const plan = planWavlakeLane(wavlakeCandidates, piLastUpdate, Date.now(), cutoffTime.getTime(), lookbackMs);
        wavlake.due = plan.due.length;
        wavlake.noGuid = plan.noGuid;
        wavlake.notInPI = plan.notInPI;
        for (let i = 0; i < plan.due.length; i++) {
          if (!budgetLeft()) break;
          const result = await reparseSingleFeed(plan.due[i]);
          record(result);
          wavlake.processed++;
          if (!result.success) wavlake.failed++;
          if (i < plan.due.length - 1) await delay(wavlakeSpacingMs);
        }
        wavlake.remaining = wavlake.due - wavlake.processed;
      }
    }

    const remaining = hostsRemaining + wavlake.remaining;
    const stoppedForBudget = remaining > 0;
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Log error summary
    if (Object.keys(errorCounts).length > 0) {
      console.warn(`⚠️ Error breakdown:`);
      for (const [type, count] of Object.entries(errorCounts).sort((a, b) => b[1] - a[1])) {
        console.warn(`   ${type}: ${count}`);
      }
    }

    console.warn(`✅ Bulk reparse completed in ${duration}s: ${stats.feedsProcessed} feeds processed, ${stats.newTracksAdded} new tracks added, ${stats.feedsFailed} failed, ${remaining} remaining (Wavlake: ${wavlake.processed}/${wavlake.due} due of ${wavlake.candidates})`);

    return NextResponse.json({
      success: true,
      message: stats.feedsProcessed + stats.feedsFailed === 0 && remaining === 0 ? 'No feeds need reparsing' : `Reparsed ${stats.feedsProcessed} feeds`,
      stats,
      remaining,
      stoppedForBudget,
      wavlake,
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
  image: string | null;
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

      // Record the error; a feed with tracks stays visible (lib/feeds/refresh-failure.ts)
      await recordRefreshFailure(prisma, feed.id, errorMessage);

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
        // Keep our version (lib/feeds/image-version.ts): this nightly path does not ask
        // the image host, and writing the plain URL would strip it every night.
        image: preserveImageVersion(parsedFeed.image, feed.image),
        language: parsedFeed.language,
        category: parsedFeed.category,
        podcastCategories: parsedFeed.podcastCategories || [],
        explicit: parsedFeed.explicit,
        ...(parsedFeed.podcastGuid && { guid: parsedFeed.podcastGuid }),
        ...(parsedFeed.medium && { medium: parsedFeed.medium.toLowerCase() }),
        ...(parsedFeed.podcastImages && { podcastImages: parsedFeed.podcastImages as any }),
        ...channelPersonsFields(parsedFeed),
        ...channelFundingFields(parsedFeed),
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
          image: preserveImageVersion(item.image, feed.image),
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

    // Try to record the error; a feed with tracks stays visible
    try {
      await recordRefreshFailure(prisma, feed.id, errorMessage);
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
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
