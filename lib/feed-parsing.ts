/**
 * Feed parsing utilities
 *
 * Shared functions for parsing podcast/music feeds from Podcast Index API
 * and importing them to the database.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ValueTagParser } from '@/lib/lightning/value-parser';
import { isValidFeedUrl, normalizeUrl } from '@/lib/url-utils';
import { syncOldestItemPubdate } from '@/lib/feed-pubdate';
import { calculateTrackOrder, parsePodcastGuidFromXML, parsePodcastMediumFromXML, fetchChapters, parseChannelPersonsFromXML, parseChannelPodcastImagesFromXML, pickSquareArtwork } from '@/lib/rss-parser-db';
import { decodeHtmlEntities } from '@/lib/decode-entities';
import { preserveImageVersion } from '@/lib/feeds/image-version-url';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

export function generateAuthHeaders() {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    throw new Error('Podcast Index API credentials not configured');
  }

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': 'StableKraft-Feed-Parser/1.0',
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}

export async function lookupFeedByGuid(guid: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.status === 'true' && data.feed) {
      return data.feed;
    }

    return null;
  } catch (error) {
    console.error(`❌ Error looking up ${guid}:`, error);
    return null;
  }
}

export interface ParsedEpisode {
  title: string;
  description: string;
  guid: string;
  audioUrl: string;
  image: string;
  duration: string;
  pubDate: string;
  episode?: number | null;
  season?: number;
  v4vValue?: any;
  chaptersUrl?: string;
  chapters?: Array<{ title: string; startTime: number; endTime?: number; img?: string }>;
}

export interface ParseFeedResult {
  episodes: ParsedEpisode[];
  xmlText: string;
}

export async function parseFeedXML(feedUrl: string): Promise<ParseFeedResult | null> {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'StableKraft-Feed-Parser/1.0'
      }
    });

    if (!response.ok) {
      return null;
    }

    const xmlText = await response.text();

    // Simple XML parsing for episodes/tracks
    const episodes: ParsedEpisode[] = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemContent = match[1];

      // Extract basic fields
      const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const descMatch = itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/);
      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
      const audioMatch = itemContent.match(/<enclosure[^>]*url="([^"]*)"[^>]*type="audio[^"]*"/);
      const imageMatch = itemContent.match(/<itunes:image[^>]*href="([^"]*)"/);
      const durationMatch = itemContent.match(/<itunes:duration>([^<]*)<\/itunes:duration>/);
      const pubDateMatch = itemContent.match(/<pubDate>([^<]*)<\/pubDate>/);
      // Extract episode number for track ordering (podcast:episode or itunes:episode)
      const episodeMatch = itemContent.match(/<podcast:episode>(\d+)<\/podcast:episode>|<itunes:episode>(\d+)<\/itunes:episode>/);
      // Extract season number for track ordering (podcast:season or itunes:season)
      const seasonMatch = itemContent.match(/<podcast:season>(\d+)<\/podcast:season>|<itunes:season>(\d+)<\/itunes:season>/);
      // Extract chapters URL
      const chaptersMatch = itemContent.match(/<podcast:chapters[^>]*url="([^"]*)"/);

      const title = titleMatch ? decodeHtmlEntities((titleMatch[1] || titleMatch[2] || '').trim()) : '';
      const description = descMatch ? decodeHtmlEntities((descMatch[1] || descMatch[2] || '').trim()) : '';
      const guid = guidMatch ? guidMatch[1].trim() : '';
      const audioUrl = audioMatch ? audioMatch[1] : '';
      const image = imageMatch ? imageMatch[1] : '';
      const duration = durationMatch ? durationMatch[1] : '';
      const pubDate = pubDateMatch ? pubDateMatch[1] : '';
      const episode = episodeMatch ? parseInt(episodeMatch[1] || episodeMatch[2]) : null;
      const season = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2]) : undefined;
      const chaptersUrl = chaptersMatch ? chaptersMatch[1] : undefined;

      if (title && guid) {
        episodes.push({
          title,
          description,
          guid,
          audioUrl,
          image,
          duration,
          pubDate,
          episode,
          season,
          chaptersUrl
        });
      }
    }

    // Return both episodes and full XML for v4v parsing
    return { episodes, xmlText };

  } catch (error) {
    console.error(`❌ Error parsing feed ${feedUrl}:`, error);
    return null;
  }
}

export function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;

  // Handle different duration formats
  if (durationStr.includes(':')) {
    const parts = durationStr.split(':').map(p => parseInt(p) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hours:minutes:seconds
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1]; // minutes:seconds
    }
  }

  // Handle numeric duration (assume seconds)
  const numeric = parseInt(durationStr);
  return isNaN(numeric) ? 0 : numeric;
}

export interface ImportFeedResult {
  feedId: string;
  title: string;
  trackCount: number;
  hadTracks: boolean;
  newTracks: number;
}

export async function importFeedToDatabase(feedData: any, episodes: ParsedEpisode[], xmlText?: string): Promise<ImportFeedResult | null> {
  try {
    // Ensure feed ID is a string (Podcast Index returns numeric IDs)
    let feedId = String(feedData.id || feedData.guid || `feed-${Date.now()}`);

    // Validate and normalize URL before storing
    const feedUrl = feedData.url || '';
    const normalizedFeedUrl = feedUrl && isValidFeedUrl(feedUrl) ? normalizeUrl(feedUrl) : feedUrl;

    if (feedUrl && !isValidFeedUrl(feedUrl)) {
      console.warn(`⚠️ Invalid feed URL for ${feedId}: ${feedUrl}`);
    }

    // Check if URL already exists with a different ID — use the existing feed for track import
    let existingFeedById: { id: string; title: string } | null = null;
    if (normalizedFeedUrl) {
      existingFeedById = await prisma.feed.findFirst({
        where: {
          originalUrl: normalizedFeedUrl,
          id: { not: feedId }
        },
        select: { id: true, title: true }
      });

      if (existingFeedById) {
        console.log(`⚡ Feed URL already exists as "${existingFeedById.title}" (ID: ${existingFeedById.id}), importing tracks into existing feed for ${feedId}`);
        // Override feedId to use the existing feed — tracks will be imported below
        feedId = existingFeedById.id;
      }
    }

    // Parse v4v tags from RSS feed if xmlText is provided
    let parsedV4V = null;
    if (xmlText) {
      try {
        const valueParser = new ValueTagParser();
        parsedV4V = valueParser.parseValueTags(xmlText);
        console.log(`📊 Parsed v4v tags for feed ${feedId}: channel=${parsedV4V.channelValue ? 'yes' : 'no'}, items=${parsedV4V.itemValues.size}`);
      } catch (v4vError) {
        console.warn(`⚠️ Failed to parse v4v tags for feed ${feedId}:`, v4vError);
      }
    }

    // Prepare channel-level v4v data for feed storage
    let feedV4vData = null;
    let feedV4vRecipient = null;
    if (parsedV4V?.channelValue) {
      feedV4vData = {
        type: parsedV4V.channelValue.type,
        method: parsedV4V.channelValue.method,
        suggested: parsedV4V.channelValue.suggested,
        recipients: parsedV4V.channelValue.recipients.map((r: any) => ({
          name: r.name,
          type: r.type,
          address: r.address,
          split: r.split,
          customKey: r.customKey,
          customValue: r.customValue,
          fee: r.fee || false
        }))
      };
      feedV4vRecipient = parsedV4V.channelValue.recipients[0]?.address || null;
      console.log(`📊 Storing channel-level v4v data on feed ${feedId}: ${parsedV4V.channelValue.recipients.length} recipients`);
    }

    // Extract podcast:guid from XML or Podcast Index API data
    const podcastGuid = (xmlText ? parsePodcastGuidFromXML(xmlText) : null) || feedData.podcastGuid || null;
    if (podcastGuid) {
      console.log(`🔑 Found podcast:guid for feed ${feedId}: ${podcastGuid}`);
    }

    // Extract <podcast:medium> the same way, and from the XML rather than from
    // `feedData.type`, which is this app's own guess. Published at position 4 of
    // the shared favorites list, where a guess would be sticky across every app
    // that reads it — so a feed that declares nothing keeps NULL here.
    const podcastMedium = xmlText ? parsePodcastMediumFromXML(xmlText) : null;

    // Parse channel-level <podcast:person> tags (MSP emits npubs here for bands/hosts)
    const channelPersons = xmlText ? parseChannelPersonsFromXML(xmlText) : [];
    const channelPersonsData = channelPersons.length > 0 ? channelPersons : null;
    if (channelPersonsData) {
      console.log(`👥 Found ${channelPersons.length} channel-level person(s) for feed ${feedId}`);
    }

    // Parse channel-level <podcast:image> tags (Podcasting 2.0 multi-variant artwork)
    const channelPodcastImages = xmlText ? parseChannelPodcastImagesFromXML(xmlText) : [];
    const channelPodcastImagesData = channelPodcastImages.length > 0 ? channelPodcastImages : null;
    if (channelPodcastImagesData) {
      console.log(`🖼️ Found ${channelPodcastImages.length} channel-level podcast:image variant(s) for feed ${feedId}`);
    }
    // Fall back to a square podcast:image only when no other image source exists.
    const feedImage = feedData.image || pickSquareArtwork(channelPodcastImagesData) || null;

    // The stored image may carry our version (lib/feeds/image-version.ts). This
    // path takes the Podcast Index image and does not ask the image host, so it
    // keeps that version instead of stripping it on every nightly run.
    const storedImage = (await prisma.feed.findUnique({ where: { id: feedId }, select: { image: true } }))?.image;

    // Use upsert to atomically create or update feed (prevents race conditions)
    const feed = await prisma.feed.upsert({
      where: { id: feedId },
      create: {
        id: feedId,
        title: feedData.title || 'Unknown Feed',
        description: feedData.description || null,
        originalUrl: normalizedFeedUrl,
        type: feedData.type === 1 ? 'music' : 'podcast',
        artist: feedData.author || null,
        image: feedImage,
        language: feedData.language || null,
        category: feedData.categories ? Object.keys(feedData.categories)[0] : null,
        explicit: feedData.explicit === 1,
        status: 'active',
        lastFetched: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(feedV4vData && { v4vValue: feedV4vData }),
        ...(feedV4vRecipient && { v4vRecipient: feedV4vRecipient }),
        ...(podcastGuid && { guid: podcastGuid }),
        ...(podcastMedium && { medium: podcastMedium }),
        ...(channelPersonsData && { persons: channelPersonsData }),
        ...(channelPodcastImagesData && { podcastImages: channelPodcastImagesData })
      },
      update: {
        // Update existing feed metadata
        title: feedData.title || undefined,
        description: feedData.description || undefined,
        artist: feedData.author || undefined,
        image: preserveImageVersion(feedData.image || undefined, storedImage),
        language: feedData.language || undefined,
        category: feedData.categories ? Object.keys(feedData.categories)[0] : undefined,
        explicit: feedData.explicit === 1 ? true : undefined,
        status: 'active',
        lastFetched: new Date(),
        updatedAt: new Date(),
        ...(feedV4vData && { v4vValue: feedV4vData }),
        ...(feedV4vRecipient && { v4vRecipient: feedV4vRecipient }),
        ...(podcastGuid && { guid: podcastGuid }),
        ...(podcastMedium && { medium: podcastMedium }),
        ...(channelPersonsData && { persons: channelPersonsData }),
        ...(channelPodcastImagesData && { podcastImages: channelPodcastImagesData })
      }
    });

    // Check if feed has any tracks
    const existingTrackCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    // Import tracks/episodes
    let trackCount = 0;
    let newTracksCreated = 0;

    // Batch lookup: Get all existing tracks by guid in one query (fixes N+1)
    const episodeGuids = episodes.map(e => e.guid).filter(Boolean);
    const existingTracks = episodeGuids.length > 0
      ? await prisma.track.findMany({
          where: { guid: { in: episodeGuids } },
          select: { id: true, guid: true, v4vValue: true }
        })
      : [];
    const existingTracksByGuid = new Map(existingTracks.map(t => [t.guid, t]));

    for (const episode of episodes) {
      try {
        // Check if track already exists (from our pre-fetched map)
        const existingTrack = episode.guid ? existingTracksByGuid.get(episode.guid) : null;

        // Get v4v data for this track
        let v4vData = null;
        let v4vRecipient = null;

        // Check if episode already has v4v data from Podcast Index API
        if (episode.v4vValue && episode.v4vValue.destinations) {
          v4vData = {
            type: episode.v4vValue.model?.type || 'lightning',
            method: episode.v4vValue.model?.method || 'keysend',
            suggested: episode.v4vValue.model?.suggested,
            recipients: episode.v4vValue.destinations.map((r: any) => ({
              name: r.name,
              type: r.type,
              address: r.address,
              split: r.split,
              customKey: r.customKey,
              customValue: r.customValue,
              fee: r.fee || false
            }))
          };
          // Extract lightning address from first recipient
          v4vRecipient = episode.v4vValue.destinations[0]?.address || null;
          console.log(`✅ Found v4v data from API for track "${episode.title}": ${episode.v4vValue.destinations.length} recipients`);
        }
        // Fallback to parsed XML v4v data if available
        // IMPORTANT: Only use item-level value tags, not channel-level
        // Channel-level splits should be stored on the Feed, not on individual Tracks
        // Frontend will handle the fallback to channel-level when displaying
        else if (parsedV4V && episode.guid) {
          const itemV4V = parsedV4V.itemValues.get(episode.guid);

          // Only use item-level v4v data - don't fall back to channel level
          if (itemV4V) {
            // Format v4v data for database storage
            v4vData = {
              type: itemV4V.type,
              method: itemV4V.method,
              suggested: itemV4V.suggested,
              recipients: itemV4V.recipients.map((r: any) => ({
                name: r.name,
                type: r.type,
                address: r.address,
                split: r.split,
                customKey: r.customKey,
                customValue: r.customValue,
                fee: r.fee || false
              }))
            };
            // Extract lightning address from first recipient
            v4vRecipient = itemV4V.recipients[0]?.address || null;
            console.log(`✅ Found item-level v4v data from RSS for track "${episode.title}": ${itemV4V.recipients.length} recipients`);
          } else {
            console.log(`ℹ️ No item-level v4v data for track "${episode.title}" - will use channel-level at display time`);
          }
        }

        // Use season/episode for track order if available, otherwise use sequential order
        const trackOrderValue = episode.episode
          ? calculateTrackOrder(episode.episode, episode.season)
          : trackCount + 1;

        if (!existingTrack) {
          // Create new track with v4v data
          await prisma.track.create({
            data: {
              id: `${feed.id}-${episode.guid || `track-${trackCount}-${Date.now()}`}`,
              guid: episode.guid,
              title: episode.title,
              description: episode.description || null,
              audioUrl: episode.audioUrl || '',
              duration: parseDuration(episode.duration),
              image: preserveImageVersion(episode.image || feed.image || null, feed.image),
              publishedAt: episode.pubDate ? new Date(episode.pubDate) : new Date(),
              feedId: feed.id,
              trackOrder: trackOrderValue,
              ...(v4vData && { v4vValue: v4vData }),
              ...(v4vRecipient && { v4vRecipient }),
              ...(episode.chaptersUrl && { chaptersUrl: episode.chaptersUrl }),
              ...(episode.chapters && { chapters: episode.chapters }),
              updatedAt: new Date()
            }
          });
          trackCount++;
          newTracksCreated++;
        } else {
          // Update existing track with trackOrder and v4v data
          await prisma.track.update({
            where: { id: existingTrack.id },
            data: {
              trackOrder: trackOrderValue,
              ...(v4vData && !existingTrack.v4vValue && { v4vValue: v4vData }),
              ...(v4vRecipient && !existingTrack.v4vValue && { v4vRecipient }),
              updatedAt: new Date()
            }
          });
          if (v4vData && !existingTrack.v4vValue) {
            console.log(`🔄 Updated existing track "${episode.title}" with v4v data and trackOrder`);
          }
          trackCount++; // Count as processed for statistics
        }
      } catch (error) {
        console.warn(`⚠️ Failed to import track "${episode.title}":`, error instanceof Error ? error.message : error);
      }
    }

    // Update lastNewTrackAt when new tracks are added to an existing feed
    // (not on initial import — createdAt already captures that for "new" sorting)
    if (newTracksCreated > 0 && existingTrackCount > 0) {
      try {
        await prisma.feed.update({
          where: { id: feed.id },
          data: { lastNewTrackAt: new Date() }
        });
      } catch (e) {
        console.warn(`[lastNewTrackAt] write failed for ${feed.id} — migration may be pending:`, e instanceof Error ? e.message : e);
      }
    }

    // Release date for the grid + "Year" sort, from the tracks just imported
    await syncOldestItemPubdate(feed.id);

    return {
      feedId: feed.id,
      title: feedData.title || feed.title,
      trackCount,
      hadTracks: existingTrackCount > 0,
      newTracks: trackCount
    };

  } catch (error) {
    console.error(`❌ Error importing feed:`, error);
    return null;
  }
}

/**
 * Get episodes from Podcast Index API by feed ID
 */
