import { prisma } from '@/lib/prisma';
import { isValidFeedUrl, normalizeUrl } from '@/lib/url-utils';
import { generatePodcastIndexHeaders, normalizeFeedResponse, getFeedByUrlPreferNewest } from '@/lib/podcast-index-api';
import { parseFeedByGuid } from '@/lib/feed-parsing';
import { discoverAndStorePublisher } from '@/lib/publisher-discovery';
import { parsePublisherFeedFromXML } from '@/lib/rss-parser-db';
import { findPublisherFeed } from '@/lib/publisher-detector';
import { USER_AGENT } from './user-agent';

interface PodcastIndexResponse {
  status: string;
  feeds: Array<{
    id: number;
    podcastGuid: string;
    title: string;
    url: string;
    originalUrl: string;
    link: string;
    description: string;
    author: string;
    ownerName: string;
    image: string;
    artwork: string;
    lastUpdateTime: number;
    lastCrawlTime: number;
    lastParseTime: number;
    lastGoodHttpStatusTime: number;
    lastHttpStatus: number;
    contentType: string;
    itunesId: number;
    language: string;
    type: number;
    dead: number;
    crawlErrors: number;
    parseErrors: number;
    categories: Record<string, string>;
    locked: number;
    explicit: boolean;
    medium: string;
  }>;
  count: number;
  query: string;
  description: string;
}

