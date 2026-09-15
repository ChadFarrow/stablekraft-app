import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder, detectTrackMediaType, applyParsedItemFields } from '@/lib/rss-parser-db';
import { syncOldestItemPubdate } from '@/lib/feed-pubdate';
import { findPublisherFeed } from '@/lib/publisher-detector';
import { generateAlbumSlug, isValidFeedUrl, normalizeUrl, normalizeArtistName } from '@/lib/url-utils';
import { resolvePodcastIndexUrl } from '@/lib/podcast-index-api';
import { findFeedIdByUrl } from '@/lib/feed-lookup';
import { invalidateAlbumsFastCache } from '@/lib/caches/albums-fast-cache';
import { invalidateSearchCache } from '@/lib/caches/search-cache';
import { BLACKLISTED_FEED_IDS, BLACKLISTED_FEED_URLS, isBlacklistedFeedUrl } from '@/lib/feed-exclusions';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';

function invalidateFeedListCaches(): void {
  invalidateAlbumsFastCache();
  invalidateSearchCache();
}

/**
 * Extract remoteItem tags from publisher feed XML
 */
function extractRemoteItemsFromXML(xml: string): Array<{ feedGuid: string; feedUrl: string }> {
  const items: Array<{ feedGuid: string; feedUrl: string }> = [];

  const remoteItemRegex = /<podcast:remoteItem[^>]*>/gi;
  const matches = xml.match(remoteItemRegex) || [];

  for (const match of matches) {
    const feedGuidMatch = match.match(/feedGuid=["']([^"']+)["']/i);
    const feedUrlMatch = match.match(/feedUrl=["']([^"']+)["']/i);
    const mediumMatch = match.match(/medium=["']([^"']+)["']/i);

    // Only include music/album references, not publisher references
    const medium = mediumMatch?.[1] || '';
    if (medium === 'publisher') continue;

    if (feedGuidMatch || feedUrlMatch) {
      items.push({
        feedGuid: feedGuidMatch?.[1] || '',
        feedUrl: feedUrlMatch?.[1] || ''
      });
    }
  }

  return items;
}

/**
 * Link albums to publisher by updating publisherId field
 */
async function linkAlbumsToPublisher(
  publisherId: string,
  remoteItems: Array<{ feedGuid: string; feedUrl: string }>,
  artistName?: string | null
): Promise<{ linkedByGuid: number; linkedByArtist: number }> {
  let linkedByGuid = 0;
  let linkedByArtist = 0;

  // Link by remote item GUIDs/URLs
  for (const item of remoteItems) {
    const conditions: any[] = [];
    if (item.feedGuid) {
      conditions.push({ id: item.feedGuid });
      conditions.push({ guid: item.feedGuid });
      // Also try matching GUID in originalUrl
      conditions.push({ originalUrl: { contains: item.feedGuid } });
    }
    if (item.feedUrl) {
      conditions.push({ originalUrl: item.feedUrl });
    }

    if (conditions.length === 0) continue;

    const result = await prisma.feed.updateMany({
      where: {
        OR: conditions,
        type: { in: ['album', 'music'] },
        publisherId: null
      },
      data: { publisherId }
    });

    linkedByGuid += result.count;
  }

  // Link by artist name match (exact, case-insensitive)
  if (artistName) {
    const result = await prisma.feed.updateMany({
      where: {
        artist: { equals: artistName, mode: 'insensitive' },
        type: { in: ['album', 'music'] },
        publisherId: null
      },
      data: { publisherId }
    });

    linkedByArtist = result.count;
  }

  return { linkedByGuid, linkedByArtist };
}

/**
 * Import missing album feeds from a publisher's remote items
 * This fetches and creates album feeds that don't exist in the database yet
 */