export async function getEpisodesFromAPI(feedId: number): Promise<ParsedEpisode[] | null> {
  try {
    const headers = generateAuthHeaders();
    const episodesResponse = await fetch(`${API_BASE_URL}/episodes/byfeedid?id=${feedId}&max=1000`, { headers });

    if (!episodesResponse.ok) {
      return null;
    }

    const episodesData = await episodesResponse.json();
    if (episodesData.status !== 'true' || !episodesData.items || episodesData.items.length === 0) {
      return null;
    }

    // PI returns episodes newest-first; sort oldest-first so callers that
    // assign trackOrder = index + 1 (when ep.episode is null — PI doesn't
    // surface <podcast:episode> tags) get chronological album order instead
    // of a reversed one. Identical-timestamp items stay in PI's tie order;
    // the corrective for those is an admin reparse (RSS document order).
    const sortedItems = [...episodesData.items].sort(
      (a: any, b: any) => (a.datePublished || 0) - (b.datePublished || 0)
    );

    // Convert Podcast Index episodes to our format with v4v data
    const episodes: ParsedEpisode[] = sortedItems.map((ep: any) => ({
      title: ep.title,
      description: ep.description || '',
      guid: ep.guid,
      audioUrl: ep.enclosureUrl || '',
      image: ep.image || '',
      duration: ep.duration?.toString() || '0',
      pubDate: new Date(ep.datePublished * 1000).toUTCString(),
      v4vValue: ep.value, // Include v4v data from API
      episode: ep.episode || null, // Include episode number for track ordering
      chaptersUrl: ep.chaptersUrl || undefined
    }));

    // Fetch chapters for episodes that have chaptersUrl
    const withChapters = episodes.filter(ep => ep.chaptersUrl);
    if (withChapters.length > 0) {
      console.log(`📖 Fetching chapters for ${withChapters.length} episodes from PI API...`);
      await Promise.allSettled(
        withChapters.map(async (ep) => {
          const chapters = await fetchChapters(ep.chaptersUrl!);
          if (chapters) ep.chapters = chapters;
        })
      );
    }

    return episodes;
  } catch (error) {
    console.error('❌ Error getting episodes from Podcast Index API:', error);
    return null;
  }
}

