import { Metadata } from 'next';
import PublisherDetailClient from './PublisherDetailClient';
import { getPublisherInfo, generateAlbumSlug } from '@/lib/url-utils';
import { USER_AGENT } from '@/lib/user-agent';
import { prisma } from '@/lib/prisma';
import { isBlacklistedFeedId, isBlacklistedFeedUrl, isHenrikFlymanWavlakeMirror } from '@/lib/feed-exclusions';
import { isListMedium } from '@/lib/playlist/musicl-feed';

// Blacklisted feeds (e.g. Henrik Flyman's dead Wavlake mirrors — he self-hosts
// at henrikflyman.com now) are banned from import/grid/search, but the publisher
// page queries the DB directly. Without this filter, any lingering blacklisted
// feed rows still surface here via remoteItem, publisherId, or artist-name
// matching. Keep display in sync with the "banned everywhere" intent.
//
// Also drops Henrik Flyman's ever-growing set of Wavlake mirror feeds via the
// artist-scoped rule, since new ones appear faster than we can blacklist URLs.
function isNotBlacklistedFeed(feed: { id: string; originalUrl?: string | null; artist?: string | null }): boolean {
  if (isBlacklistedFeedId(feed.id)) return false;
  if (feed.originalUrl && isBlacklistedFeedUrl(feed.originalUrl)) return false;
  if (isHenrikFlymanWavlakeMirror({ artist: feed.artist, feedUrl: feed.originalUrl })) return false;
  return true;
}

// Force dynamic rendering to always fetch fresh publisher data from database
export const dynamic = 'force-dynamic';

function getPlatformName(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('wavlake')) return 'Wavlake';
    if (hostname.includes('fountain')) return 'Fountain.fm';
    if (hostname.includes('rssblue')) return 'RSS Blue';
    if (hostname.includes('rss.com')) return 'RSS.com';
    // Fallback: use the hostname (e.g., "frankieperoni.com")
    return hostname.replace(/^(www|feeds?)\./, '');
  } catch { return 'Feed'; }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const publisherId = decodeURIComponent(id);
  
  // Get publisher info to show proper name in title
  const publisherInfo = getPublisherInfo(publisherId);
  const publisherName = publisherInfo?.name || publisherId;
  
  return {
    title: `${publisherName} | stablekraft.app`,
    description: `View all albums from ${publisherName}`,
  };
}

