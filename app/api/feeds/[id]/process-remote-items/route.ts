import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder } from '@/lib/rss-parser-db';
import { generateAlbumSlug, normalizeUrl } from '@/lib/url-utils';
import { findFeedIdByUrl } from '@/lib/feed-lookup';
import { isBlacklistedFeedUrl, isPlaylistSourceFeedUrl } from '@/lib/feed-exclusions';
import { channelPersonsFields } from '@/lib/feeds/channel-persons';

interface RemoteItem {
  feedGuid?: string;
  feedUrl?: string;
  medium?: string;
}

function generateFeedId(artist: string | undefined, title: string): string {
  const parts = [];
  if (artist) parts.push(generateAlbumSlug(artist));
  parts.push(generateAlbumSlug(title));
  let baseId = parts.join('-');
  if (!baseId || baseId.length < 2) baseId = `feed-${Date.now()}`;
  return baseId;
}

/**
 * POST /api/feeds/[id]/process-remote-items
 *
 * Processes a publisher feed's podcast:remoteItem references and adds them as feeds
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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

    // Music-show-only publishers don't auto-import their albums.
    // Only albums referenced by a curated music show (via the playlist resolver) get tracks.
    if (publisherFeed.musicShowOnly) {
      console.log(`🎙️  Skipping album auto-import — publisher "${publisherFeed.title}" is music-show-only`);
      return NextResponse.json({
        message: 'Publisher is music-show-only; no albums auto-imported',
        musicShowOnly: true,
        remoteItems: [],
        added: 0,
        skipped: 0,
        errors: []
      });
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

    const rawXml = await response.text();

    // Strip <podcast:podroll> sections so we only process official remoteItem entries
    const xml = rawXml.replace(/<podcast:podroll>[\s\S]*?<\/podcast:podroll>/gi, '');

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

      if (isBlacklistedFeedUrl(remoteItem.feedUrl)) {
        console.log(`🚫 Skipping blacklisted feed URL: ${remoteItem.feedUrl}`);
        results.skipped++;
        continue;
      }

      if (isPlaylistSourceFeedUrl(remoteItem.feedUrl)) {
        console.log(`⏭️  Skipping playlist-source feed (admin-only): ${remoteItem.feedUrl}`);
        results.skipped++;
        continue;
      }

      try {
        // Check if feed already exists (by URL via the shared ladder, feedGuid, or
        // GUID-in-URL).
        //
        // The two `originalUrl` equality clauses that used to be here were exact,
        // and both resolve to the SAME string whenever the input is already
        // encoded — `normalizeUrl` encodes a literal space to `%20`. So a
        // remoteItem naming the `%20` form of a row stored with literal spaces
        // matched neither, and this loop minted a duplicate of an album it already
        // had (#247). The ladder's rung 2 percent-decodes and compares
        // case-insensitively, which is exactly that miss.
        const normalizedUrl = normalizeUrl(remoteItem.feedUrl);
        const urlMatch = await findFeedIdByUrl(remoteItem.feedUrl);
        const conditions: any[] = [];
        if (urlMatch) conditions.push({ id: urlMatch.id });
        if (remoteItem.feedGuid) {
          conditions.push({ id: remoteItem.feedGuid });
          conditions.push({ guid: remoteItem.feedGuid });
          conditions.push({ originalUrl: { contains: remoteItem.feedGuid } });
        }

        const existingFeed = conditions.length > 0
          ? await prisma.feed.findFirst({ where: { OR: conditions } })
          : null;

        if (existingFeed) {
          console.log(`⚡ Feed already exists: ${existingFeed.title} (${existingFeed.id})`);
          // Link to publisher if not already linked
          if (!existingFeed.publisherId) {
            await prisma.feed.update({
              where: { id: existingFeed.id },
              data: { publisherId: id }
            });
            console.log(`🔗 Linked to publisher: ${id}`);
          }
          results.skipped++;
          continue;
        }

        console.log(`🎵 Adding feed: ${remoteItem.feedUrl}`);

        // Parse the RSS feed
        const parsedFeed = await parseRSSFeedWithSegments(remoteItem.feedUrl);

        // Generate slug-based ID (same pattern as import-albums)
        let feedId = generateFeedId(parsedFeed.artist, parsedFeed.title);
        const idExists = await prisma.feed.findUnique({ where: { id: feedId } });
        if (idExists) {
          // The URL ladder and the guid checks both said this is a different feed,
          // yet the slug collides. Possible, but also #247's duplicate-mint shape,
          // which used to happen silently. `console.warn` survives production's
          // `removeConsole`; `console.log` does not.
          console.warn(
            `⚠️ feed id collision minting a new row: ${feedId} already exists, ` +
            `creating ${feedId}-<ts> from ${remoteItem.feedUrl}. If these are the ` +
            `same album this is a duplicate mint (#247).`
          );
          feedId = `${feedId}-${Date.now()}`;
        }

        // Secondary GUID check after parsing (feed XML may reveal a GUID we didn't have before)
        if (parsedFeed.podcastGuid) {
          const guidExists = await prisma.feed.findFirst({
            where: { guid: parsedFeed.podcastGuid }
          });
          if (guidExists) {
            console.log(`⚡ Feed found by parsed GUID: ${guidExists.title} (${guidExists.id})`);
            if (!guidExists.publisherId) {
              await prisma.feed.update({
                where: { id: guidExists.id },
                data: { publisherId: id }
              });
            }
            results.skipped++;
            continue;
          }
        }

        // Create feed in database
        const feed = await prisma.feed.create({
          data: {
            id: feedId,
            guid: parsedFeed.podcastGuid || null,
            originalUrl: normalizedUrl,
            cdnUrl: normalizedUrl,
            type: 'album',
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
            publisherId: id,
            ...channelPersonsFields(parsedFeed),
            lastFetched: new Date(),
            status: 'active',
            createdAt: new Date(),
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
            podcastCategories: parsedFeed.podcastCategories || [],
            v4vRecipient: item.v4vRecipient,
            v4vValue: item.v4vValue,
            startTime: item.startTime,
            endTime: item.endTime,
            trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1,
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
