import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

export async function GET() {
  try {
    console.log('🔍 Publishers API: Loading publishers from database');

    // Get all publisher feeds
    const publishers = await prisma.feed.findMany({
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
      },
      orderBy: {
        title: 'asc'
      }
    });

    // Get all album feeds with track counts and images (for matching by artist name)
    const albumFeeds = await prisma.feed.findMany({
      where: {
        type: { in: ['album', 'music'] },
        status: 'active'
      },
      select: {
        id: true,
        title: true,
        artist: true,
        image: true,
        updatedAt: true,
        _count: {
          select: { Track: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    // Fetch all albums with publisherId in a single query (fixes N+1 query issue)
    const albumsWithPublisherId = await prisma.feed.findMany({
      where: {
        publisherId: { not: null },
        type: { in: ['album', 'music'] },
        status: 'active'
      },
      select: {
        id: true,
        image: true,
        publisherId: true,
        _count: { select: { Track: true } }
      }
    });

    // Group albums by publisherId for fast lookup
    const albumsByPublisherId = new Map<string, typeof albumsWithPublisherId>();
    for (const album of albumsWithPublisherId) {
      if (album.publisherId) {
        const existing = albumsByPublisherId.get(album.publisherId) || [];
        existing.push(album);
        albumsByPublisherId.set(album.publisherId, existing);
      }
    }

    console.log(`📊 Found ${publishers.length} publishers, ${albumFeeds.length} album feeds, ${albumsWithPublisherId.length} linked albums`);

    // Transform to the expected format, counting albums by artist name match AND publisherId relationship
    const publisherList = publishers.map(publisher => {
      const publisherArtist = (publisher.artist || publisher.title)?.toLowerCase();

      // Find albums that match this publisher by artist name
      // Matches exact name OR albums where artist starts with publisher name (for "Artist w/ Featured" cases)
      const matchingAlbums = albumFeeds.filter(album => {
        const albumArtist = album.artist?.toLowerCase();
        if (!publisherArtist || !albumArtist) return false;
        // Exact match
        if (publisherArtist === albumArtist) return true;
        // StartsWith match for "Artist w/ Featured" or "Artist & Band" patterns
        if (albumArtist.startsWith(publisherArtist + ' ')) return true;
        return false;
      });

      // Only count albums that have tracks
      const albumsWithTracks = matchingAlbums.filter(a => a._count.Track > 0);
      let albumCount = albumsWithTracks.length;
      let trackCount = albumsWithTracks.reduce((sum, album) => sum + album._count.Track, 0);

      // Also count albums linked via publisherId (using pre-fetched data instead of N+1 query)
      const linkedAlbums = albumsByPublisherId.get(publisher.id) || [];

      // Use the higher count (artist matching vs publisherId linking)
      if (linkedAlbums.length > albumCount) {
        albumCount = linkedAlbums.length;
        trackCount = linkedAlbums.reduce((sum, album) => sum + album._count.Track, 0);
      }

      // Use publisher image, or fallback to first album's cover art
      const albumCover = albumsWithTracks.find(a => a.image)?.image;
      const image = publisher.image || albumCover || '/placeholder-artist.png';

      return {
        id: publisher.id,
        title: publisher.title || 'Unknown Publisher',
        feedGuid: publisher.id,
        originalUrl: publisher.originalUrl,
        image,
        description: publisher.description || `Publisher with ${albumCount} releases`,
        albums: [],
        itemCount: albumCount,
        totalTracks: trackCount,
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(publisher.title || publisher.id)}`
      };
    });

    // Filter out publishers with 0-1 releases
    const filteredPublisherList = publisherList.filter(publisher => publisher.itemCount > 1);

    // Deduplicate publishers by title (keep the one with more releases)
    const seenTitles = new Map<string, typeof filteredPublisherList[0]>();
    for (const publisher of filteredPublisherList) {
      const key = publisher.title.toLowerCase();
      const existing = seenTitles.get(key);
      if (!existing || publisher.itemCount > existing.itemCount) {
        seenTitles.set(key, publisher);
      }
    }
    const deduplicatedList = Array.from(seenTitles.values())
      .sort((a, b) => a.title.localeCompare(b.title));

    console.log(`✅ Publishers API: Returning ${deduplicatedList.length} publishers (from ${publishers.length} total, ${filteredPublisherList.length} with releases)`);

    const response = {
      publishers: deduplicatedList,
      total: deduplicatedList.length,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'ETag': `"${Date.now()}"`,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
