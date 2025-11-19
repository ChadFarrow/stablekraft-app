import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

// Helper function to normalize Wavlake URLs for comparison
function normalizeWavlakeUrl(url: string): string {
  if (!url) return '';

  // Extract the GUID from the URL (the last part after the last slash)
  const guidMatch = url.match(/([a-f0-9-]{36})/i);
  if (guidMatch) {
    return guidMatch[1].toLowerCase();
  }

  return url.toLowerCase();
}

// Cache for publisher remoteItem GUIDs
const publisherRemoteItemsCache = new Map<string, Set<string>>();

// Load static publisher remote items mapping
let publisherRemoteItemsStatic: Record<string, string[]> | null = null;
function loadPublisherRemoteItemsStatic(): Record<string, string[]> {
  if (publisherRemoteItemsStatic) return publisherRemoteItemsStatic;

  try {
    const staticPath = path.join(process.cwd(), 'data', 'publisher-remote-items.json');
    if (fs.existsSync(staticPath)) {
      publisherRemoteItemsStatic = JSON.parse(fs.readFileSync(staticPath, 'utf-8'));
      return publisherRemoteItemsStatic || {};
    }
  } catch (error) {
    console.error('Error loading static publisher remote items:', error);
  }

  return {};
}

// Function to get publisher feed remoteItem URLs (using static data, no XML fetch)
async function getPublisherRemoteItemUrls(publisherId: string): Promise<Set<string>> {
  try {
    // Check in-memory cache first
    if (publisherRemoteItemsCache.has(publisherId)) {
      const cached = publisherRemoteItemsCache.get(publisherId)!;
      console.log(`🔍 Using cached remoteItems for ${publisherId}: ${cached.size} items`);
      return cached;
    }

    // Load static mapping (fast, synchronous)
    const staticMapping = loadPublisherRemoteItemsStatic();
    if (staticMapping[publisherId]) {
      const guids = new Set(staticMapping[publisherId]);
      console.log(`🔍 Using static remoteItems for ${publisherId}: ${guids.size} items`);
      publisherRemoteItemsCache.set(publisherId, guids);
      return guids;
    }

    console.warn(`⚠️  No static remoteItems found for ${publisherId}`);
    return new Set();
  } catch (error) {
    console.error(`Error in getPublisherRemoteItemUrls for ${publisherId}:`, error);
    return new Set();
  }
}