export async function resolveFeedGuid(feedGuid: string): Promise<string | null> {
  try {
    console.log(`🔍 Resolving feed GUID: ${feedGuid}`);

    const headers = await generatePodcastIndexHeaders();

    // Use Podcast Index API to resolve GUID to feed URL
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers,
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      console.warn(`⚠️ Podcast Index API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();
    const feed = normalizeFeedResponse(data);

    if (feed) {
      console.log(`✅ Resolved feed GUID ${feedGuid} to: ${feed.title} - ${feed.url}`);
      return feed.url;
    } else {
      console.warn(`⚠️ No feed found for GUID: ${feedGuid}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error resolving feed GUID ${feedGuid}:`, error);
    return null;
  }
}

// New function that returns full feed metadata including medium for type determination
export async function resolveFeedGuidWithMetadata(feedGuid: string): Promise<{ url: string; title: string; artist: string; image: string | null; medium: string; oldestItemPubdate: number | null; declaredMedium: string | null } | null> {
  try {
    console.log(`🔍 Resolving feed GUID with metadata: ${feedGuid}`);

    const headers = await generatePodcastIndexHeaders();

    // Use Podcast Index API to resolve GUID to feed metadata
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers,
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      console.warn(`⚠️ Podcast Index API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: any = await response.json();
    const feed = normalizeFeedResponse(data);

    if (feed && feed.url) {
      let finalFeed = feed;

      // For behindthesch3m3s.com feeds, always check for newer Podcast Index entries
      // This handles cases where feeds were re-indexed with different URLs (URL encoding)
      if (feed.url.includes('behindthesch3m3s.com')) {
        try {
          const newestFeed = await getFeedByUrlPreferNewest(feed.url);

          if (newestFeed && newestFeed.id !== feed.id) {
            console.log(`🔄 Using newer Podcast Index entry for ${feed.title}: ID ${newestFeed.id} vs ${feed.id}`);
            finalFeed = newestFeed;
          }
        } catch (error) {
          console.warn(`⚠️ Could not check for newer feed entry: ${error}`);
        }
      }

      console.log(`✅ Resolved feed GUID ${feedGuid} to: ${finalFeed.title} - ${finalFeed.url}`);
      return {
        url: finalFeed.url,
        title: finalFeed.title || 'Unknown Feed',
        artist: finalFeed.author || finalFeed.ownerName || 'Unknown Artist',
        image: finalFeed.artwork || finalFeed.image || null,
        medium: finalFeed.medium || 'music',
        // The same value without the default, for `Feed.medium`. `medium` above falls back
        // to 'music' to pick a `type`, which is a fine guess for a local classification and
        // a bad one to publish: the shared favorites list carries this to other apps, where
        // a wrong value is sticky. Empty stays empty.
        declaredMedium: finalFeed.medium?.toLowerCase() || null,
        oldestItemPubdate: finalFeed.oldestItemPubdate || null
      };
    } else {
      if (feed && !feed.url) {
        console.warn(`⚠️ Feed found but missing URL for GUID: ${feedGuid}`);
      } else {
        console.warn(`⚠️ No feed found for GUID: ${feedGuid}`);
      }
      return null;
    }
  } catch (error) {
    console.error(`❌ Error resolving feed GUID ${feedGuid}:`, error);
    return null;
  }
}

export async function addUnresolvedFeeds(feedGuids: string[]): Promise<number> {
  let addedCount = 0;

  for (const feedGuid of feedGuids) {
    try {
      // Check if feed already exists by ID or guid column
      const existingById = await prisma.feed.findUnique({
        where: { id: feedGuid },
        select: { id: true }
      });

      if (existingById) {
        continue;
      }

      const existingByGuid = await prisma.feed.findUnique({
        where: { guid: feedGuid },
        select: { id: true }
      });

      if (existingByGuid) {
        continue;
      }

      // Try to resolve the GUID to get full feed metadata
      const resolvedFeed = await resolveFeedGuidWithMetadata(feedGuid);

      if (resolvedFeed) {
        // Validate URL before storing
        if (!isValidFeedUrl(resolvedFeed.url)) {
          console.warn(`⚠️ Invalid feed URL for ${feedGuid}: ${resolvedFeed.url}`);
          continue;
        }

        const normalizedUrl = normalizeUrl(resolvedFeed.url);

        // Check if URL already exists with a different ID
        const existingByUrl = await prisma.feed.findFirst({
          where: { originalUrl: normalizedUrl },
          select: { id: true, title: true }
        });

        if (existingByUrl) {
          console.log(`⚡ Feed URL already exists as "${existingByUrl.title}" (ID: ${existingByUrl.id}), skipping GUID ${feedGuid}`);
          continue;
        }

        // Use upsert to atomically create or update (prevents race conditions)
        const upsertResult = await prisma.feed.upsert({
          where: { id: feedGuid },
          create: {
            id: feedGuid, // Use the podcast GUID so parse-feeds can look it up
            title: resolvedFeed.title,
            description: `Auto-discovered from playlist`,
            originalUrl: normalizedUrl,
            type: resolvedFeed.medium === 'music' ? 'album' : 'podcast',
            medium: resolvedFeed.declaredMedium,
            priority: 'normal',
            status: 'active',
            artist: resolvedFeed.artist,
            image: resolvedFeed.image,
            oldestItemPubdate: resolvedFeed.oldestItemPubdate ? new Date(resolvedFeed.oldestItemPubdate * 1000) : null,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          update: {
            // Feed already exists - just update metadata if needed
            updatedAt: new Date()
          },
          select: { id: true, createdAt: true, updatedAt: true }
        });

        // Check if this was a new creation (createdAt equals updatedAt within 1 second)
        const wasCreated = Math.abs(upsertResult.createdAt.getTime() - upsertResult.updatedAt.getTime()) < 1000;

        if (!wasCreated) {
          console.log(`⚡ Feed already existed (race condition avoided): ${feedGuid}`);
          continue;
        }

        console.log(`✅ Added resolved feed: ${resolvedFeed.title} by ${resolvedFeed.artist}`);

        addedCount++;
      } else {
        // Could not resolve - skip this feed (don't create placeholder)
        console.warn(`⚠️ Skipping feed GUID ${feedGuid} - could not resolve via Podcast Index API`);
      }
    } catch (error) {
      console.error(`❌ Error processing feed GUID ${feedGuid}:`, error);
    }
  }
  
  return addedCount;
}

export async function resolveItemGuid(feedGuid: string, itemGuid: string): Promise<any | null> {
  try {
    console.log(`🔍 Resolving item GUID: ${itemGuid} from feed: ${feedGuid}`);

    const headers = await generatePodcastIndexHeaders();

    // Approach 1: Try to resolve via feed GUID first
    console.log(`📡 Approach 1: Feed-based lookup`);
    const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers,
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (feedResponse.ok) {
      const feedData = await feedResponse.json();
      const feed = normalizeFeedResponse(feedData);

      if (feed && feed.id) {
        const feedId = feed.id;
        const feedTitle = feed.title;
        console.log(`✅ Found feed: ${feedTitle} (ID: ${feedId})`);

        // Get episodes from this feed (limit to 1000 to match individual playlist routes)
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feedId}&max=1000`, {
          headers,
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();
          if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
            console.log(`📊 Found ${episodesData.items.length} episodes in feed`);
            
            // Find the specific episode by GUID
            const episode = episodesData.items.find((ep: any) => ep.guid === itemGuid);
            if (episode) {
              console.log(`✅ Found episode via feed lookup: ${episode.title}`);
              return {
                guid: episode.guid,
                title: episode.title,
                description: episode.description || '',
                audioUrl: episode.enclosureUrl || '',
                duration: episode.duration || 0,
                image: episode.image || feed.image || '/placeholder-podcast.jpg',
                publishedAt: new Date(episode.datePublished * 1000),
                feedGuid: feedGuid,
                feedTitle: feedTitle,
                feedImage: feed.image
              };
            }
          }
        }
      }
    }
    
    // Approach 2: Direct episode GUID lookup as fallback
    console.log(`📡 Approach 2: Direct episode GUID lookup`);
    const episodeResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${encodeURIComponent(itemGuid)}`, {
      headers,
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (episodeResponse.ok) {
      const episodeData = await episodeResponse.json();
      if (episodeData.status === 'true' && episodeData.episode) {
        const episode = episodeData.episode;
        console.log(`✅ Found episode via direct GUID lookup: ${episode.title}`);
        return {
          guid: episode.guid,
          title: episode.title,
          description: episode.description || '',
          audioUrl: episode.enclosureUrl || '',
          duration: episode.duration || 0,
          image: episode.image || '/placeholder-podcast.jpg',
          publishedAt: new Date(episode.datePublished * 1000),
          feedGuid: episode.feedGuid || feedGuid,
          feedTitle: episode.feedTitle || 'Unknown Feed',
          feedImage: episode.feedImage
        };
      }
    }
    
    console.log(`❌ Could not resolve ${itemGuid} via any method`);
    return null;
  } catch (error) {
    console.error(`❌ Error resolving item GUID ${itemGuid}:`, error);
    return null;
  }
}

export async function processPlaylistFeedDiscovery(remoteItems: Array<{ feedGuid: string; itemGuid: string }>): Promise<number> {
  // Get unique feed GUIDs from the playlist
  const uniqueFeedGuids = [...new Set(remoteItems.map(item => item.feedGuid))];

  console.log(`🔍 Processing ${uniqueFeedGuids.length} unique feed GUIDs for auto-discovery...`);

  // Add unresolved feeds to the database
  const addedCount = await addUnresolvedFeeds(uniqueFeedGuids);

  console.log(`✅ Feed discovery complete: ${addedCount} new feeds added to database`);

  return addedCount;
}

/**
 * Find feeds that exist in the database but have no tracks (unparsed)
 */
export async function findUnparsedFeeds(feedGuids: string[]): Promise<string[]> {
  if (feedGuids.length === 0) return [];

  // Get feeds that exist but have no tracks
  const feedsWithTrackCounts = await prisma.feed.findMany({
    where: {
      id: { in: feedGuids },
      status: 'active'
    },
    select: {
      id: true,
      _count: {
        select: { Track: true }
      }
    }
  });

  // Return feed IDs that have zero tracks
  return feedsWithTrackCounts
    .filter(f => f._count.Track === 0)
    .map(f => f.id);
}

/**
 * Parse playlist feeds immediately
 * Takes a list of feed GUIDs, parses them via Podcast Index API,
 * and imports all tracks to the database.
 *
 * @returns Array of parsed feed IDs (for use in publisher discovery)
 */
export async function parsePlaylistFeeds(feedGuids: string[]): Promise<string[]> {
  if (feedGuids.length === 0) return [];

  console.log(`📥 Parsing ${feedGuids.length} feeds immediately...`);

  const parsedFeedIds: string[] = [];
  let totalTracks = 0;

  for (const feedGuid of feedGuids) {
    try {
      const result = await parseFeedByGuid(feedGuid);

      if (result) {
        parsedFeedIds.push(result.feedId);
        totalTracks += result.newTracks;
        console.log(`✅ Parsed feed "${result.title}": ${result.newTracks} tracks`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error parsing feed ${feedGuid}:`, error);
    }
  }

  console.log(`📊 Parsing complete: ${parsedFeedIds.length} feeds, ${totalTracks} total tracks`);

  return parsedFeedIds;
}

/**
 * Discover and parse publisher feeds for newly added albums
 * Checks each album's XML for publisher references and adds/links them.
 */
export async function discoverAndParsePublishers(albumFeedIds: string[]): Promise<{ discovered: number; linked: number }> {
  if (albumFeedIds.length === 0) return { discovered: 0, linked: 0 };

  console.log(`🔍 Discovering publishers for ${albumFeedIds.length} albums...`);

  let discovered = 0;
  let linked = 0;

  // Get album feeds with their URLs
  const albums = await prisma.feed.findMany({
    where: {
      id: { in: albumFeedIds },
      type: { in: ['album', 'music'] }
    },
    select: {
      id: true,
      title: true,
      originalUrl: true,
      publisherId: true,
      artist: true
    }
  });

  // Track artists already searched via PI API to avoid redundant calls
  const searchedArtists = new Set<string>();

  for (const album of albums) {
    // Skip if already linked to a publisher
    if (album.publisherId) {
      console.log(`⚡ Album "${album.title}" already linked to publisher`);
      continue;
    }

    if (!album.originalUrl) {
      console.log(`⚠️ Album "${album.title}" has no URL, skipping publisher discovery`);
      continue;
    }

    try {
      // Fetch album feed XML
      const response = await fetch(album.originalUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        console.warn(`⚠️ Failed to fetch album feed ${album.title}: ${response.status}`);
        continue;
      }

      const xml = await response.text();

      // Check for publisher reference
      const publisherRef = parsePublisherFeedFromXML(xml);

      if (publisherRef) {
        // Discover and store the publisher
        const wasAdded = await discoverAndStorePublisher(publisherRef);

        if (wasAdded) {
          discovered++;
        }

        // Link the album to the publisher
        const publisherId = publisherRef.feedGuid || '';
        if (publisherId) {
          // Find publisher by GUID or URL
          const publisher = await prisma.feed.findFirst({
            where: {
              OR: [
                { id: publisherId },
                { originalUrl: publisherRef.feedUrl }
              ],
              type: 'publisher'
            },
            select: { id: true }
          });

          if (publisher) {
            await prisma.feed.update({
              where: { id: album.id },
              data: { publisherId: publisher.id }
            });
            linked++;
            console.log(`🔗 Linked album "${album.title}" to publisher`);
          }
        }
      } else if (album.artist) {
        // Fallback: search Podcast Index API by artist name
        const artistKey = album.artist.toLowerCase();
        if (!searchedArtists.has(artistKey)) {
          searchedArtists.add(artistKey);
          const piResult = await findPublisherFeed(album.artist);
          if (piResult.found && piResult.feedUrl) {
            const normalizedUrl = normalizeUrl(piResult.feedUrl);
            const wasAdded = await discoverAndStorePublisher({
              feedGuid: piResult.guid || '',
              feedUrl: normalizedUrl,
              medium: 'publisher'
            });
            if (wasAdded) discovered++;
          }
        }

        // Try to link album to publisher (may have been found for a previous album by same artist)
        if (album.artist) {
          const publisher = await prisma.feed.findFirst({
            where: {
              type: 'publisher',
              artist: { equals: album.artist, mode: 'insensitive' }
            },
            select: { id: true }
          });

          if (publisher) {
            await prisma.feed.update({
              where: { id: album.id },
              data: { publisherId: publisher.id }
            });
            linked++;
            console.log(`🔗 Linked album "${album.title}" to publisher via PI API`);
          }
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error discovering publisher for "${album.title}":`, error);
    }
  }

  console.log(`📊 Publisher discovery complete: ${discovered} new, ${linked} linked`);

  return { discovered, linked };
}