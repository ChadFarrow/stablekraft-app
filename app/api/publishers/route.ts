import { NextResponse, NextRequest } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

export async function GET(request: NextRequest) {
  const cors = await corsHeaders();
  try {
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get('sort') || 'name-asc';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10) || 0;

    console.log(`🔍 Publishers API: Loading publishers (sort=${sort}, limit=${limit}, offset=${offset})`);

    // Get actual publisher-type feeds from the database
    const publisherFeeds = await prisma.feed.findMany({
      where: {
        type: 'publisher',
        status: 'active',
        markedDead: false,
        blocked: false
      },
      select: {
        id: true,
        title: true,
        artist: true,
        image: true,
        originalUrl: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    console.log(`📊 Found ${publisherFeeds.length} publisher feeds`);

    // Get all album feeds with track counts and images, grouped by artist
    const albumFeeds = await prisma.feed.findMany({
      where: {
        type: { in: ['album', 'music'] },
        status: 'active',
        markedDead: false,
        blocked: false
      },
      select: {
        id: true,
        title: true,
        artist: true,
        image: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { Track: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    console.log(`📊 Found ${albumFeeds.length} album feeds`);

    // Group albums by artist name (lowercase) for lookup
    const artistAlbums = new Map<string, typeof albumFeeds>();
    for (const album of albumFeeds) {
      if (!album.artist || album._count.Track === 0) continue;

      const artistKey = album.artist.toLowerCase().trim();
      const existing = artistAlbums.get(artistKey) || [];
      existing.push(album);
      artistAlbums.set(artistKey, existing);
    }

    // Transform to the expected format
    const publisherList: {
      id: string;
      title: string;
      feedGuid: string;
      originalUrl: string | null;
      image: string;
      description: string;
      albums: never[];
      itemCount: number;
      totalTracks: number;
      isPublisherCard: boolean;
      publisherUrl: string;
      dateAdded: string;
    }[] = [];

    // Track which artists are covered by actual publisher feeds
    const coveredArtists = new Set<string>();

    // First: add entries from actual publisher feeds (deduplicate by artist name)
    for (const pubFeed of publisherFeeds) {
      const artistName = pubFeed.artist || pubFeed.title;
      if (!artistName) continue;

      const artistKey = artistName.toLowerCase().trim();

      // Skip duplicate publisher feeds for the same artist
      if (coveredArtists.has(artistKey)) {
        // If the existing entry has no image but this feed does, update it
        if (pubFeed.image) {
          const existing = publisherList.find(p => p.title.toLowerCase().trim() === artistKey);
          if (existing && existing.image === '/placeholder-artist.png') {
            existing.image = pubFeed.image;
          }
        }
        continue;
      }

      coveredArtists.add(artistKey);

      // Find matching album feeds by artist name
      const albums = artistAlbums.get(artistKey) || [];
      const trackCount = albums.reduce((sum, album) => sum + album._count.Track, 0);

      // Use publisher feed's image, fall back to most recent album image
      let image = pubFeed.image || '/placeholder-artist.png';
      if (image === '/placeholder-artist.png' && albums.length > 0) {
        const sortedAlbums = [...albums].sort((a, b) =>
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
        );
        image = sortedAlbums.find(a => a.image)?.image || image;
      }

      // Use the oldest album's createdAt, or publisher feed's createdAt
      let dateAdded = pubFeed.createdAt.toISOString();
      if (albums.length > 0) {
        const oldestAlbum = albums.reduce((oldest, album) =>
          new Date(album.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? album : oldest
        );
        dateAdded = oldestAlbum.createdAt.toISOString();
      }

      // Prefer artist name over feed title to avoid "Untitled Feed" display
      const displayTitle = artistName || pubFeed.title || 'Unknown Artist';

      publisherList.push({
        id: pubFeed.id,
        title: displayTitle,
        feedGuid: pubFeed.id,
        originalUrl: pubFeed.originalUrl,
        image,
        description: albums.length > 0
          ? `${albums.length} release${albums.length !== 1 ? 's' : ''}, ${trackCount} tracks`
          : 'Publisher feed',
        albums: [],
        itemCount: albums.length || 1,
        totalTracks: trackCount,
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(displayTitle)}`,
        dateAdded
      });
    }

    // Second: add synthetic entries for artists with 2+ albums but no publisher feed
    for (const [artistKey, albums] of artistAlbums) {
      if (coveredArtists.has(artistKey)) continue;
      if (albums.length <= 1) continue;

      const artistName = albums[0].artist || 'Unknown Artist';
      const trackCount = albums.reduce((sum, album) => sum + album._count.Track, 0);

      // Use the most recent album's image as the publisher image
      const sortedAlbums = albums.sort((a, b) =>
        new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      );
      const image = sortedAlbums.find(a => a.image)?.image || '/placeholder-artist.png';

      // Use the oldest album's createdAt as when the artist first appeared on the site
      const oldestAlbum = albums.reduce((oldest, album) =>
        new Date(album.createdAt).getTime() < new Date(oldest.createdAt).getTime() ? album : oldest
      );
      const dateAdded = oldestAlbum.createdAt.toISOString();

      publisherList.push({
        id: `artist-${artistKey.replace(/\s+/g, '-')}`,
        title: artistName,
        feedGuid: `artist-${artistKey.replace(/\s+/g, '-')}`,
        originalUrl: null,
        image,
        description: `${albums.length} releases, ${trackCount} tracks`,
        albums: [],
        itemCount: albums.length,
        totalTracks: trackCount,
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(artistName)}`,
        dateAdded
      });
    }

    // Sort based on requested sort parameter
    const sortedList = publisherList.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.title.localeCompare(a.title);
        case 'added-desc':
          return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
        case 'added-asc':
          return new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime();
        case 'tracks-desc':
          return b.totalTracks - a.totalTracks;
        case 'tracks-asc':
          return a.totalTracks - b.totalTracks;
        case 'name-asc':
        default:
          return a.title.localeCompare(b.title);
      }
    });

    const total = sortedList.length;
    const paginatedList = sortedList.slice(offset, offset + limit);

    console.log(`✅ Publishers API: Returning ${paginatedList.length}/${total} publishers (offset=${offset}, sort=${sort})`);

    const response = {
      publishers: paginatedList,
      total,
      hasMore: offset + limit < total,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'ETag': `"${Date.now()}"`,
        'Content-Type': 'application/json',
        ...cors,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
    });
  } catch (error) {
    console.error('Unexpected error in publishers API:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
}

export async function OPTIONS() {
  const cors = await corsHeaders();
  return new NextResponse(null, {
    status: 200,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
