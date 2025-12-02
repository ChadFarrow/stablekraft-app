import { Metadata } from 'next';
import PublisherDetailClient from './PublisherDetailClient';
import { getPublisherInfo } from '@/lib/url-utils';
import { prisma } from '@/lib/prisma';

// Force dynamic rendering to always fetch fresh publisher data from database
export const dynamic = 'force-dynamic';

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
    publisherFeed = await prisma.feed.findFirst({
      where: {
        type: 'publisher',
        status: 'active',
        id: publisherId
      }
    });
    
    // If not found, try without status requirement
    if (!publisherFeed) {
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: 'publisher',
          id: publisherId
        }
      });
    }
    
    // If not found, try matching by originalUrl from publisherInfo
    if (!publisherFeed && publisherInfo?.feedUrl) {
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: 'publisher',
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
          type: 'publisher',
          status: 'active',
          id: publisherInfo.feedGuid
        }
      });
      
      // If not found, try without status
      if (!publisherFeed) {
        publisherFeed = await prisma.feed.findFirst({
          where: {
            type: 'publisher',
            id: publisherInfo.feedGuid
          }
        });
      }
      
      // If not found, try prefix match (for IDs like wavlake-publisher-93fbacab)
      if (!publisherFeed && feedGuidPrefix) {
        publisherFeed = await prisma.feed.findFirst({
          where: {
            type: 'publisher',
            status: 'active',
            id: { contains: feedGuidPrefix }
          }
        });
        
        // If still not found, try without status
        if (!publisherFeed) {
          publisherFeed = await prisma.feed.findFirst({
            where: {
              type: 'publisher',
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
          type: 'publisher',
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
          type: 'publisher',
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
            type: 'publisher'
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
        if (feed.title) {
          const titleToSlug = feed.title.toLowerCase().replace(/\s+/g, '-');
          if (titleToSlug === searchId || titleToSlug === normalizedSearchId) {
            console.log(`✅ Matched publisher by title slug: "${feed.title}" -> "${titleToSlug}"`);
            return true;
          }
        }
        
        // Try matching by artist slug (with and without -publisher suffix)
        if (feed.artist) {
          const artistToSlug = feed.artist.toLowerCase().replace(/\s+/g, '-');
          if (artistToSlug === searchId || artistToSlug === normalizedSearchId) {
            console.log(`✅ Matched publisher by artist slug: "${feed.artist}" -> "${artistToSlug}"`);
            return true;
          }
        }
        
        return false;
      });
      
      if (!publisherFeed) {
        console.log(`❌ No publisher feed matched slug "${searchId}"`);
      }
    }
    
    // If no publisher feed found, try to find albums by artist name and create publisher info from them
    // BUT only if we have a known publisher mapping to prevent false matches
    let artistName: string | null = null;
    
    if (!publisherFeed) {
      const publisherInfo = getPublisherInfo(publisherId);
      
      // Only create synthetic publisher if we have a known mapping
      // This prevents creating publishers from wrong artist matches
      if (publisherInfo?.name) {
        console.log(`⚠️ No publisher feed found for "${publisherId}", but we have a mapping to "${publisherInfo.name}"`);
        
        // Find the first album feed with exact artist match
        const firstAlbumFeed = await prisma.feed.findFirst({
          where: {
            type: { in: ['album', 'music'] },
            status: 'active',
            artist: { equals: publisherInfo.name, mode: 'insensitive' } // Exact match only!
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
        
        if (firstAlbumFeed) {
          artistName = publisherInfo.name; // Use the mapped name, not the feed's artist
          console.log(`✅ Found albums by mapped artist: "${artistName}"`);
          
          // Create a synthetic publisher feed from the first album
          // NOTE: Don't set image here - we'll fetch it from the actual feed XML below
          publisherFeed = {
            id: `publisher-${publisherId}`,
            title: artistName || publisherId,
            artist: artistName || null,
            description: `Albums by ${artistName || publisherId}`,
            image: null, // Will be populated from feed XML fetch below
            originalUrl: publisherInfo.feedUrl || '',
            type: 'publisher' as any,
            status: 'active' as any,
            createdAt: new Date(),
            updatedAt: new Date()
          } as any;
          
          console.log(`📝 Created synthetic publisher feed for "${artistName}"`);
        } else {
          console.log(`❌ No albums found for mapped artist "${publisherInfo.name}"`);
          return null;
        }
      } else {
        console.log(`❌ No publisher feed found for "${publisherId}" and no known mapping - cannot create synthetic publisher`);
        return null;
      }
    } else {
      console.log(`✅ Publisher found: ${publisherFeed.title || publisherFeed.id}`);
      artistName = publisherFeed.artist || publisherFeed.title;
    }

    // Try to fetch and parse publisher feed to get remote items and artwork
    let remoteItemGuids: string[] = [];
    let remoteItemUrls: string[] = []; // Also collect feedUrls for matching
    let feedImage: string | null = publisherFeed.image || null;

    if (publisherFeed.originalUrl && publisherFeed.originalUrl.trim() !== '') {
      try {
        console.log(`📡 Fetching publisher feed XML to extract remote items: ${publisherFeed.originalUrl}`);
        const feedResponse = await fetch(publisherFeed.originalUrl, {
          signal: AbortSignal.timeout(10000), // 10 second timeout (increased from 5)
        });

        if (feedResponse.ok) {
          const xmlText = await feedResponse.text();

          // ALWAYS extract artwork/image from feed (prioritize feed over database)
          // Try iTunes image first
          const itunesImageMatch = xmlText.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
          if (itunesImageMatch && itunesImageMatch[1]) {
            feedImage = itunesImageMatch[1].trim();
            console.log(`🎨 Found iTunes image in feed: ${feedImage}`);
          } else {
            // Try standard image tag
            const imageMatch = xmlText.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i);
            if (imageMatch && imageMatch[1]) {
              feedImage = imageMatch[1].trim();
              console.log(`🎨 Found image in feed: ${feedImage}`);
            } else {
              console.warn(`⚠️ No image found in publisher feed XML`);
            }
          }
          
          // Extract podcast:remoteItem tags (for music/album feeds, not publisher references)
          const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
          const matches = xmlText.match(remoteItemRegex) || [];
          
          for (const match of matches) {
            const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
            const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
            const mediumMatch = match.match(/medium="([^"]+)"/);
            
            const medium = mediumMatch?.[1] || 'music';
            
            // Only collect album/music remote items, not publisher references
            if (medium === 'publisher') {
              // Skip publisher references - we only want albums
              continue;
            }
            
            // Collect album/music remote items
            if (feedGuidMatch && feedGuidMatch[1]) {
              const guid = feedGuidMatch[1];
              
              // Check if URL indicates this is a music/album feed (not a publisher feed)
              // For wavlake, remote items from artist feeds can point to music feeds
              const isAlbumFeed = feedUrlMatch && (
                feedUrlMatch[1].includes('/feed/music/') || 
                (feedUrlMatch[1].includes('/feed/') && !feedUrlMatch[1].includes('/feed/artist/')) ||
                medium === 'music' ||
                !mediumMatch // Default to music if no medium
              );
              
              // Also include if the medium is explicitly 'music' or 'album'
              const isExplicitAlbum = medium === 'music' || medium === 'album';
              
              if ((isAlbumFeed || isExplicitAlbum) && !remoteItemGuids.includes(guid)) {
                remoteItemGuids.push(guid);
                // Also collect the feedUrl for matching (more reliable than GUID for fountain feeds)
                if (feedUrlMatch && feedUrlMatch[1] && !remoteItemUrls.includes(feedUrlMatch[1])) {
                  remoteItemUrls.push(feedUrlMatch[1]);
                }
                console.log(`📋 Added remote item GUID: ${guid} (medium: ${medium}, url: ${feedUrlMatch?.[1]})`);
              }
            }
          }

          console.log(`📋 Found ${remoteItemGuids.length} album remote items, ${remoteItemUrls.length} URLs in publisher feed`);
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch publisher feed XML:', error);
        // Continue with artist-based matching as fallback
      }
    }
    
    // Get related albums for this publisher - try remote items first, then fall back to artist matching
    let relatedFeeds: any[] = [];

    // If we have remote items, find feeds by their GUIDs or URLs
    if (remoteItemGuids.length > 0 || remoteItemUrls.length > 0) {
      console.log(`🔍 Looking for albums by ${remoteItemGuids.length} GUIDs and ${remoteItemUrls.length} URLs...`);

      // Create OR conditions for each GUID (match by ID or URL)
      const guidConditions = remoteItemGuids.map(guid => ({
        OR: [
          { id: { equals: guid } },
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
          type: { in: ['album', 'music'] },
          status: 'active'
        },
          select: {
            id: true,
            title: true,
            artist: true,
            description: true,
            image: true,
            lastFetched: true,
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

      // Only apply fountain.fm filtering if the publisher feed is from fountain.fm
      // This prevents filtering out Wavlake albums for Wavlake publishers
      const isFountainPublisher = publisherFeed.originalUrl?.includes('feeds.fountain.fm');

      if (isFountainPublisher) {
        // Filter to only keep fountain.fm feeds as "official" (publisher feed is from fountain.fm)
        // Other matches (RSS Blue, etc.) will be moved to artist-matched section
        const fountainFeeds = relatedFeeds.filter(f =>
          f.originalUrl?.includes('feeds.fountain.fm')
        );
        const nonFountainFeeds = relatedFeeds.filter(f =>
          !f.originalUrl?.includes('feeds.fountain.fm')
        );

        if (nonFountainFeeds.length > 0) {
          console.log(`📋 Filtered to ${fountainFeeds.length} fountain.fm feeds (${nonFountainFeeds.length} non-fountain feeds moved to artist section)`);
        }

        relatedFeeds = fountainFeeds;
      }
    }

    // Artist matching: Find additional albums not linked via remote items
    // Use artist from the publisher feed we found, OR from the known publisher mapping
    let artistOnlyFeeds: typeof relatedFeeds = [];
    if (artistName) {
      console.log(`🔍 Finding additional albums via artist matching for: "${artistName}"`);

      // Use ONLY exact matches with the artist name
      // This is critical to prevent false matches - NO contains matching!
      const allArtistFeeds = await prisma.feed.findMany({
        where: {
          artist: { equals: artistName, mode: 'insensitive' },
          type: { in: ['album', 'music'] },
          status: 'active'
        },
          select: {
            id: true,
            title: true,
            artist: true,
            description: true,
            image: true,
            lastFetched: true,
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

      // Filter out albums already in GUID results to get artist-only matches
      const guidIds = new Set(relatedFeeds.map(f => f.id));
      artistOnlyFeeds = allArtistFeeds.filter(feed => !guidIds.has(feed.id));

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
        releaseDate: feed.lastFetched || feed.createdAt,
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