// Function to get playlist albums
async function getPlaylistAlbums() {
  try {
    const playlistAlbums = [];

    // Use the correct localhost port (3000) for development
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

    // Fetch HGH playlist
    const hghResponse = await fetch(`${baseUrl}/api/playlist/hgh`);
    if (hghResponse.ok) {
      const hghData = await hghResponse.json();
      if (hghData.success && hghData.albums && hghData.albums.length > 0) {
        playlistAlbums.push(hghData.albums[0]);
      }
    }
    
    // Fetch ITDV playlist
    const itdvResponse = await fetch(`${baseUrl}/api/playlist/itdv`);
    if (itdvResponse.ok) {
      const itdvData = await itdvResponse.json();
      if (itdvData.success && itdvData.albums && itdvData.albums.length > 0) {
        playlistAlbums.push(itdvData.albums[0]);
      }
    }
    
    // Fetch IAM playlist
    const iamResponse = await fetch(`${baseUrl}/api/playlist/iam`);
    if (iamResponse.ok) {
      const iamData = await iamResponse.json();
      if (iamData.success && iamData.albums && iamData.albums.length > 0) {
        playlistAlbums.push(iamData.albums[0]);
      }
    }
    
    return playlistAlbums;
  } catch (error) {
    console.error('Error fetching playlist albums:', error);
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const tier = searchParams.get('tier') || 'all';
    const feedId = searchParams.get('feedId');
    const filter = searchParams.get('filter') || 'all'; // albums, eps, singles, all, playlist, publisher
    const publisher = searchParams.get('publisher'); // NEW: Filter by publisher

    console.log(`🎵 Albums API request: limit=${limit}, offset=${offset}, tier=${tier}, feedId=${feedId}, filter=${filter}, publisher=${publisher}`);
    
    // Build where clause for feeds based on filter
    const feedWhere: any = { 
      status: 'active'
    };

    // Apply type filtering based on filter parameter
    if (filter === 'publisher') {
      // Only show publisher feeds when explicitly requested
      feedWhere.type = 'publisher';
    } else {
      // For all other filters, exclude podcasts, publisher feeds, and test feeds
      feedWhere.type = { 
        notIn: ['podcast', 'publisher', 'test']
      };
    }
    
    // Apply tier filtering if specified
    if (tier !== 'all') {
      const tierPriorityMap: Record<string, string[]> = {
        'core': ['core'],
        'high': ['core', 'high'],
        'extended': ['core', 'high', 'normal'],
        'lowPriority': ['low']
      };
      
      if (tierPriorityMap[tier]) {
        feedWhere.priority = { in: tierPriorityMap[tier] };
      }
    }
    
    // Apply feed ID filtering if specified
    if (feedId) {
      feedWhere.id = feedId;
    }

    // Store publisher filter for in-memory filtering (much faster than 21 OR ILIKEs)
    let publisherRemoteGuids: Set<string> | null = null;
    if (publisher) {
      publisherRemoteGuids = await getPublisherRemoteItemUrls(publisher);

      if (publisherRemoteGuids.size === 0) {
        console.warn(`⚠️  No remoteItems found for publisher "${publisher}"`);
        // Return empty result early
        return NextResponse.json({
          albums: [],
          totalCount: 0,
          hasMore: false,
          offset,
          limit,
          publisherStats: [],
          lastUpdated: new Date().toISOString()
        });
      }

      console.log(`🔍 Will filter ${publisherRemoteGuids.size} GUIDs in-memory for publisher "${publisher}"`);
      // NOTE: We don't add database-level filtering here because 21 OR ILIKE conditions are very slow
      // Instead, we'll fetch more feeds and filter in-memory (much faster)
    }

    // OPTIMIZED: For publisher filtering, use two-phase approach to avoid slow queries
    let feeds: any[];
    let tracks: any[];
    let tracksByFeed: Record<string, any[]> = {};

    if (publisher && publisherRemoteGuids && publisherRemoteGuids.size > 0) {
      // Phase 1: Load feed metadata only (fast, no tracks)
      console.log(`🚀 Phase 1: Loading feed metadata...`);
      const allFeeds = await prisma.feed.findMany({
        where: feedWhere,
        orderBy: [
          { priority: 'asc' },
          { createdAt: 'desc' }
        ],
        take: 500  // Load more since we're not loading tracks yet
      });

      // Phase 2: Filter in-memory by GUID
      const matchedFeeds = allFeeds.filter(feed => {
        const feedUrl = feed.originalUrl || '';
        for (const guid of publisherRemoteGuids) {
          if (feedUrl.includes(guid)) {
            return true;
          }
        }
        return false;
      });

      console.log(`🔍 Phase 2: Matched ${matchedFeeds.length}/${allFeeds.length} feeds by GUID`);

      // Phase 3: Load tracks only for matched feeds (much faster!)
      if (matchedFeeds.length > 0) {
        const feedIds = matchedFeeds.map(f => f.id);
        tracks = await prisma.track.findMany({
          where: {
            feedId: { in: feedIds },
            audioUrl: { not: '' }
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ]
        });

        // Group tracks by feed
        tracksByFeed = tracks.reduce((acc, track) => {
          if (!acc[track.feedId]) {
            acc[track.feedId] = [];
          }
          acc[track.feedId].push(track);
          return acc;
        }, {} as Record<string, any[]>);

        feeds = matchedFeeds;
        console.log(`📊 Phase 3: Loaded ${tracks.length} tracks for ${feeds.length} matched feeds`);
      } else {
        feeds = [];
        tracks = [];
        console.log(`⚠️  No feeds matched publisher GUIDs`);
      }
    } else {
      // Normal query for non-publisher requests
      const feedLimit = 500;
      feeds = await prisma.feed.findMany({
        where: feedWhere,
        include: {
          Track: {
            where: {
              audioUrl: { not: '' }
            },
            orderBy: [
              { trackOrder: 'asc' },
              { publishedAt: 'asc' },
              { createdAt: 'asc' }
            ],
            take: 20
          }
        },
        orderBy: [
          { priority: 'asc' },
          { createdAt: 'desc' }
        ],
        take: feedLimit
      });

      // Extract tracks from the included data
      tracks = feeds.flatMap(feed => feed.Track);

      console.log(`📊 Loaded ${feeds.length} feeds from database`);

      // Group tracks by feed
      tracksByFeed = tracks.reduce((acc, track) => {
        if (!acc[track.feedId]) {
          acc[track.feedId] = [];
        }
        acc[track.feedId].push(track);
        return acc;
      }, {} as Record<string, any[]>);
    }
    
    // Transform feeds into album format
    let albums = feeds.map(feed => {
      const feedTracks = tracksByFeed[feed.id] || [];
      
      // Group tracks by album or treat each feed as an album
      const albumMap = new Map<string, any>();
      
      if (feed.type === 'album' || feedTracks.length <= 10) {
        // Treat entire feed as single album
        const albumKey = feed.title;
        albumMap.set(albumKey, {
          title: feed.title,
          artist: feed.artist || 'Unknown Artist',
          description: feed.description || '',
          image: feed.image || '',
          tracks: feedTracks,
          feed: feed
        });
      } else {
        // Group tracks by album field or artist
        feedTracks.forEach(track => {
          const albumKey = track.album || track.artist || feed.title;
          
          if (!albumMap.has(albumKey)) {
            albumMap.set(albumKey, {
              title: track.album || feed.title,
              artist: track.artist || feed.artist || 'Unknown Artist',
              description: track.description || feed.description || '',
              image: track.image || feed.image || '',
              tracks: [],
              feed: feed
            });
          }
          
          albumMap.get(albumKey).tracks.push(track);
        });
      }
      
      return Array.from(albumMap.values());
    }).flat();
    
    // Transform to consistent album format
    const transformedAlbums = albums.map((album: any) => {
      const feed = album.feed;
      const tracks = album.tracks
        .filter((track: any, index: number, self: any[]) => {
          // Deduplicate tracks by URL and title
          return self.findIndex((t: any) => 
            t.audioUrl === track.audioUrl && t.title === track.title
          ) === index;
        })
        .map((track: any, index: number) => ({
        title: track.title,
        duration: track.duration ?
          Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0') :
          track.itunesDuration || '0:00',
        url: track.audioUrl,
        trackNumber: index + 1,
        subtitle: track.subtitle || '',
        summary: track.description || '',
        image: track.image || album.image,
        explicit: track.explicit || false,
        keywords: track.itunesKeywords || [],
        // V4V fields for Lightning payments
        v4vRecipient: track.v4vRecipient,
        v4vValue: track.v4vValue,
        // Additional fields for track identification and time segments
        guid: track.guid,
        id: track.id,
        startTime: track.startTime,
        endTime: track.endTime
      }));
      
      // Determine if this is a playlist based on track variety
      const isPlaylist = tracks.length > 1 && 
        new Set(tracks.map((t: any) => t.artist || album.artist)).size > 1;
      
      // Create publisher info based on feed origin
      let publisher = null;

      // Check if this is a Doerfels-related feed (from doerfelverse.com)
      if (feed.originalUrl.includes('doerfelverse.com')) {
        publisher = {
          feedGuid: "the-doerfels", // Use consistent identifier for The Doerfels
          feedUrl: "https://re.podtards.com/api/feeds/doerfels-pubfeed",
          title: "The Doerfels",
          artistImage: "https://www.doerfelverse.com/art/doerfels-hockeystick.png"
        };
      } else if (feed.type === 'album' && feed.artist) {
        // For other artist feeds, create individual publisher info
        publisher = {
          feedGuid: feed.id,
          feedUrl: feed.originalUrl,
          title: feed.artist,
          artistImage: feed.image
        };
      }
      
      // Extract V4V data from first track (feeds don't have V4V fields, only tracks do)
      let v4vRecipient = null;
      let v4vValue = null;

      // Get V4V data from tracks
      if (album.tracks.length > 0) {
        const trackWithV4V = album.tracks.find((t: any) => t.v4vRecipient || t.v4vValue);
        if (trackWithV4V) {
          v4vRecipient = trackWithV4V.v4vRecipient;
          v4vValue = trackWithV4V.v4vValue;
        }
      }

      return {
        id: generateAlbumSlug(album.title) + '-' + feed.id.split('-')[0],
        title: album.title,
        artist: album.artist,
        description: album.description,
        coverArt: album.image || `/api/placeholder-image?title=${encodeURIComponent(album.title)}&artist=${encodeURIComponent(album.artist)}`,
        tracks: tracks,
        releaseDate: feed.lastFetched || feed.createdAt,
        podroll: isPlaylist ? { enabled: true } : null,
        publisher: publisher,
        funding: null, // Can be enhanced with V4V data from tracks
        feedId: feed.id,
        feedUrl: feed.originalUrl,
        feedGuid: feed.guid, // podcast:guid from RSS feed
        lastUpdated: feed.updatedAt,
        explicit: tracks.some((t: any) => t.explicit) || feed.explicit,
        // V4V data for boosts
        v4vRecipient: v4vRecipient,
        v4vValue: v4vValue
      };
    });
    
    // Filter out Bowl After Bowl main podcast content but keep music covers
    const podcastFilteredAlbums = transformedAlbums.filter(album => {
      const albumTitle = album.title?.toLowerCase() || '';
      const albumArtist = album.artist?.toLowerCase() || '';
      const feedUrl = album.feedUrl?.toLowerCase() || '';

      // Keep Bowl Covers - these are legitimate music content
      if (album.feedId === 'bowl-covers' || albumTitle.includes('bowl covers')) {
        return true;
      }

      // Filter out main Bowl After Bowl podcast episodes
      const isBowlAfterBowlPodcast = (
        (albumTitle.includes('bowl after bowl') && !albumTitle.includes('covers')) ||
        (albumArtist.includes('bowl after bowl') && !albumTitle.includes('covers')) ||
        (feedUrl.includes('bowlafterbowl.com') && !albumTitle.includes('covers') && album.feedId !== 'bowl-covers')
      );

      if (isBowlAfterBowlPodcast) {
        console.log(`🚫 Filtering out Bowl After Bowl podcast: ${album.title} by ${album.artist}`);
      }

      return !isBowlAfterBowlPodcast;
    });

    // Publisher filtering is already done in the 3-phase approach above (loading feeds)
    // No need to filter again here
    let publisherFilteredAlbums = podcastFilteredAlbums;
    
    // Apply filtering by type
    let filteredAlbums = publisherFilteredAlbums;
    if (filter !== 'all') {
      switch (filter) {
        case 'albums':
          filteredAlbums = publisherFilteredAlbums.filter(album => album.tracks.length > 6);
          break;
        case 'eps':
          filteredAlbums = publisherFilteredAlbums.filter(album => album.tracks.length > 1 && album.tracks.length <= 6);
          break;
        case 'singles':
          filteredAlbums = publisherFilteredAlbums.filter(album => album.tracks.length === 1);
          break;
        case 'playlist':
          filteredAlbums = publisherFilteredAlbums.filter(album => album.podroll !== null);
          break;
        default:
          filteredAlbums = publisherFilteredAlbums;
      }
    }
    
    // Add playlist albums if they're requested or if we're looking for specific album titles
    // Skip for publisher requests to avoid timeouts
    if (!publisher) {
      try {
        const playlistAlbums = await getPlaylistAlbums();
        if (playlistAlbums.length > 0) {
          filteredAlbums.push(...playlistAlbums);
        }
      } catch (error) {
        console.error('Skipping playlist albums due to error:', error);
        // Continue without playlist albums
      }
    }
    
    // Sort albums: Albums first (7+ tracks), then EPs (2-6 tracks), then Singles (1 track)
    const sortedAlbums = [
      ...filteredAlbums.filter(album => album.tracks.length > 6)
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())),
      ...filteredAlbums.filter(album => album.tracks.length > 1 && album.tracks.length <= 6)
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase())),
      ...filteredAlbums.filter(album => album.tracks.length === 1)
        .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
    ];
    
    const totalCount = sortedAlbums.length;
    
    // Apply pagination
    const paginatedAlbums = limit === 0 ? 
      sortedAlbums.slice(offset) : 
      sortedAlbums.slice(offset, offset + limit);
    
    // Pre-compute publisher statistics for the sidebar
    const publisherStats = new Map<string, { name: string; feedGuid: string; albumCount: number }>();
    
    sortedAlbums
      .filter(album => album.publisher && album.publisher.feedGuid)
      .forEach(album => {
        const key = album.publisher!.feedGuid;
        if (!publisherStats.has(key)) {
          publisherStats.set(key, {
            name: album.publisher!.title,
            feedGuid: album.publisher!.feedGuid,
            albumCount: 1
          });
        } else {
          publisherStats.get(key)!.albumCount++;
        }
      });

    const publisherStatsArray = Array.from(publisherStats.values()).sort((a, b) => 
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    
    console.log(`✅ Database Albums API: Returning ${paginatedAlbums.length}/${totalCount} albums with ${publisherStatsArray.length} publisher feeds`);
    
    return NextResponse.json({
      albums: paginatedAlbums,
      totalCount,
      hasMore: limit === 0 ? false : offset + limit < totalCount,
      offset,
      limit,
      publisherStats: publisherStatsArray,
      lastUpdated: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'ETag': `"db-${totalCount}-${offset}-${limit}"`
      }
    });

  } catch (error) {
    console.error('Error in database albums API:', error);
    return NextResponse.json({ 
      albums: [], 
      totalCount: 0, 
      lastUpdated: new Date().toISOString(),
      error: 'Database error' 
    }, { status: 500 });
  }
}