/**
 * Parse a single feed by GUID
 * Looks up feed via Podcast Index, fetches episodes, and imports to database
 */
export async function parseFeedByGuid(feedGuid: string): Promise<ImportFeedResult | null> {
  try {
    // Check if feed exists in DB
    const existingFeed = await prisma.feed.findUnique({
      where: { id: feedGuid },
      select: { id: true, title: true, originalUrl: true }
    });

    if (!existingFeed) {
      console.log(`⚠️ Feed ${feedGuid} not found in database`);
      return null;
    }

    // Check existing track count (but still parse to add any new tracks)
    const existingTrackCount = await prisma.track.count({
      where: { feedId: feedGuid }
    });

    if (existingTrackCount > 0) {
      console.log(`ℹ️ Feed ${feedGuid} already has ${existingTrackCount} tracks, checking for new ones...`);
    }

    // Look up feed data from Podcast Index
    const feedData = await lookupFeedByGuid(feedGuid);

    let parseResult: ParseFeedResult | null = null;

    // Try Podcast Index API first
    if (feedData?.id) {
      console.log(`📡 Using Podcast Index API for feed ${feedData.id}`);
      const episodes = await getEpisodesFromAPI(feedData.id);
      if (episodes && episodes.length > 0) {
        console.log(`✅ Got ${episodes.length} episodes from Podcast Index API`);
        // Fetch RSS XML for feed-level V4V data (PI API has episode V4V but not channel-level)
        let xmlText = '';
        const rssUrl = feedData?.url || existingFeed.originalUrl;
        if (rssUrl) {
          try {
            const rssResponse = await fetch(rssUrl, { signal: AbortSignal.timeout(10000) });
            if (rssResponse.ok) {
              xmlText = await rssResponse.text();
            }
          } catch (xmlError) {
            console.warn(`⚠️ Could not fetch RSS XML for V4V: ${rssUrl}`);
          }
        }
        parseResult = { episodes, xmlText };
      }
    }

    // Fallback to RSS parsing
    const feedUrl = feedData?.url || existingFeed.originalUrl;
    if (!parseResult && feedUrl) {
      console.log(`⚠️ Falling back to RSS parsing for ${feedUrl}`);
      parseResult = await parseFeedXML(feedUrl);
    }

    if (!parseResult || !parseResult.episodes || parseResult.episodes.length === 0) {
      console.warn(`⚠️ No episodes found for feed ${feedGuid}`);
      return null;
    }

    // Import to database
    const importResult = await importFeedToDatabase(
      feedData || {
        id: feedGuid,
        title: existingFeed.title,
        url: feedUrl
      },
      parseResult.episodes,
      parseResult.xmlText
    );

    return importResult;
  } catch (error) {
    console.error(`❌ Error parsing feed ${feedGuid}:`, error);
    return null;
  }
}