async function importMissingAlbums(
  publisherId: string,
  remoteItems: Array<{ feedGuid: string; feedUrl: string }>
): Promise<{ imported: number; failed: number; skipped: number }> {
  let imported = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of remoteItems) {
    if (!item.feedUrl) {
      skipped++;
      continue;
    }

    // Skip blacklisted URLs — a publisher feed listing them as remoteItems
    // must not auto-mint album rows.
    if (isBlacklistedFeedUrl(item.feedUrl)) {
      console.log(`🚫 Skipping blacklisted album URL from publisher: ${item.feedUrl}`);
      skipped++;
      continue;
    }

    try {
      // Check if album already exists by URL or GUID.
      //
      // The URL half runs through the SHARED LADDER (`lib/feed-lookup.ts`), never a
      // bare `originalUrl` compare. An exact compare sees only the byte-identical
      // string, and `normalizeUrl` ENCODES a literal space to `%20` — so a publisher
      // that lists the `%20` form of a row stored with literal spaces matched
      // nothing here, and this loop minted a second row for an album it already
      // had. That is #247: the duplicate then parsed the feed's `<podcast:guid>`
      // and took it, and because `Feed.guid` is `@unique` the original could never
      // reclaim it — every reparse 500s and the real row is stuck at
      // `status: 'error'` forever. The ladder's rung 2 percent-decodes, which is
      // precisely this case.
      const urlMatch = await findFeedIdByUrl(item.feedUrl);
      const conditions: any[] = [];
      if (urlMatch) conditions.push({ id: urlMatch.id });
      if (item.feedGuid) {
        conditions.push({ id: item.feedGuid });
        conditions.push({ guid: item.feedGuid });
        conditions.push({ originalUrl: { contains: item.feedGuid } });
      }

      // An empty OR matches nothing in Prisma, but say so explicitly rather than
      // relying on that.
      const existing = conditions.length > 0
        ? await prisma.feed.findFirst({ where: { OR: conditions } })
        : null;

      if (existing) {
        // Just link it if not already linked
        if (!existing.publisherId) {
          await prisma.feed.update({
            where: { id: existing.id },
            data: { publisherId }
          });
        }
        skipped++;
        continue;
      }

      // Fetch and parse the album feed
      console.log(`📥 Importing album: ${item.feedUrl}`);
      const parsedFeed = await parseRSSFeedWithSegments(item.feedUrl);

      // Generate feed ID
      let feedId = generateFeedId(parsedFeed.artist, parsedFeed.title);

      // Check for ID collision
      const idExists = await prisma.feed.findUnique({ where: { id: feedId } });
      if (idExists) {
        // Reaching here means the slug matched a row that the URL ladder and the
        // guid checks both said was a DIFFERENT feed. That is possible, but it is
        // also the exact shape of #247's duplicate mint, and it used to happen in
        // silence. `console.warn` survives `removeConsole` in production; a plain
        // log would not.
        console.warn(
          `⚠️ feed id collision minting a new row: ${feedId} already exists, ` +
          `creating ${feedId}-<ts> from ${item.feedUrl}. If these are the same ` +
          `album this is a duplicate mint (#247).`
        );
        feedId = `${feedId}-${Date.now()}`;
      }

      // Check for GUID collision
      if (parsedFeed.podcastGuid) {
        const guidExists = await prisma.feed.findFirst({
          where: { guid: parsedFeed.podcastGuid }
        });
        if (guidExists) {
          // Link existing and skip
          if (!guidExists.publisherId) {
            await prisma.feed.update({
              where: { id: guidExists.id },
              data: { publisherId }
            });
          }
          skipped++;
          continue;
        }
      }

      // Create the album feed
      const feed = await prisma.feed.create({
        data: {
          id: feedId,
          guid: parsedFeed.podcastGuid || null,
          originalUrl: normalizeUrl(item.feedUrl),
          cdnUrl: normalizeUrl(item.feedUrl),
          type: 'album',
          // Declared, not concluded. `type` above is fixed at 'album' here.
          medium: parsedFeed.medium?.toLowerCase() || null,
          priority: 'normal',
          title: parsedFeed.title,
          description: parsedFeed.description,
          artist: parsedFeed.artist,
          image: parsedFeed.image,
          language: parsedFeed.language,
          category: parsedFeed.category,
          podcastCategories: parsedFeed.podcastCategories || [],
          explicit: parsedFeed.explicit,
          v4vRecipient: parsedFeed.v4vRecipient || null,
          v4vValue: parsedFeed.v4vValue || null,
          podcastImages: (parsedFeed.podcastImages as any) || undefined,
          publisherId: publisherId,
          ...channelPersonsFields(parsedFeed),
          lastFetched: new Date(),
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      // Create tracks
      if (parsedFeed.items.length > 0) {
        const tracksData = parsedFeed.items.map((track, index) => ({
          id: `${feed.id}-${track.guid || `track-${index}-${Date.now()}`}`,
          feedId: feed.id,
          guid: track.guid,
          title: track.title,
          subtitle: track.subtitle,
          description: track.description,
          artist: track.artist,
          audioUrl: track.audioUrl,
          mediaType: detectTrackMediaType(track),
          mimeType: track.mimeType,
          alternateEnclosures: track.alternateEnclosures ? JSON.parse(JSON.stringify(track.alternateEnclosures)) : undefined,
            duration: track.duration,
            explicit: track.explicit,
            image: track.image,
            publishedAt: track.publishedAt,
            itunesAuthor: track.itunesAuthor,
            itunesSummary: track.itunesSummary,
            itunesImage: track.itunesImage,
            itunesDuration: track.itunesDuration,
            itunesKeywords: track.itunesKeywords || [],
            itunesCategories: track.itunesCategories || [],
            podcastCategories: parsedFeed.podcastCategories || [],
            v4vRecipient: track.v4vRecipient,
            v4vValue: track.v4vValue,
            startTime: track.startTime,
            endTime: track.endTime,
            chaptersUrl: track.chaptersUrl,
            chapters: track.chapters || undefined,
            valueTimeSplits: track.valueTimeSplits || undefined,
            trackOrder: track.episode ? calculateTrackOrder(track.episode, track.season) : index + 1,
            updatedAt: new Date()
        }));

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        // Release date for the grid + "Year" sort — without this the read
        // paths fall back to feed.createdAt and show the date it was added.
        await syncOldestItemPubdate(feed.id);
      }

      console.log(`✅ Imported: ${parsedFeed.title} (${parsedFeed.items.length} tracks)`);
      imported++;

      // Small delay to avoid overwhelming external servers
      await new Promise(r => setTimeout(r, 100));
    } catch (error) {
      console.error(`❌ Failed to import ${item.feedUrl}:`, error instanceof Error ? error.message : error);
      failed++;
    }
  }

  return { imported, failed, skipped };
}

/**
 * Generate a URL-friendly feed ID from artist and title
 */
function generateFeedId(artist: string | undefined, title: string): string {
  const parts = [];
  if (artist) {
    parts.push(generateAlbumSlug(artist));
  }
  parts.push(generateAlbumSlug(title));

  let baseId = parts.join('-');

  // Ensure we have a valid ID
  if (!baseId || baseId.length < 2) {
    baseId = `feed-${Date.now()}`;
  }

  return baseId;
}

// GET /api/feeds - List all feeds with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const sortBy = searchParams.get('sortBy') || 'priority'; // 'priority' or 'recent'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const isPublic = searchParams.get('public') === 'true';

    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    // Public listing: hide blacklisted feeds (test feeds, banned URLs).
    // Mirrors what /api/feeds/opml does.
    if (isPublic) {
      where.id = { notIn: BLACKLISTED_FEED_IDS };
      where.originalUrl = { notIn: BLACKLISTED_FEED_URLS.map(normalizeUrl) };
      if (!status) where.status = 'active';
    }

    // Determine sort order based on sortBy parameter
    const orderBy = sortBy === 'recent'
      ? [{ createdAt: 'desc' as const }]
      : [{ priority: 'asc' as const }, { createdAt: 'desc' as const }];

    const [feeds, total] = await Promise.all([
      prisma.feed.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: {
            select: { Track: true }
          }
        }
      }),
      prisma.feed.count({ where })
    ]);

    return NextResponse.json({
      feeds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching feeds:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feeds' },
      { status: 500 }
    );
  }
}

