import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder, detectTrackMediaType, applyParsedItemFields } from '@/lib/rss-parser-db';
import { resolvePodcastIndexUrl } from '@/lib/podcast-index-api';
import { normalizeUrl } from '@/lib/url-utils';
import { findFeedIdByUrl } from '@/lib/feed-lookup';
import { RateLimiter, clientIp } from '@/lib/rate-limit';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';

// Public endpoint (podping consumer) that triggers expensive RSS reparses —
// cap per-IP request rate. In-memory, so the cap is per Railway instance;
// 30/min comfortably exceeds the consumer's organic podping rate.
const refreshLimiter = new RateLimiter(30, 60_000);

interface RemoteItemResult {
  added: number;
  skipped: number;
  errors: Array<{ feedUrl: string; error: string }>;
  albums: Array<{ id: string; title: string; tracks: number }>;
}

/**
 * Process podcast:remoteItem references from a publisher feed
 * Returns the albums that were added/found
 */
async function processRemoteItems(feedUrl: string, publisherFeedId: string): Promise<RemoteItemResult> {
  const results: RemoteItemResult = {
    added: 0,
    skipped: 0,
    errors: [],
    albums: []
  };

  try {
    // Fetch the raw XML to extract remoteItems
    const response = await fetch(feedUrl);
    if (!response.ok) {
      return results;
    }

    const xml = await response.text();

    // Extract podcast:remoteItem tags
    const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
    const matches = xml.match(remoteItemRegex) || [];

    if (matches.length === 0) {
      return results;
    }

    console.log(`📡 Found ${matches.length} remoteItems in publisher feed`);

    for (const match of matches) {
      const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
      if (!feedUrlMatch) continue;

      const albumFeedUrl = feedUrlMatch[1];

      try {
        // Check if album feed already exists
        const existingAlbum = await prisma.feed.findFirst({
          where: { originalUrl: albumFeedUrl },
          include: { _count: { select: { Track: true } } }
        });

        if (existingAlbum) {
          console.log(`⚡ Album already exists: ${existingAlbum.title}`);
          results.albums.push({
            id: existingAlbum.id,
            title: existingAlbum.title,
            tracks: existingAlbum._count.Track
          });
          results.skipped++;
          continue;
        }

        // Parse and create the album feed
        console.log(`🎵 Parsing album: ${albumFeedUrl}`);
        const parsedAlbum = await parseRSSFeedWithSegments(albumFeedUrl);

        // Detect feed type from <podcast:medium>
        let albumType = 'album';
        try {
          const xmlResp = await fetch(albumFeedUrl);
          if (xmlResp.ok) {
            const xml = await xmlResp.text();
            const mediumMatch = xml.match(/<podcast:medium>([^<]+)<\/podcast:medium>/);
            if (mediumMatch) {
              const medium = mediumMatch[1].toLowerCase().trim();
              if (medium === 'music' || medium === 'album') {
                albumType = 'music';
              } else if (medium === 'publisher') {
                albumType = 'publisher';
              }
              console.log(`📋 Album medium: ${medium} → type: ${albumType}`);
            }
          }
        } catch (e) {
          // Ignore, default to album
        }

        const albumId = `album-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await prisma.feed.create({
          data: {
            id: albumId,
            originalUrl: albumFeedUrl,
            cdnUrl: albumFeedUrl,
            type: albumType,
            // What the feed declares, not what we concluded. `type` above folds
            // music/album together and defaults when nothing is declared; `medium`
            // stays null in that case, because the shared favorites list publishes
            // it and a guessed value is sticky across every app that reads it.
            medium: parsedAlbum.medium?.toLowerCase() ?? null,
            priority: 'normal',
            title: parsedAlbum.title,
            description: parsedAlbum.description,
            artist: parsedAlbum.artist,
            image: parsedAlbum.image,
            language: parsedAlbum.language,
            category: parsedAlbum.category,
            explicit: parsedAlbum.explicit,
            v4vRecipient: parsedAlbum.v4vRecipient,
            v4vValue: parsedAlbum.v4vValue ?? undefined,
            publisherId: publisherFeedId,
            ...channelPersonsFields(parsedAlbum),
            lastFetched: new Date(),
            status: 'active',
            updatedAt: new Date()
          }
        });

        // Create tracks
        if (parsedAlbum.items.length > 0) {
          const tracksData = parsedAlbum.items.map((item, index) => ({
            id: `${albumId}-${item.guid || `track-${index}-${Date.now()}`}`,
            feedId: albumId,
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
              v4vRecipient: item.v4vRecipient,
              v4vValue: item.v4vValue,
              chaptersUrl: item.chaptersUrl,
              chapters: item.chapters,
              valueTimeSplits: item.valueTimeSplits,
              startTime: item.startTime,
              endTime: item.endTime,
              trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1,
              updatedAt: new Date()
            }));

          await prisma.track.createMany({
            data: tracksData,
            skipDuplicates: true
          });
        }

        console.log(`✅ Added album "${parsedAlbum.title}" with ${parsedAlbum.items.length} tracks`);
        results.albums.push({
          id: albumId,
          title: parsedAlbum.title,
          tracks: parsedAlbum.items.length
        });
        results.added++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error processing ${albumFeedUrl}: ${errorMessage}`);
        results.errors.push({ feedUrl: albumFeedUrl, error: errorMessage });
      }
    }
  } catch (error) {
    console.error('Error processing remoteItems:', error);
  }

  return results;
}

