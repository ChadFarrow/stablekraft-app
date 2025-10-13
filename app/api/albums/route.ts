import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

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
      // For all other filters, exclude podcasts and publisher feeds
      feedWhere.type = { 
        notIn: ['podcast', 'publisher']
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

    // Apply publisher filtering at database level for better performance
    if (publisher) {
      // Extract artist name from publisher parameter (e.g., "joe-martin-publisher" -> "joe martin")
      const publisherSlug = publisher.toLowerCase().replace(/-publisher$/, '').replace(/-/g, ' ');

      // Filter feeds by artist name at database level
      feedWhere.artist = {
        contains: publisherSlug,
        mode: 'insensitive'
      };
    }

    // OPTIMIZED: Single query with include for better performance
    const feeds = await prisma.feed.findMany({
      where: feedWhere,
      include: {
        tracks: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ],
          take: 50 // Limit tracks per feed for performance
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ],
      take: publisher ? undefined : 200 // No limit when filtering by publisher, otherwise 200
    });
    
    // Extract tracks from the included data
    const tracks = feeds.flatMap(feed => feed.tracks);
    
    console.log(`📊 Loaded ${feeds.length} feeds from database`);
    
    // Group tracks by feed
    const tracksByFeed = tracks.reduce((acc, track) => {
      if (!acc[track.feedId]) {
        acc[track.feedId] = [];
      }
      acc[track.feedId].push(track);
      return acc;
    }, {} as Record<string, any[]>);
    
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
        keywords: track.itunesKeywords || []
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

    // Apply publisher filtering if specified
    let publisherFilteredAlbums = podcastFilteredAlbums;
    if (publisher) {
      const publisherLower = publisher.toLowerCase();
      publisherFilteredAlbums = podcastFilteredAlbums.filter(album => {
        // Match by publisher feedGuid
        if (album.publisher?.feedGuid?.toLowerCase() === publisherLower) {
          return true;
        }
        // Match by publisher title
        if (album.publisher?.title?.toLowerCase() === publisherLower) {
          return true;
        }
        // Match by publisher title with slug conversion (e.g., "joe-martin-publisher" -> "joe martin")
        const publisherSlug = publisherLower.replace(/-publisher$/, '').replace(/-/g, ' ');
        if (album.publisher?.title?.toLowerCase() === publisherSlug) {
          return true;
        }
        // Match by artist name (for individual artist publishers)
        if (album.artist?.toLowerCase() === publisherLower || album.artist?.toLowerCase() === publisherSlug) {
          return true;
        }
        // Match if publisher parameter contains the artist name (e.g., "joe-martin-publisher" contains "joe martin")
        const artistLower = album.artist?.toLowerCase() || '';
        const artistSlug = artistLower.replace(/\s+/g, '-');
        if (publisherLower.includes(artistSlug) || publisherLower.includes(artistLower)) {
          return true;
        }
        return false;
      });
      console.log(`🔍 Publisher filter "${publisher}": ${publisherFilteredAlbums.length}/${podcastFilteredAlbums.length} albums matched`);
    }
    
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
    const playlistAlbums = await getPlaylistAlbums();
    if (playlistAlbums.length > 0) {
      filteredAlbums.push(...playlistAlbums);
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