// POST /api/feeds - Add a new feed and fetch its tracks
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalUrl, type = 'album', priority = 'normal', cdnUrl } = body;
    
    if (!originalUrl) {
      return NextResponse.json(
        { error: 'originalUrl is required' },
        { status: 400 }
      );
    }

    // Validate URL before processing
    if (!isValidFeedUrl(originalUrl)) {
      return NextResponse.json(
        { error: 'Invalid feed URL. Must be a valid http or https URL.' },
        { status: 400 }
      );
    }

    // Reject blacklisted URLs before any DB writes. The podping consumer's
    // !exists && fromMsp branch can otherwise re-mint blacklisted feeds since
    // /api/feeds/exists also returns false for them.
    if (isBlacklistedFeedUrl(originalUrl)) {
      return NextResponse.json(
        { error: 'Feed URL is blacklisted', originalUrl },
        { status: 403 }
      );
    }

    // Resolve Podcast Index web page URLs to actual RSS feed URLs
    let resolvedUrl = originalUrl;
    const piResolution = await resolvePodcastIndexUrl(originalUrl);
    if (piResolution) {
      resolvedUrl = piResolution.feedUrl;
      console.log(`🔄 Resolved Podcast Index URL → ${resolvedUrl}`);
    }

    // Re-check after PI resolution in case the canonical RSS URL is the
    // blacklisted one even though the caller passed a podcastindex.org link.
    if (resolvedUrl !== originalUrl && isBlacklistedFeedUrl(resolvedUrl)) {
      return NextResponse.json(
        { error: 'Feed URL is blacklisted', originalUrl: resolvedUrl },
        { status: 403 }
      );
    }

    const normalizedOriginalUrl = normalizeUrl(resolvedUrl);

    // Check if feed already exists by URL first (return early to avoid parsing).
    // Uses the same lookup ladder as /api/feeds/exists and /api/feeds/refresh-by-url
    // (lib/feed-lookup.ts) — this is the endpoint that mints, so a lookup narrower than
    // the consumer's exists check turns a case-variant URL into a duplicate feed row.
    const existingMatch = await findFeedIdByUrl(resolvedUrl, originalUrl);
    const existingFeed = existingMatch
      ? await prisma.feed.findUnique({
          where: { id: existingMatch.id },
          include: {
            _count: {
              select: { Track: true }
            }
          }
        })
      : null;

    if (existingFeed) {
      return NextResponse.json(
        { error: 'Feed already exists', feed: existingFeed },
        { status: 409 }
      );
    }

    try {
      // Parse the RSS feed
      const parsedFeed = await parseRSSFeedWithSegments(resolvedUrl);

      // Reject Podcasting 2.0 "list" mediums (musicL, podcastL, videoL, etc.).
      // List feeds carry no <item> tags — they reference existing items via
      // <podcast:remoteItem>. The app has no generic playlist surface for
      // arbitrary URLs (curated playlists are hard-coded; see CLAUDE.md
      // "Adding New Playlists"), and the publisher auto-detect below would
      // misclassify them. See issue #127.
      const mediumLower = parsedFeed.medium?.toLowerCase();
      if (mediumLower && mediumLower.endsWith('l')) {
        console.log(`🚫 Rejecting playlist feed: medium="${parsedFeed.medium}"`);
        return NextResponse.json(
          {
            error: `Playlist feeds (medium="${parsedFeed.medium}") aren't supported via admin paste. Curated playlists are added by code; see CLAUDE.md "Adding New Playlists".`,
            medium: parsedFeed.medium,
          },
          { status: 400 }
        );
      }

      // Override type based on podcast:medium from RSS if the frontend sent default 'album'
      // Skip for Wavlake feeds — they use medium=podcast for music content
      let resolvedType = type;
      const isWavlakeFeed = resolvedUrl.includes('wavlake.com/feed');
      if (parsedFeed.medium === 'podcast' && type === 'album' && !isWavlakeFeed) {
        resolvedType = 'podcast';
        console.log('🎙️ Detected podcast:medium=podcast, setting type to podcast');
      }

      // Auto-detect publisher feeds: 0 items + has remoteItem album references
      if (resolvedType === 'album' && parsedFeed.items.length === 0) {
        try {
          const xmlCheck = await fetch(resolvedUrl, { signal: AbortSignal.timeout(15000) });
          if (xmlCheck.ok) {
            const xmlText = await xmlCheck.text();
            const remoteItems = extractRemoteItemsFromXML(xmlText);
            if (remoteItems.length > 0) {
              resolvedType = 'publisher';
              console.log(`🔗 Auto-detected publisher feed: 0 items, ${remoteItems.length} remoteItem references`);
            }
          }
        } catch (e) {
          console.warn('⚠️ Publisher auto-detection check failed:', e);
        }
      }

      // Generate a URL-friendly feed ID from artist and title
      let feedId = generateFeedId(parsedFeed.artist, parsedFeed.title);

      // Use upsert to atomically handle feed creation (prevents race conditions)
      // If another request created the same feed between our check and create, this won't fail
      let feed;
      try {
        feed = await prisma.feed.upsert({
          where: { originalUrl: normalizedOriginalUrl },
          create: {
            id: feedId,
            guid: parsedFeed.podcastGuid || null,
            originalUrl: normalizedOriginalUrl,
            cdnUrl: cdnUrl || normalizedOriginalUrl,
            type: resolvedType,
            // The declared medium, kept separate from `type`. `type` is this app's own
            // classification and has a default; `medium` is null until the feed actually
            // says. The shared favorites list publishes it, so a guess would be sticky.
            medium: mediumLower || null,
            priority,
            title: parsedFeed.title,
            description: parsedFeed.description,
            artist: parsedFeed.artist,
            image: parsedFeed.image,
            language: parsedFeed.language,
            category: parsedFeed.category,
            podcastCategories: parsedFeed.podcastCategories || [],
            explicit: parsedFeed.explicit,
            v4vRecipient: parsedFeed.v4vRecipient || null,
            v4vValue: parsedFeed.v4vValue || null,
            podcastImages: (parsedFeed.podcastImages as any) || undefined,
            ...channelPersonsFields(parsedFeed),
            lastFetched: new Date(),
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          update: {
            // If feed exists by URL, just update lastFetched (race condition case)
            lastFetched: new Date(),
            updatedAt: new Date()
          },
          select: { id: true, createdAt: true, updatedAt: true, originalUrl: true }
        });
      } catch (upsertError: any) {
        // GUID unique constraint collision — retry without GUID
        // This happens when a publisher feed's GUID was already claimed by one of its album feeds
        if (upsertError?.message?.includes('Unique constraint') && upsertError?.message?.includes('guid')) {
          console.warn(`⚠️ GUID collision for ${parsedFeed.podcastGuid}, creating feed without GUID`);
          feed = await prisma.feed.upsert({
            where: { originalUrl: normalizedOriginalUrl },
            create: {
              id: feedId,
              guid: null,
              originalUrl: normalizedOriginalUrl,
              cdnUrl: cdnUrl || normalizedOriginalUrl,
              type: resolvedType,
              medium: mediumLower || null,
              priority,
              title: parsedFeed.title,
              description: parsedFeed.description,
              artist: parsedFeed.artist,
              image: parsedFeed.image,
              language: parsedFeed.language,
              category: parsedFeed.category,
              podcastCategories: parsedFeed.podcastCategories || [],
              explicit: parsedFeed.explicit,
              v4vRecipient: parsedFeed.v4vRecipient || null,
              v4vValue: parsedFeed.v4vValue || null,
              podcastImages: (parsedFeed.podcastImages as any) || undefined,
              ...channelPersonsFields(parsedFeed),
              lastFetched: new Date(),
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date()
            },
            update: {
              lastFetched: new Date(),
              updatedAt: new Date()
            },
            select: { id: true, createdAt: true, updatedAt: true, originalUrl: true }
          });
        } else {
          throw upsertError;
        }
      }

      // Check if this was a new creation vs update (race condition detection)
      const wasCreated = Math.abs(feed.createdAt.getTime() - feed.updatedAt.getTime()) < 1000;

      if (!wasCreated) {
        // Another request created this feed - return it as existing
        const existingFeedWithCount = await prisma.feed.findUnique({
          where: { id: feed.id },
          include: {
            _count: {
              select: { Track: true }
            }
          }
        });
        return NextResponse.json(
          { error: 'Feed already exists (concurrent request)', feed: existingFeedWithCount },
          { status: 409 }
        );
      }
      
      // Create tracks in database
      if (parsedFeed.items.length > 0) {
        const tracksData = parsedFeed.items.map((item, index) => {
          const trackData: any = {
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
            trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1,
            updatedAt: new Date()
          };
          // Apply chapters, VTS, and other parsed fields
          applyParsedItemFields(trackData, item);
          return trackData;
        });

        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });

        // Release date for the grid + "Year" sort — without this the read
        // paths fall back to feed.createdAt and show the date it was added.
        await syncOldestItemPubdate(feed.id);
      }

      // Return feed with track count
      const feedWithCount = await prisma.feed.findUnique({
        where: { id: feed.id },
        include: {
          _count: {
            select: { Track: true }
          }
        }
      });

      // Auto-import and link albums when a publisher feed is added
      let linkedAlbumsInfo = null;
      if (resolvedType === 'publisher') {
        console.log('🔗 Auto-importing and linking albums to publisher feed...');

        try {
          // Re-fetch the XML to extract remoteItems (we already have parsedFeed but need raw XML)
          const xmlResponse = await fetch(resolvedUrl, {
            signal: AbortSignal.timeout(15000)
          });

          if (xmlResponse.ok) {
            const xmlText = await xmlResponse.text();
            const remoteItems = extractRemoteItemsFromXML(xmlText);

            // Get artist name from parsed feed
            const artistName = parsedFeed.artist || parsedFeed.title;

            console.log(`📋 Found ${remoteItems.length} album references in publisher feed`);

            // First, import any missing albums
            const importResult = await importMissingAlbums(feed.id, remoteItems);
            console.log(`📥 Import result: ${importResult.imported} imported, ${importResult.skipped} skipped, ${importResult.failed} failed`);

            // Then link any remaining albums by artist name
            const linkResult = await linkAlbumsToPublisher(feed.id, remoteItems, artistName);

            linkedAlbumsInfo = {
              remoteItemsFound: remoteItems.length,
              imported: importResult.imported,
              linkedByGuid: linkResult.linkedByGuid,
              linkedByArtist: linkResult.linkedByArtist,
              totalLinked: importResult.imported + linkResult.linkedByGuid + linkResult.linkedByArtist
            };

            console.log(`✅ Total: ${linkedAlbumsInfo.totalLinked} albums (${importResult.imported} imported, ${linkResult.linkedByGuid} linked by GUID, ${linkResult.linkedByArtist} by artist)`);
          }
        } catch (linkError) {
          console.error('⚠️ Error auto-importing/linking albums to publisher:', linkError);
        }
      }

      // Check for publisher feed if this is an album and auto-import it
      let publisherFeedInfo = null;
      let importedPublisherFeed = null;

      if (resolvedType === 'album') {
        // First check if the feed has a podcast:publisher tag
        if (parsedFeed.publisherFeed) {
          console.log('✅ Found publisher feed in RSS:', parsedFeed.publisherFeed.title || parsedFeed.publisherFeed.feedUrl);

          // Check if publisher feed already exists
          const existingPublisher = await prisma.feed.findFirst({
            where: {
              OR: [
                { originalUrl: parsedFeed.publisherFeed.feedUrl },
                { guid: parsedFeed.publisherFeed.feedGuid }
              ],
              type: 'publisher'
            }
          });

          if (existingPublisher) {
            console.log('ℹ️ Publisher feed already imported:', existingPublisher.title);
            publisherFeedInfo = {
              found: true,
              feedUrl: parsedFeed.publisherFeed.feedUrl,
              // Use existing publisher's title if not available in remoteItem (Wavlake format)
              title: parsedFeed.publisherFeed.title || existingPublisher.title,
              guid: parsedFeed.publisherFeed.feedGuid,
              medium: parsedFeed.publisherFeed.medium,
              alreadyImported: true
            };
          } else {
            // Auto-import the publisher feed
            console.log('🔄 Auto-importing publisher feed:', parsedFeed.publisherFeed.title || parsedFeed.publisherFeed.feedUrl);
            try {
              const publisherParsedFeed = await parseRSSFeedWithSegments(parsedFeed.publisherFeed.feedUrl);

              // Generate a URL-friendly publisher feed ID
              let publisherFeedId = generateFeedId(publisherParsedFeed.artist, publisherParsedFeed.title);

              // Check for collision
              const existingPublisherId = await prisma.feed.findUnique({
                where: { id: publisherFeedId }
              });

              if (existingPublisherId) {
                publisherFeedId = `${publisherFeedId}-${Date.now()}`;
              }

              // Create publisher feed in database
              const publisherFeed = await prisma.feed.create({
                data: {
                  id: publisherFeedId,
                  guid: parsedFeed.publisherFeed.feedGuid,
                  originalUrl: parsedFeed.publisherFeed.feedUrl,
                  cdnUrl: parsedFeed.publisherFeed.feedUrl,
                  type: 'publisher',
                  medium: publisherParsedFeed.medium?.toLowerCase() || null,
                  priority: 'normal',
                  title: publisherParsedFeed.title,
                  description: publisherParsedFeed.description,
                  artist: publisherParsedFeed.artist,
                  image: publisherParsedFeed.image,
                  language: publisherParsedFeed.language,
                  category: publisherParsedFeed.category,
                  explicit: publisherParsedFeed.explicit,
                  v4vRecipient: publisherParsedFeed.v4vRecipient || null,
                  v4vValue: publisherParsedFeed.v4vValue || null,
                  ...channelPersonsFields(publisherParsedFeed),
                  lastFetched: new Date(),
                  status: 'active',
                  updatedAt: new Date()
                }
              });

              // Import publisher tracks
              for (const item of publisherParsedFeed.items) {
                await prisma.track.create({
                  data: {
                    id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    guid: item.guid || `guid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    feedId: publisherFeed.id,
                    title: item.title,
                    subtitle: item.subtitle,
                    description: item.description,
                    audioUrl: item.audioUrl,
                    mediaType: detectTrackMediaType(item),
                    mimeType: item.mimeType,
                    alternateEnclosures: item.alternateEnclosures ? JSON.parse(JSON.stringify(item.alternateEnclosures)) : undefined,
                    duration: item.duration,
                    publishedAt: item.publishedAt,
                    image: item.image,
                    explicit: item.explicit,
                    v4vRecipient: item.v4vRecipient,
                    v4vValue: item.v4vValue,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    chaptersUrl: item.chaptersUrl,
                    chapters: item.chapters || undefined,
                    valueTimeSplits: item.valueTimeSplits || undefined,
                    updatedAt: new Date()
                  }
                });
              }

              // Get track count
              const publisherTrackCount = await prisma.track.count({
                where: { feedId: publisherFeed.id }
              });

              console.log(`✅ Auto-imported publisher feed with ${publisherTrackCount} tracks`);

              publisherFeedInfo = {
                found: true,
                feedUrl: parsedFeed.publisherFeed.feedUrl,
                // Use the parsed publisher feed's title (more reliable than remoteItem title)
                title: publisherFeed.title || parsedFeed.publisherFeed.title,
                guid: parsedFeed.publisherFeed.feedGuid,
                medium: parsedFeed.publisherFeed.medium,
                alreadyImported: false,
                autoImported: true
              };

              importedPublisherFeed = {
                id: publisherFeed.id,
                title: publisherFeed.title,
                trackCount: publisherTrackCount
              };
            } catch (publisherError) {
              console.error('❌ Failed to auto-import publisher feed:', publisherError);
              publisherFeedInfo = {
                found: true,
                feedUrl: parsedFeed.publisherFeed.feedUrl,
                // May be undefined for Wavlake format if import failed
                title: parsedFeed.publisherFeed.title,
                guid: parsedFeed.publisherFeed.feedGuid,
                medium: parsedFeed.publisherFeed.medium,
                alreadyImported: false,
                autoImported: false,
                error: publisherError instanceof Error ? publisherError.message : 'Unknown error'
              };
            }
          }
        } else if (parsedFeed.artist) {
          // Fallback to Podcast Index API search if no publisher tag found
          console.log('🔍 No publisher tag found, searching Podcast Index for artist:', parsedFeed.artist);
          publisherFeedInfo = await findPublisherFeed(parsedFeed.artist);

          if (publisherFeedInfo.found) {
            // Check if publisher feed already exists
            const existingPublisher = await prisma.feed.findFirst({
              where: {
                originalUrl: publisherFeedInfo.feedUrl,
                type: 'publisher'
              }
            });

            if (existingPublisher) {
              console.log('ℹ️ Publisher feed already imported');
              publisherFeedInfo.alreadyImported = true;
            } else {
              // Note: We don't auto-import Podcast Index searches, only direct RSS publisher tags
              publisherFeedInfo.autoImported = false;
            }
          }
        }
      }

      invalidateFeedListCaches();

      return NextResponse.json({
        message: 'Feed added successfully',
        feed: feedWithCount,
        publisherFeed: publisherFeedInfo,
        importedPublisherFeed,
        linkedAlbums: linkedAlbumsInfo
      }, { status: 201 });

    } catch (parseError) {
      // If parsing fails, still create the feed but mark it as error
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';

      const feed = await prisma.feed.create({
        data: {
          id: `feed-error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          originalUrl: normalizedOriginalUrl,
          cdnUrl: cdnUrl || normalizedOriginalUrl,
          type,
          priority,
          title: normalizedOriginalUrl,
          status: 'error',
          lastError: errorMessage,
          updatedAt: new Date()
        }
      });

      invalidateFeedListCaches();

      return NextResponse.json({
        warning: 'Feed added but parsing failed',
        feed,
        error: errorMessage
      }, { status: 206 });
    }
  } catch (error) {
    console.error('Error adding feed:', error);
    return NextResponse.json(
      { error: 'Failed to add feed' },
      { status: 500 }
    );
  }
}

// PUT /api/feeds - Update a feed
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Feed ID is required' },
        { status: 400 }
      );
    }
    
    const feed = await prisma.feed.update({
      where: { id },
      data: updateData
    });

    invalidateFeedListCaches();

    return NextResponse.json({
      message: 'Feed updated successfully',
      feed
    });
  } catch (error) {
    console.error('Error updating feed:', error);
    return NextResponse.json(
      { error: 'Failed to update feed' },
      { status: 500 }
    );
  }
}

// DELETE /api/feeds - Delete a feed
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Feed ID is required' },
        { status: 400 }
      );
    }
    
    // Delete feed (tracks will be cascade deleted)
    await prisma.feed.delete({
      where: { id }
    });

    invalidateFeedListCaches();

    return NextResponse.json({
      message: 'Feed deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting feed:', error);
    return NextResponse.json(
      { error: 'Failed to delete feed' },
      { status: 500 }
    );
  }
}