// POST /api/feeds/refresh-by-url - Refresh a feed by its originalUrl
export async function POST(request: NextRequest) {
  try {
    // clientIp(), not x-forwarded-for[0]: the first entry is what the CALLER
    // sent, so varying it minted a fresh bucket per request.
    if (refreshLimiter.isLimited(clientIp(request.headers))) {
      return NextResponse.json(
        { error: 'Too many refresh requests, slow down' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const body = await request.json();
    // Accept both 'url' and 'originalUrl' for backwards compatibility
    const originalUrl = body.originalUrl || body.url;
    // Optional: custom feedId and type for test feeds
    const customFeedId = body.feedId;
    const customType = body.type;

    if (!originalUrl) {
      return NextResponse.json(
        { error: 'originalUrl or url is required' },
        { status: 400 }
      );
    }

    // Resolve Podcast Index web page URLs to actual RSS feed URLs
    let resolvedUrl = originalUrl;
    const piResolution = await resolvePodcastIndexUrl(originalUrl);
    if (piResolution) {
      resolvedUrl = piResolution.feedUrl;
      console.log(`🔄 Resolved Podcast Index URL → ${resolvedUrl}`);
    }

    // Normalize URLs for consistent storage (handles encoding differences like spaces vs %20)
    const normalizedResolvedUrl = normalizeUrl(resolvedUrl);

    // Shared lookup ladder (exact URL variants → case-insensitive → uuid-in-URL) lives in
    // lib/feed-lookup.ts so this endpoint, GET /api/feeds/exists, and POST /api/feeds
    // can't drift apart — divergence between the first two caused the Podhome/UpBeats
    // silent-skip bug.
    const match = await findFeedIdByUrl(resolvedUrl, originalUrl);
    let feed = match
      ? await prisma.feed.findUnique({ where: { id: match.id } })
      : null;

    // Guard: if URL + UUID lookup both missed, only allow creation when the
    // caller explicitly provided customFeedId. This closes a loophole where any
    // unauthenticated POST to /api/feeds/refresh-by-url could mint a new Feed row
    // (e.g., a rogue podping consumer bypassing /api/feeds/exists). Callers
    // without customFeedId (podping consumer, admin "reparse by URL" form) get
    // 404 and must use POST /api/feeds explicitly to create new feeds.
    if (!feed && !customFeedId) {
      return NextResponse.json(
        { error: 'Feed not found for originalUrl; refresh-by-url does not mint new feeds without an explicit feedId. Use POST /api/feeds to add a new feed.' },
        { status: 404 }
      );
    }

    // Parse the RSS feed first (needed whether feed exists or not)
    let parsedFeed;
    try {
      parsedFeed = await parseRSSFeedWithSegments(resolvedUrl);
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
      return NextResponse.json({
        error: 'Failed to parse RSS feed',
        message: errorMessage
      }, { status: 400 });
    }

    // If feed doesn't exist, create it (customFeedId required — see guard above)
    if (!feed) {
      try {
        // Use custom feedId if provided, otherwise generate a random one
        const feedId = customFeedId || `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Determine feed type from <podcast:medium> tag if not explicitly provided
        let feedType = customType;
        if (!feedType) {
          try {
            // Fetch raw XML to get podcast:medium
            const xmlResponse = await fetch(resolvedUrl);
            if (xmlResponse.ok) {
              const xmlText = await xmlResponse.text();
              const mediumMatch = xmlText.match(/<podcast:medium>([^<]+)<\/podcast:medium>/);
              if (mediumMatch) {
                const medium = mediumMatch[1].toLowerCase().trim();
                // Map podcast:medium values to feed types
                if (medium === 'publisher') {
                  feedType = 'publisher';
                } else if (medium === 'music' || medium === 'album') {
                  feedType = 'music';
                } else if (medium === 'podcast') {
                  feedType = 'podcast';
                }
                console.log(`📋 Detected <podcast:medium>${medium}</podcast:medium> → type: ${feedType}`);
              }
            }
          } catch (e) {
            console.warn('Could not fetch XML for medium detection:', e);
          }
          // Default to album if still not determined
          feedType = feedType || 'album';
        }

        const newFeed = await prisma.feed.create({
          data: {
            id: feedId,
            originalUrl: normalizedResolvedUrl,
            cdnUrl: normalizedResolvedUrl,
            type: feedType,
            // `feedType` may have come from `customType` or from the default above;
            // `medium` records only what the feed itself declared, and stays null
            // when it declared nothing. See the shared favorites list.
            medium: parsedFeed.medium?.toLowerCase() ?? null,
            priority: 'normal',
            title: parsedFeed.title,
            description: parsedFeed.description,
            artist: parsedFeed.artist,
            image: parsedFeed.image,
            language: parsedFeed.language,
            category: parsedFeed.category,
            explicit: parsedFeed.explicit,
            ...channelPersonsFields(parsedFeed),
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
              v4vRecipient: item.v4vRecipient,
              v4vValue: item.v4vValue,
              chaptersUrl: item.chaptersUrl,
              chapters: item.chapters,
              valueTimeSplits: item.valueTimeSplits,
              startTime: item.startTime,
              endTime: item.endTime,
              trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1,
              updatedAt: new Date()
            }));

          await prisma.track.createMany({
            data: tracksData,
            skipDuplicates: true
          });
        }

        // Return early for newly created feeds
        let newFeedWithCount = await prisma.feed.findUnique({
          where: { id: newFeed.id },
          include: {
            _count: {
              select: { Track: true }
            }
          }
        });

        // If new feed has 0 tracks, check for remoteItems (publisher feed)
        let remoteItemsResult: RemoteItemResult | null = null;
        if (newFeedWithCount && newFeedWithCount._count.Track === 0) {
          console.log(`📡 New feed has 0 tracks, checking for remoteItems...`);
          remoteItemsResult = await processRemoteItems(resolvedUrl, newFeed.id);

          if (remoteItemsResult.albums.length > 0) {
            console.log(`✅ Processed ${remoteItemsResult.albums.length} albums from remoteItems`);
            // Update feed type to publisher (or keep test if specified)
            await prisma.feed.update({
              where: { id: newFeed.id },
              data: { type: feedType === 'test' ? 'test' : 'publisher' }
            });

            newFeedWithCount = await prisma.feed.findUnique({
              where: { id: newFeed.id },
              include: {
                _count: {
                  select: { Track: true }
                }
              }
            });
          }
        }

        return NextResponse.json({
          message: 'Feed created and populated successfully',
          feed: newFeedWithCount,
          newTracks: parsedFeed.items.length,
          totalTracks: newFeedWithCount?._count.Track || 0,
          ...(remoteItemsResult && remoteItemsResult.albums.length > 0 ? {
            remoteItems: {
              added: remoteItemsResult.added,
              skipped: remoteItemsResult.skipped,
              albums: remoteItemsResult.albums,
              errors: remoteItemsResult.errors
            }
          } : {})
        });
      } catch (createError) {
        return NextResponse.json({
          error: 'Failed to create feed',
          message: createError instanceof Error ? createError.message : 'Unknown error'
        }, { status: 500 });
      }
    }

    // At this point feed must exist (we returned early above if it didn't)
    if (!feed) {
      return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
    }

    try {
      // If customFeedId provided and different from current, we need to update the ID
      // This requires updating all track references too
      if (customFeedId && customFeedId !== feed.id) {
        console.log(`🔄 Updating feed ID from ${feed.id} to ${customFeedId}`);

        // Re-key the row IN PLACE, in one statement — not delete-then-create.
        //
        // Prisma's client cannot change a primary key, so this used to repoint
        // the tracks, delete the row, and rebuild it field by field. Two things
        // were wrong with that, and the second hid the first:
        //
        //   1. The rebuild was a hand-written copy that dropped SEVEN columns —
        //      markedDead, oldestItemPubdate, lastNewTrackAt, podcastImages,
        //      persons, musicShowOnly and createdAt. A hidden or blacklisted
        //      feed un-hid itself, the album lost its release date and its place
        //      in the "New" filter, and createdAt reset to now(), which reorders
        //      the home grid via Feed_status_priority_createdAt_idx.
        //   2. The sequence could not complete at all for a feed that has
        //      tracks. Track_feedId_fkey is a plain immediate constraint (init
        //      migration line 128), so repointing tracks at an id that does not
        //      exist yet raises 23503 and the route 500s. Creating the new row
        //      first does not help either: Feed.originalUrl and Feed.guid are
        //      both @unique, so the copy collides with the row it is copying.
        //      Only a track-less feed ever got through.
        //
        // Postgres has no such limit on UPDATE, and Track_feedId_fkey is
        // ON UPDATE CASCADE, so the tracks follow the key in the same statement.
        // Nothing is copied, so no column can be dropped — the class of bug in
        // (1) is now unreachable rather than merely fixed.
        const rekeyedRows = await prisma.$executeRaw`
          UPDATE "Feed" SET "id" = ${customFeedId} WHERE "id" = ${feed.id}
        `;
        if (rekeyedRows !== 1) {
          throw new Error(
            `Re-key of feed ${feed.id} to ${customFeedId} updated ${rekeyedRows} rows, expected 1`
          );
        }

        const rekeyedFeed = await prisma.feed.findUnique({ where: { id: customFeedId } });
        if (!rekeyedFeed) {
          throw new Error(`Feed ${customFeedId} missing after re-key`);
        }
        feed = rekeyedFeed;
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
          explicit: parsedFeed.explicit,
          type: customType || feed.type, // Allow updating type too
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
      // Preserve RSS feed order (newest-first, matching podcastindex.org)
      const parsedItemsByGuid = new Map(
        parsedFeed.items.map((item, index) => [item.guid, { item, order: index + 1 }])
      );
      
      // Update ALL track metadata for existing tracks based on current RSS feed
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

        if (order !== null && matchedItem) {
          // Build update data with all track metadata fields
          const updateData: any = {
            trackOrder: order,
            // Metadata fields
            title: matchedItem.title,
            subtitle: matchedItem.subtitle,
            description: matchedItem.description,
            artist: matchedItem.artist,
            audioUrl: matchedItem.audioUrl,
            duration: matchedItem.duration,
            explicit: matchedItem.explicit,
            image: matchedItem.image,
            publishedAt: matchedItem.publishedAt,
            // iTunes fields
            itunesAuthor: matchedItem.itunesAuthor,
            itunesSummary: matchedItem.itunesSummary,
            itunesImage: matchedItem.itunesImage,
            itunesDuration: matchedItem.itunesDuration,
            itunesKeywords: matchedItem.itunesKeywords || [],
            itunesCategories: matchedItem.itunesCategories || [],
            // V4V fields
            v4vRecipient: matchedItem.v4vRecipient,
            v4vValue: matchedItem.v4vValue,
            // Time fields
            startTime: matchedItem.startTime,
            endTime: matchedItem.endTime,
            // Update timestamp
            updatedAt: new Date()
          };

          // Apply chapters and VTS fields
          applyParsedItemFields(updateData, matchedItem);

          if (matchedItem.v4vRecipient) {
            v4vUpdatedCount++;
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
        console.log(`✅ Updated metadata for ${updatePromises.length} existing tracks (${v4vUpdatedCount} with v4v data)`);
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
        // Ensure feed exists (TypeScript guard)
        if (!feed) {
          return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
        }
        
        // Capture feed.id to satisfy TypeScript's control flow analysis
        const feedId = feed.id;
        
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
            id: `${feedId}-${item.guid || `track-${index}-${Date.now()}`}`,
            feedId: feedId,
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
            v4vRecipient: item.v4vRecipient,
            v4vValue: item.v4vValue,
            chaptersUrl: item.chaptersUrl,
            chapters: item.chapters,
            valueTimeSplits: item.valueTimeSplits,
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
      }

      // Get updated feed with counts
      let updatedFeed = await prisma.feed.findUnique({
        where: { id: feed.id },
        include: {
          _count: {
            select: { Track: true }
          }
        }
      });

      // If this is a publisher feed (has no tracks but might have remoteItems), process them
      let remoteItemsResult: RemoteItemResult | null = null;
      if (updatedFeed && updatedFeed._count.Track === 0 && !feed.musicShowOnly) {
        console.log(`📡 Feed has 0 tracks, checking for remoteItems...`);
        remoteItemsResult = await processRemoteItems(resolvedUrl, feed.id);

        if (remoteItemsResult.albums.length > 0) {
          console.log(`✅ Processed ${remoteItemsResult.albums.length} albums from remoteItems`);
          // Update feed type to 'test' if it was a test feed, otherwise 'publisher'
          await prisma.feed.update({
            where: { id: feed.id },
            data: { type: customType || 'publisher' }
          });

          // Refresh feed data
          updatedFeed = await prisma.feed.findUnique({
            where: { id: feed.id },
            include: {
              _count: {
                select: { Track: true }
              }
            }
          });
        }
      }

      return NextResponse.json({
        message: 'Feed refreshed successfully',
        feed: updatedFeed,
        newTracks: newItems.length,
        ...(remoteItemsResult && remoteItemsResult.albums.length > 0 ? {
          remoteItems: {
            added: remoteItemsResult.added,
            skipped: remoteItemsResult.skipped,
            albums: remoteItemsResult.albums,
            errors: remoteItemsResult.errors
          }
        } : {}),
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