async function loadPublisherData(publisherId: string) {
  // First, try to resolve human-readable slug to actual feedGuid
  const publisherInfo = getPublisherInfo(publisherId);
  const actualFeedGuid = publisherInfo?.feedGuid || publisherId;
  
  try {
    console.log(`🏢 Server-side: Looking for publisher: ${publisherId}`);
    console.log(`🏢 Server-side: publisherInfo.feedGuid:`, publisherInfo?.feedGuid);

    // Build a more targeted query instead of loading all publisher feeds
    let publisherFeed = null;
    
    // First, try direct ID match (the publisherId might be the actual feed ID)
    // Try with status first, then without status requirement
    // Include both 'publisher' and 'test' types (test feeds function as publishers)
    publisherFeed = await prisma.feed.findFirst({
      where: {
        type: { in: ['publisher', 'test'] },
        status: 'active',
        id: publisherId
      }
    });

    // If not found, try without status requirement
    if (!publisherFeed) {
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['publisher', 'test'] },
          id: publisherId
        }
      });
    }

    // Also try ID contains match (e.g., "podtards-test" matches "test-music-feed-podtards")
    if (!publisherFeed) {
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['publisher', 'test'] },
          id: { contains: publisherId, mode: 'insensitive' }
        }
      });
    }
    
    // If not found, try matching by originalUrl from publisherInfo
    if (!publisherFeed && publisherInfo?.feedUrl) {
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['publisher', 'test'] },
          originalUrl: publisherInfo.feedUrl
        }
      });
    }
    
    // If not found, try to find by feedGuid if we have it
    if (!publisherFeed && publisherInfo?.feedGuid) {
      const feedGuidParts = publisherInfo.feedGuid.split('-');
      const feedGuidPrefix = feedGuidParts[0];
      
      // Try direct match first (with status)
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['publisher', 'test'] },
          status: 'active',
          id: publisherInfo.feedGuid
        }
      });

      // If not found, try without status
      if (!publisherFeed) {
        publisherFeed = await prisma.feed.findFirst({
          where: {
            type: { in: ['publisher', 'test'] },
            id: publisherInfo.feedGuid
          }
        });
      }

      // If not found, try prefix match (for IDs like wavlake-publisher-93fbacab)
      if (!publisherFeed && feedGuidPrefix) {
        publisherFeed = await prisma.feed.findFirst({
          where: {
            type: { in: ['publisher', 'test'] },
            status: 'active',
            id: { contains: feedGuidPrefix }
          }
        });

        // If still not found, try without status
        if (!publisherFeed) {
          publisherFeed = await prisma.feed.findFirst({
            where: {
              type: { in: ['publisher', 'test'] },
              id: { contains: feedGuidPrefix }
            }
          });
        }
      }
    }
    
    // If still not found, try by title or artist match (handle URL slugs)
    if (!publisherFeed) {
      let searchId = publisherId.toLowerCase();
      // Strip common suffixes like "-publisher" for matching
      const normalizedSearchId = searchId.replace(/-publisher$/, '');
      const possibleTitles = [
        searchId, // Direct match (e.g., "ollie-publisher")
        normalizedSearchId, // Without suffix (e.g., "ollie")
        searchId.replace(/-/g, ' '), // Convert hyphens to spaces (e.g., "ollie publisher")
        normalizedSearchId.replace(/-/g, ' '), // Normalized with spaces (e.g., "ollie")
      ];
      
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['publisher', 'test'] },
          status: 'active',
          OR: [
            { title: { equals: possibleTitles[0], mode: 'insensitive' } },
            { title: { equals: possibleTitles[1], mode: 'insensitive' } },
            { title: { equals: possibleTitles[2], mode: 'insensitive' } },
            { title: { equals: possibleTitles[3], mode: 'insensitive' } },
            { artist: { equals: possibleTitles[0], mode: 'insensitive' } },
            { artist: { equals: possibleTitles[1], mode: 'insensitive' } },
            { artist: { equals: possibleTitles[2], mode: 'insensitive' } },
            { artist: { equals: possibleTitles[3], mode: 'insensitive' } },
          ]
        }
      });
    }

    // Also try matching by slug if title doesn't match
    if (!publisherFeed) {
      let searchId = publisherId.toLowerCase();
      // Strip common suffixes like "-publisher" for matching
      const normalizedSearchId = searchId.replace(/-publisher$/, '');

      // Convert any publisher feed title or artist to slug format and compare
      // Try with status first, then without status requirement
      let allPublishers = await prisma.feed.findMany({
        where: {
          type: { in: ['publisher', 'test'] },
          status: 'active'
        },
        select: {
          id: true,
          title: true,
          artist: true,
          description: true,
          image: true,
          originalUrl: true
        }
      });

      // If no active publishers found, try without status requirement
      if (allPublishers.length === 0) {
        allPublishers = await prisma.feed.findMany({
          where: {
            type: { in: ['publisher', 'test'] }
          },
          select: {
            id: true,
            title: true,
            artist: true,
            description: true,
            image: true,
            originalUrl: true
          }
        });
      }
      
      console.log(`🔍 Found ${allPublishers.length} publisher feeds in database`);
      console.log(`🔍 Searching for publisher with slug: "${searchId}" (normalized: "${normalizedSearchId}")`);
      
      // Log first few publishers for debugging
      if (allPublishers.length > 0) {
        console.log(`📋 Sample publishers (first 5):`);
        allPublishers.slice(0, 5).forEach((feed, idx) => {
          const titleSlug = feed.title?.toLowerCase().replace(/\s+/g, '-') || 'no-title';
          const artistSlug = feed.artist?.toLowerCase().replace(/\s+/g, '-') || 'no-artist';
          console.log(`  ${idx + 1}. id="${feed.id}", title="${feed.title}", artist="${feed.artist}"`);
          console.log(`     title-slug="${titleSlug}", artist-slug="${artistSlug}"`);
        });
      }
      
      publisherFeed = allPublishers.find((feed) => {
        // Try matching by ID first (in case the searchId is the actual feed ID)
        if (feed.id === searchId || feed.id === publisherId) {
          console.log(`✅ Matched publisher by ID: "${feed.id}"`);
          return true;
        }

        // Try matching by title slug (with and without -publisher suffix)
        // Use generateAlbumSlug for consistent slug generation (handles periods, special chars, etc.)
        if (feed.title) {
          const titleToSlug = generateAlbumSlug(feed.title);
          if (titleToSlug === searchId || titleToSlug === normalizedSearchId) {
            console.log(`✅ Matched publisher by title slug: "${feed.title}" -> "${titleToSlug}"`);
            return true;
          }
        }

        // Try matching by artist slug (with and without -publisher suffix)
        // Use generateAlbumSlug for consistent slug generation
        if (feed.artist) {
          const artistToSlug = generateAlbumSlug(feed.artist);
          if (artistToSlug === searchId || artistToSlug === normalizedSearchId) {
            console.log(`✅ Matched publisher by artist slug: "${feed.artist}" -> "${artistToSlug}"`);
            return true;
          }
        }

        // Try matching by URL path (e.g., /setto/ in the URL matches "setto")
        if (feed.originalUrl) {
          try {
            const urlPath = new URL(feed.originalUrl).pathname.toLowerCase();
            if (urlPath.includes(`/${searchId}/`) || urlPath.startsWith(`/${searchId}`)) {
              console.log(`✅ Matched publisher by URL path: "${feed.originalUrl}" contains "/${searchId}/"`);
              return true;
            }
          } catch {
            // Invalid URL, skip
          }
        }

        return false;
      });
      
      if (!publisherFeed) {
        console.log(`❌ No publisher feed matched slug "${searchId}"`);
      }
    }
    
    // If no publisher feed found, try to find albums by artist name and create publisher info from them
    // Supports both KNOWN_PUBLISHERS mapping and dynamic discovery from URL slug
    let artistName: string | null = null;

    if (!publisherFeed) {
      const publisherInfo = getPublisherInfo(publisherId);

      // Determine artist search name: use known mapping or infer from URL slug
      let artistSearchName: string | null = null;
      let feedUrl: string | null = null;

      if (publisherInfo?.name) {
        // Use known publisher mapping
        artistSearchName = publisherInfo.name;
        feedUrl = publisherInfo.feedUrl || null;
        console.log(`⚠️ No publisher feed found for "${publisherId}", but we have a mapping to "${publisherInfo.name}"`);
      } else {
        // NEW: Infer artist name from the URL slug (e.g., "liv-faith" → "Liv Faith")
        artistSearchName = publisherId
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        console.log(`⚠️ No publisher feed found for "${publisherId}", inferring artist name: "${artistSearchName}"`);
      }

      // Generate alternate artist names to search for
      // Handle common URL transformations: "and" → "&", "plus" → "+", "at" → "@"
      const artistSearchVariants = [artistSearchName];
      if (artistSearchName) {
        // Try with & instead of And (case insensitive)
        const withAmpersand = artistSearchName.replace(/\bAnd\b/gi, '&');
        if (withAmpersand !== artistSearchName) {
          artistSearchVariants.push(withAmpersand);
        }
        // Try with + instead of Plus
        const withPlus = artistSearchName.replace(/\bPlus\b/gi, '+');
        if (withPlus !== artistSearchName) {
          artistSearchVariants.push(withPlus);
        }
      }
      console.log(`🔍 Artist search variants: ${artistSearchVariants.join(', ')}`);

      // Find the first album feed with exact artist match (try all variants)
      let firstAlbumFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['album', 'music', 'podcast'] },
          status: 'active',
          markedDead: false,
          blocked: false,
          OR: artistSearchVariants.map(variant => ({
            artist: { equals: variant, mode: 'insensitive' as const }
          }))
        },
        select: {
          id: true,
          title: true,
          artist: true,
          description: true,
          image: true,
          originalUrl: true
        }
      });

      // If no exact match, try finding albums by ID pattern (handles special chars like "$2 Holla" → "2-holla")
      if (!firstAlbumFeed) {
        console.log(`🔍 No exact artist match, trying ID pattern match for "${publisherId}"`);
        firstAlbumFeed = await prisma.feed.findFirst({
          where: {
            type: { in: ['album', 'music', 'podcast'] },
            status: 'active',
            markedDead: false,
            blocked: false,
            id: { startsWith: `-${publisherId}`, mode: 'insensitive' } // Match IDs like "-2-holla-album-name"
          },
          select: {
            id: true,
            title: true,
            artist: true,
            description: true,
            image: true,
            originalUrl: true
          }
        });

        // If found, use the actual artist name from the album
        if (firstAlbumFeed?.artist) {
          artistSearchName = firstAlbumFeed.artist;
          console.log(`✅ Found album via ID pattern, using artist: "${artistSearchName}"`);
        }
      }

      if (firstAlbumFeed) {
        // Use the actual artist name from the database (e.g., "Lies & Sets" not "Lies And Sets")
        artistName = firstAlbumFeed.artist || artistSearchName;
        console.log(`✅ Found albums by artist: "${artistName}"`);

        // Create a synthetic publisher feed from the first album
        // NOTE: Don't set image here - we'll fetch it from the actual feed XML below
        publisherFeed = {
          id: `publisher-${publisherId}`,
          title: artistName || publisherId,
          artist: artistName || null,
          description: `Albums by ${artistName || publisherId}`,
          image: null, // Will be populated from feed XML fetch below
          originalUrl: feedUrl || '',
          type: 'publisher' as any,
          status: 'active' as any,
          createdAt: new Date(),
          updatedAt: new Date()
        } as any;

        console.log(`📝 Created synthetic publisher feed for "${artistName}"`);
      } else {
        console.log(`❌ No albums found for artist "${artistSearchName}"`);
        return null;
      }
    } else {
      console.log(`✅ Publisher found: ${publisherFeed.title || publisherFeed.id}`);
      artistName = publisherFeed.artist || publisherFeed.title;
    }

    // Henrik Flyman self-hosts everything at henrikflyman.com and pulled ALL his
    // music off Wavlake. On his publisher page ONLY, hide every wavlake.com feed
    // regardless of its stored artist string — mirrors sometimes carry a slightly
    // different or empty artist, so the artist-scoped blacklist rule can miss
    // them. This is page-scoped: no other artist's cross-platform Wavlake albums
    // are affected (see the cross-platform warning at the top of this section).
    const normalizedArtistName = (artistName || '').toLowerCase().trim();
    const isHenrikFlymanPage =
      normalizedArtistName === 'henrik flyman' ||
      publisherId.toLowerCase() === 'henrik-flyman';

    // Combined per-feed filter for every album source on this page.
    const keepFeed = (feed: { id: string; originalUrl?: string | null; artist?: string | null }): boolean => {
      if (!isNotBlacklistedFeed(feed)) return false;
      if (isHenrikFlymanPage && (feed.originalUrl || '').toLowerCase().includes('wavlake.com')) return false;
      return true;
    };

    // Find ALL publisher feeds for this artist (supports multiple publisher feeds per artist)
    let allPublisherFeeds = [publisherFeed];
    if (artistName) {
      const artistVariantsForPub = [artistName];
      const ampVariant = artistName.replace(/\bAnd\b/gi, '&');
      if (ampVariant !== artistName) artistVariantsForPub.push(ampVariant);
      const plusVariant = artistName.replace(/\bPlus\b/gi, '+');
      if (plusVariant !== artistName) artistVariantsForPub.push(plusVariant);

      const additionalPubFeeds = await prisma.feed.findMany({
        where: {
          type: { in: ['publisher', 'test'] },
          id: { not: publisherFeed.id },
          OR: [
            ...artistVariantsForPub.map(v => ({ artist: { equals: v, mode: 'insensitive' as const } })),
            ...artistVariantsForPub.map(v => ({ title: { equals: v, mode: 'insensitive' as const } })),
          ]
        }
      });

      if (additionalPubFeeds.length > 0) {
        console.log(`🏢 Found ${additionalPubFeeds.length} additional publisher feed(s) for "${artistName}"`);
        allPublisherFeeds = [publisherFeed, ...additionalPubFeeds];
      }
    }

    // Fetch and parse ALL publisher feeds to get remote items and artwork
    let remoteItemGuids: string[] = [];
    let remoteItemUrls: string[] = []; // Also collect feedUrls for matching
    let podrollGuids = new Set<string>(); // Blocklist: never show these in Official Releases
    let podrollUrls = new Set<string>();
    let feedImage: string | null = publisherFeed.image || null;

    // Track which publisher feed each GUID/URL came from (for per-feed sections)
    const guidToSourceFeed = new Map<string, typeof publisherFeed>();
    const urlToSourceFeed = new Map<string, typeof publisherFeed>();

    for (const pubFeed of allPublisherFeeds) {
      if (!pubFeed.originalUrl || pubFeed.originalUrl.trim() === '') continue;

      try {
        console.log(`📡 Fetching publisher feed XML to extract remote items: ${pubFeed.originalUrl}`);
        const feedResponse = await fetch(pubFeed.originalUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(10000), // 10 second timeout (increased from 5)
        });

        if (feedResponse.ok) {
          const xmlText = await feedResponse.text();

          // Build podroll blocklist from raw XML (defense in depth: exclude even if regex edge case)
          const podrollMatch = xmlText.match(/<podcast:podroll>([\s\S]*?)<\/podcast:podroll>/gi);
          if (podrollMatch && podrollMatch[0]) {
            const podrollBlock = podrollMatch[0];
            const podrollItemRegex = /<podcast:remoteItem[^>]*>/gi;
            const podrollItems = podrollBlock.match(podrollItemRegex) || [];
            for (const m of podrollItems) {
              const g = m.match(/feedGuid=["']([^"']+)["']/i);
              const u = m.match(/feedUrl=["']([^"']+)["']/i);
              if (g?.[1]) podrollGuids.add(g[1]);
              if (u?.[1]) podrollUrls.add(u[1]);
            }
            if (podrollGuids.size > 0 || podrollUrls.size > 0) {
              console.log(`📋 Podroll blocklist: ${podrollGuids.size} GUIDs, ${podrollUrls.size} URLs (excluded from Official Releases)`);
            }
          }

          // Extract artwork/image from PRIMARY publisher feed only (prioritize feed over database)
          if (pubFeed.id === publisherFeed.id) {
            const itunesImageMatch = xmlText.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
            if (itunesImageMatch && itunesImageMatch[1]) {
              feedImage = itunesImageMatch[1].trim();
              console.log(`🎨 Found iTunes image in feed: ${feedImage}`);
            } else {
              const imageMatch = xmlText.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i);
              if (imageMatch && imageMatch[1]) {
                feedImage = imageMatch[1].trim();
                console.log(`🎨 Found image in feed: ${feedImage}`);
              } else {
                console.warn(`⚠️ No image found in publisher feed XML`);
              }
            }
          }

          // Extract podcast:remoteItem tags (for music/album feeds, not publisher references)
          // First, remove podroll section to avoid including related feeds as albums
          const xmlWithoutPodroll = xmlText.replace(/<podcast:podroll>[\s\S]*?<\/podcast:podroll>/gi, '');

          const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
          const matches = xmlWithoutPodroll.match(remoteItemRegex) || [];

          for (const match of matches) {
            const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
            const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
            const mediumMatch = match.match(/medium="([^"]+)"/);

            const medium = mediumMatch?.[1] || 'music';

            // Only collect album/music remote items, not publisher references,
            // and not playlists (musicL and the other list mediums, #309).
            if (medium === 'publisher' || isListMedium(medium)) {
              continue;
            }

            // Skip items that look like publisher feeds or playlist feeds (not albums)
            if (feedUrlMatch?.[1]) {
              const url = feedUrlMatch[1].toLowerCase();
              if (url.includes('-pubfeed.xml') || url.endsWith('/feed.xml')) {
                console.log(`⏭️ Skipping non-album feed: ${url}`);
                continue;
              }
            }

            // Collect album/music remote items
            if (feedGuidMatch && feedGuidMatch[1]) {
              const guid = feedGuidMatch[1];

              const isAlbumFeed = feedUrlMatch && (
                feedUrlMatch[1].includes('/feed/music/') ||
                (feedUrlMatch[1].includes('/feed/') && !feedUrlMatch[1].includes('/feed/artist/')) ||
                medium === 'music' ||
                !mediumMatch
              );

              const isExplicitAlbum = medium === 'music' || medium === 'album';

              if ((isAlbumFeed || isExplicitAlbum) && !remoteItemGuids.includes(guid)) {
                remoteItemGuids.push(guid);
                guidToSourceFeed.set(guid, pubFeed);
                if (feedUrlMatch && feedUrlMatch[1] && !remoteItemUrls.includes(feedUrlMatch[1])) {
                  remoteItemUrls.push(feedUrlMatch[1]);
                  urlToSourceFeed.set(feedUrlMatch[1], pubFeed);
                }
                console.log(`📋 Added remote item GUID: ${guid} (medium: ${medium}, url: ${feedUrlMatch?.[1]})`);
              }
            }
          }

          console.log(`📋 Running total: ${remoteItemGuids.length} album remote items, ${remoteItemUrls.length} URLs after parsing ${pubFeed.originalUrl}`);
        }
      } catch (error) {
        console.warn(`⚠️ Could not fetch publisher feed XML (${pubFeed.originalUrl}):`, error);
        // Continue with other feeds / artist-based matching as fallback
      }
    }
    
    // Get related albums for this publisher - try remote items first, then fall back to artist matching
    let relatedFeeds: any[] = [];

    // If we have remote items, find feeds by their GUIDs or URLs
    if (remoteItemGuids.length > 0 || remoteItemUrls.length > 0) {
      console.log(`🔍 Looking for albums by ${remoteItemGuids.length} GUIDs and ${remoteItemUrls.length} URLs...`);

      // Create OR conditions for each GUID (match by ID, guid column, or URL)
      const guidConditions = remoteItemGuids.map(guid => ({
        OR: [
          { id: { equals: guid } },
          { guid: { equals: guid } }, // Match the podcast GUID column (most reliable for Wavlake)
          { id: { contains: guid.split('-')[0] } }, // Try partial match
          { originalUrl: { contains: guid } }, // Match GUID in URL
          { originalUrl: { contains: guid.replace(/-/g, '') } } // Match without hyphens
        ]
      }));

      // Also match by feedUrl directly (most reliable for fountain feeds)
      const urlConditions = remoteItemUrls.map(url => ({
        originalUrl: { equals: url }
      }));

      // Combine all conditions
      const allConditions = [...guidConditions, ...urlConditions];
      
      relatedFeeds = await prisma.feed.findMany({
        where: {
          OR: allConditions,
          type: { in: ['album', 'music', 'podcast'] },
          status: 'active',
          markedDead: false,
          blocked: false
        },
          select: {
            id: true,
            title: true,
            artist: true,
            description: true,
            image: true,
            lastFetched: true,
            oldestItemPubdate: true,
            createdAt: true,
            originalUrl: true,
            Track: {
              where: {
                audioUrl: { not: '' }
              },
              orderBy: [
                { trackOrder: 'asc' },
                { publishedAt: 'asc' },
                { createdAt: 'asc' }
              ],
              select: {
                id: true,
                title: true,
                duration: true,
                audioUrl: true,
                trackOrder: true,
                publishedAt: true
              }
            }
          },
          orderBy: [
            { title: 'asc' }
          ]
      });

      console.log(`✅ Found ${relatedFeeds.length} albums via remote item GUIDs/URLs`);

      // Drop blacklisted feeds (e.g. Henrik Flyman's dead Wavlake mirrors) so they
      // never render on the publisher page, matching the grid/search behavior.
      const beforeBlacklist = relatedFeeds.length;
      relatedFeeds = relatedFeeds.filter(keepFeed);
      if (relatedFeeds.length < beforeBlacklist) {
        console.log(`🚫 Excluded ${beforeBlacklist - relatedFeeds.length} blacklisted/Wavlake feed(s) from Official Releases`);
      }

      // Note: No platform-based filtering here. If a GUID from any publisher feed
      // (Fountain, Wavlake, self-hosted, etc.) matched an album in the DB, it's an
      // official release. The per-feed section logic below handles platform grouping.

      // Explicit blocklist: exclude any feed that appears in podroll (defense in depth)
      if (podrollGuids.size > 0 || podrollUrls.size > 0) {
        const before = relatedFeeds.length;
        relatedFeeds = relatedFeeds.filter(
          (f) => !podrollGuids.has(f.id) && !(f.originalUrl && podrollUrls.has(f.originalUrl))
        );
        if (relatedFeeds.length < before) {
          console.log(`📋 Excluded ${before - relatedFeeds.length} feeds by podroll blocklist`);
        }
      }
    }

    // Find albums linked via publisherId to ANY of this artist's publisher feeds
    const allPublisherFeedIds = allPublisherFeeds.map(f => f.id);
    let publisherIdFeeds = await prisma.feed.findMany({
      where: {
        publisherId: { in: allPublisherFeedIds },
        type: { in: ['album', 'music', 'podcast'] },
        status: 'active',
        markedDead: false,
        blocked: false
      },
      select: {
        id: true,
        title: true,
        artist: true,
        description: true,
        image: true,
        lastFetched: true,
        oldestItemPubdate: true,
        createdAt: true,
        originalUrl: true,
        publisherId: true,
        Track: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ],
          select: {
            id: true,
            title: true,
            duration: true,
            audioUrl: true,
            trackOrder: true,
            publishedAt: true
          }
        }
      },
      orderBy: [
        { title: 'asc' }
      ]
    });

    // Drop blacklisted (and, on Henrik's page, Wavlake) feeds linked via
    // publisherId before they get merged in.
    publisherIdFeeds = publisherIdFeeds.filter(keepFeed);

    // Build a map from album ID -> publisherId for section assignment
    const albumPublisherIdMap = new Map<string, string>();
    for (const feed of publisherIdFeeds) {
      if (feed.publisherId) {
        albumPublisherIdMap.set(feed.id, feed.publisherId);
      }
    }

    console.log(`✅ Found ${publisherIdFeeds.length} albums via publisherId (across ${allPublisherFeedIds.length} publisher feeds)`);

    // Merge publisherIdFeeds into relatedFeeds (Official Releases), excluding podroll items
    // and deduplicating against feeds already found via remote item GUIDs/URLs
    const existingIds = new Set(relatedFeeds.map(f => f.id));
    for (const feed of publisherIdFeeds) {
      if (existingIds.has(feed.id)) continue;
      if (podrollGuids.has(feed.id)) continue;
      if (feed.originalUrl && podrollUrls.has(feed.originalUrl)) continue;
      relatedFeeds.push(feed);
      existingIds.add(feed.id);
    }
    console.log(`✅ After merging publisherId albums: ${relatedFeeds.length} total Official Releases`);

    // --- Build per-feed sections for multi-feed publishers ---
    // Group each album in relatedFeeds by its source publisher feed
    const feedSectionMap = new Map<string, { feed: typeof publisherFeed; albums: typeof relatedFeeds }>();

    // Initialize a section for each publisher feed that has a URL
    for (const pf of allPublisherFeeds) {
      if (pf.originalUrl && pf.originalUrl.trim() !== '') {
        feedSectionMap.set(pf.id, { feed: pf, albums: [] });
      }
    }

    for (const album of relatedFeeds) {
      let matched = false;

      // Priority 1: Use publisherId if this album has one (most reliable)
      const pubId = albumPublisherIdMap.get(album.id);
      if (pubId && feedSectionMap.has(pubId)) {
        const section = feedSectionMap.get(pubId)!;
        if (!section.albums.some(a => a.id === album.id)) {
          section.albums.push(album);
          matched = true;
        }
      }

      // Priority 2: Try matching via GUID source (exact matches only)
      if (!matched) {
        for (const guid of remoteItemGuids) {
          const src = guidToSourceFeed.get(guid);
          if (!src) continue;
          if (
            album.id === guid ||
            (album as any).guid === guid ||
            (album.originalUrl && album.originalUrl.includes(guid))
          ) {
            const section = feedSectionMap.get(src.id);
            if (section && !section.albums.some(a => a.id === album.id)) {
              section.albums.push(album);
              matched = true;
            }
            break;
          }
        }
      }

      // Priority 3: Try matching via URL source
      if (!matched) {
        for (const url of remoteItemUrls) {
          const src = urlToSourceFeed.get(url);
          if (!src) continue;
          if (album.originalUrl === url) {
            const section = feedSectionMap.get(src.id);
            if (section && !section.albums.some(a => a.id === album.id)) {
              section.albums.push(album);
              matched = true;
            }
            break;
          }
        }
      }

      // Fallback: assign to primary publisher feed
      if (!matched) {
        const primarySection = feedSectionMap.get(publisherFeed.id);
        if (primarySection && !primarySection.albums.some(a => a.id === album.id)) {
          primarySection.albums.push(album);
        }
      }
    }

    // Build feedSections with disambiguated titles
    // When a single section contains albums from multiple platforms (e.g., Wavlake + RSS Blue),
    // split it into sub-sections by platform so each platform gets its own heading.
    const expandedSections: Array<{ title: string; feedUrl: string; feedId: string; albums: typeof relatedFeeds; _albumPlatform?: string | null }> = [];

    for (const { feed, albums: sectionAlbums } of feedSectionMap.values()) {
      if (sectionAlbums.length === 0) continue;

      // Detect platforms present in this section
      const byPlatform = new Map<string, typeof relatedFeeds>();
      for (const album of sectionAlbums) {
        const platform = album.originalUrl ? getPlatformName(album.originalUrl) : getPlatformName(feed.originalUrl || '');
        if (!byPlatform.has(platform)) byPlatform.set(platform, []);
        byPlatform.get(platform)!.push(album);
      }

      if (byPlatform.size <= 1) {
        // Single platform — keep as one section
        // Use publisher feed URL for platform label (albums may be hosted elsewhere)
        const feedPlatform = feed.originalUrl ? getPlatformName(feed.originalUrl) : null;
        expandedSections.push({
          title: feed.title || feed.artist || 'Official Releases',
          feedUrl: feed.originalUrl || '',
          feedId: feed.id,
          albums: sectionAlbums,
          _albumPlatform: feedPlatform // used for disambiguation below
        });
      } else {
        // Multiple platforms — split into sub-sections
        const baseName = feed.title || feed.artist || 'Official Releases';
        for (const [platform, albums] of byPlatform) {
          expandedSections.push({
            title: `${baseName} (${platform})`,
            feedUrl: feed.originalUrl || '',
            feedId: `${feed.id}-${platform.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            albums
          });
        }
      }
    }

    // Disambiguate any remaining duplicate titles across sections
    const titleCounts = new Map<string, number>();
    for (const s of expandedSections) {
      const t = s.title.toLowerCase().trim();
      titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
    }
    // Also check if there are multiple sections total — if so, label all of them
    const needsLabels = expandedSections.length > 1;
    for (const s of expandedSections) {
      const key = s.title.toLowerCase().trim();
      const isDuplicate = (titleCounts.get(key) || 0) > 1;
      if ((isDuplicate || needsLabels) && !s.title.includes('(')) {
        // Use publisher feed URL for platform label (more accurate than album URLs,
        // since albums may be hosted on a different platform than the publisher feed)
        const platform = (s.feedUrl ? getPlatformName(s.feedUrl) : null) || s._albumPlatform;
        if (platform) {
          s.title = `${s.title} (${platform})`;
        }
      }
    }

    const feedSections = expandedSections.map(s => ({
      feedTitle: s.title,
      feedUrl: s.feedUrl,
      feedId: s.feedId,
      albums: s.albums
    }));

    console.log(`📂 Built ${feedSections.length} feed sections: ${feedSections.map(s => `${s.feedTitle} (${s.albums.length})`).join(', ')}`);

    // Artist matching: Find additional albums not linked via remote items or publisherId
    // Use artist from the publisher feed we found, OR from the known publisher mapping
    let artistOnlyFeeds: typeof relatedFeeds = [];
    if (artistName) {
      console.log(`🔍 Finding additional albums via artist matching for: "${artistName}"`);

      // Generate artist name variants to handle URL transformations like "and" → "&"
      const artistVariants = [artistName];
      // Try with & instead of And (for URLs like "lies-and-sets" → "Lies & Sets")
      const withAmpersand = artistName.replace(/\bAnd\b/gi, '&');
      if (withAmpersand !== artistName) {
        artistVariants.push(withAmpersand);
      }
      // Try with + instead of Plus
      const withPlus = artistName.replace(/\bPlus\b/gi, '+');
      if (withPlus !== artistName) {
        artistVariants.push(withPlus);
      }

      // Use ONLY exact matches with the artist name variants
      // This is critical to prevent false matches - NO contains matching!
      const allArtistFeeds = await prisma.feed.findMany({
        where: {
          OR: artistVariants.map(variant => ({
            artist: { equals: variant, mode: 'insensitive' as const }
          })),
          type: { in: ['album', 'music', 'podcast'] },
          status: 'active',
          markedDead: false,
          blocked: false
        },
          select: {
            id: true,
            title: true,
            artist: true,
            description: true,
            image: true,
            lastFetched: true,
            oldestItemPubdate: true,
            createdAt: true,
            originalUrl: true,
            Track: {
              where: {
                audioUrl: { not: '' }
              },
              orderBy: [
                { trackOrder: 'asc' },
                { publishedAt: 'asc' },
                { createdAt: 'asc' }
              ],
              select: {
                id: true,
                title: true,
                duration: true,
                audioUrl: true,
                trackOrder: true,
                publishedAt: true
              }
            }
          },
          orderBy: [
            { title: 'asc' }
          ]
        });

      // Filter out albums already in GUID results to get artist-only matches,
      // and drop blacklisted feeds (e.g. Henrik Flyman's dead Wavlake mirrors)
      // so they don't reappear under "More from Artist" via name matching.
      const guidIds = new Set(relatedFeeds.map(f => f.id));
      artistOnlyFeeds = allArtistFeeds.filter(feed => !guidIds.has(feed.id) && keepFeed(feed));

      console.log(`✅ Found ${relatedFeeds.length} GUID-matched albums, ${artistOnlyFeeds.length} additional artist-matched albums`);
    }

    // Helper function to convert duration to MM:SS format
    const formatDurationToString = (duration: number | null | string | undefined): string => {
      if (!duration) return '0:00';
      
      // If already a string in MM:SS format, return it
      if (typeof duration === 'string') {
        if (duration.includes(':')) {
          return duration;
        }
        // If it's a numeric string, parse it as seconds
        const num = parseFloat(duration);
        if (!isNaN(num)) {
          const mins = Math.floor(num / 60);
          const secs = Math.floor(num % 60);
          return `${mins}:${secs.toString().padStart(2, '0')}`;
        }
        return duration || '0:00';
      }
      
      // If it's a number (seconds), convert to MM:SS
      if (typeof duration === 'number') {
        const mins = Math.floor(duration / 60);
        const secs = Math.floor(duration % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      }
      
      return '0:00';
    };

    // Helper to transform feeds to albums format
    const transformFeedsToAlbums = (feeds: typeof relatedFeeds) => feeds
      .filter(feed => feed.Track.length > 0) // Only include feeds with tracks
      .map(feed => ({
        id: feed.id,
        title: feed.title,
        artist: feed.artist,
        description: feed.description,
        coverArt: feed.image,
        // oldestItemPubdate, NOT lastFetched. `lastFetched` is when we last
        // POLLED the feed, so this page showed a different year for the same
        // album than the home grid, /api/feeds/recent, /api/parsed-feeds and
        // /api/publishers-by-id — all of which use the line below.
        // See lib/catalog/album-shape.ts.
        releaseDate: feed.oldestItemPubdate || feed.createdAt,
        trackCount: feed.Track.length,
        tracks: feed.Track.map((track: {
          id: string;
          title: string | null;
          duration: number | null;
          audioUrl: string;
          trackOrder: number | null;
          publishedAt: Date | null;
        }) => ({
          id: track.id,
          title: track.title || 'Unknown Track',
          duration: formatDurationToString(track.duration),
          url: track.audioUrl || '',
          trackNumber: track.trackOrder || 0
        })),
        feedUrl: feed.originalUrl
      }));

    // Transform GUID-matched feeds (Official Releases)
    const officialAlbums = transformFeedsToAlbums(relatedFeeds);

    // Transform artist-only feeds (More from Artist)
    const artistMatchedAlbums = transformFeedsToAlbums(artistOnlyFeeds);

    // Combined for backwards compatibility and stats
    const albums = [...officialAlbums, ...artistMatchedAlbums];

    console.log(`🏢 Server-side: Found ${officialAlbums.length} official albums, ${artistMatchedAlbums.length} artist-matched albums`);

    // Sort albums by release date to get the actual newest album
    const albumsSortedByDate = albums.length > 0 ? [...albums].sort((a, b) => {
      const dateA = new Date(a.releaseDate || 0);
      const dateB = new Date(b.releaseDate || 0);
      return dateB.getTime() - dateA.getTime(); // Newest first
    }) : [];

    // Create publisher items (this might be empty for some publishers)
    const publisherItems: any[] = []; // TODO: Extract from publisher feed if needed

    // Transform feed sections for client
    const transformedFeedSections = feedSections.map(s => ({
      feedTitle: s.feedTitle,
      feedUrl: s.feedUrl,
      feedId: s.feedId,
      albums: transformFeedsToAlbums(s.albums)
    }));

    // Convert to expected format
    const data = {
      publisherInfo: {
        name: publisherInfo?.name || publisherFeed.title || publisherId,
        description: publisherFeed.description || `${albums.length} releases`,
        image: feedImage || publisherFeed.image || null, // Use XML image, fallback to database image
        publisherFeedImage: feedImage || publisherFeed.image || null, // Explicit publisher feed image with fallback
        newestAlbumImage: albumsSortedByDate.length > 0 ? albumsSortedByDate[0].coverArt : null, // Newest album by release date for hero
        feedUrl: publisherFeed.originalUrl,
        feedGuid: publisherFeed.id
      },
      publisherItems,
      albums, // Combined albums for backwards compatibility
      officialAlbums, // GUID-matched albums (Official Releases)
      artistMatchedAlbums, // Artist-only albums (More from Artist)
      feedSections: transformedFeedSections, // Per-publisher-feed sections
      feedId: publisherFeed.id
    };
    
    console.log(`🏢 Server-side: Found publisher data for ${publisherId}:`, {
      name: data.publisherInfo.name,
      feedGuid: data.publisherInfo.feedGuid,
      image: data.publisherInfo.image,
      albumCount: albums.length
    });
    
    return data;
  } catch (error) {
    console.error('Error loading publisher data:', error);
    return null;
  }
}

export default async function PublisherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const publisherId = decodeURIComponent(id);
  
  // Load publisher data server-side
  const publisherData = await loadPublisherData(publisherId);
  
  return <PublisherDetailClient publisherId={publisherId} initialData={publisherData} />;
}