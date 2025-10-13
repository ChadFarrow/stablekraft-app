import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() || '';
    const limit = parseInt(searchParams.get('limit') || '50');
    const type = searchParams.get('type') || 'all'; // all, tracks, albums, artists

    if (!query || query.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'Search query must be at least 2 characters',
        results: {
          tracks: [],
          albums: [],
          artists: []
        }
      }, { status: 400 });
    }

    console.log(`🔍 Search request: query="${query}", type="${type}", limit=${limit}`);

    // Prepare search term for case-insensitive matching
    const searchTerm = `%${query.toLowerCase()}%`;

    let results: any = {
      tracks: [],
      albums: [],
      artists: []
    };

    // Search tracks
    if (type === 'all' || type === 'tracks') {
      const tracks = await prisma.track.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { artist: { contains: query, mode: 'insensitive' } },
            { album: { contains: query, mode: 'insensitive' } },
            { subtitle: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: {
          Feed: {
            select: {
              title: true,
              artist: true,
              image: true
            }
          }
        },
        take: limit,
        orderBy: [
          { publishedAt: 'desc' }
        ]
      });

      results.tracks = tracks.map(track => ({
        id: track.id,
        title: track.title,
        artist: track.artist || track.Feed.artist,
        album: track.album,
        subtitle: track.subtitle,
        image: track.image || track.itunesImage || track.Feed.image,
        audioUrl: track.audioUrl,
        duration: track.duration,
        publishedAt: track.publishedAt,
        v4vRecipient: track.v4vRecipient,
        v4vValue: track.v4vValue,
        guid: track.guid,
        feedId: track.feedId,
        feedTitle: track.Feed.title
      }));
    }

    // Search albums (grouped by Feed)
    if (type === 'all' || type === 'albums') {
      const albums = await prisma.feed.findMany({
        where: {
          AND: [
            { status: 'active' },
            {
              OR: [
                { title: { contains: query, mode: 'insensitive' } },
                { artist: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } }
              ]
            }
          ]
        },
        include: {
          Track: {
            take: 1,
            orderBy: { trackOrder: 'asc' }
          }
        },
        take: limit,
        orderBy: [
          { updatedAt: 'desc' }
        ]
      });

      // Get track counts for each album
      const albumsWithCounts = await Promise.all(
        albums.map(async (album) => {
          const trackCount = await prisma.track.count({
            where: { feedId: album.id }
          });

          return {
            id: album.id,
            title: album.title,
            artist: album.artist,
            description: album.description,
            coverArt: album.image,
            type: album.type,
            totalTracks: trackCount,
            feedUrl: album.originalUrl,
            feedGuid: album.id,
            v4vRecipient: album.v4vRecipient,
            v4vValue: album.v4vValue,
            updatedAt: album.updatedAt
          };
        })
      );

      results.albums = albumsWithCounts;
    }

    // Search artists/publishers (unique artists from Feed)
    if (type === 'all' || type === 'artists') {
      const artists = await prisma.feed.findMany({
        where: {
          AND: [
            { status: 'active' },
            { artist: { contains: query, mode: 'insensitive' } }
          ]
        },
        select: {
          id: true,
          title: true,
          artist: true,
          image: true,
          description: true
        },
        distinct: ['artist'],
        take: limit,
        orderBy: [
          { artist: 'asc' }
        ]
      });

      // Get album counts for each artist
      const artistsWithCounts = await Promise.all(
        artists.map(async (artist) => {
          const albumCount = await prisma.feed.count({
            where: {
              artist: artist.artist,
              status: 'active'
            }
          });

          const trackCount = await prisma.track.count({
            where: {
              Feed: {
                artist: artist.artist,
                status: 'active'
              }
            }
          });

          return {
            name: artist.artist,
            image: artist.image,
            albumCount,
            totalTracks: trackCount,
            feedGuid: artist.id
          };
        })
      );

      results.artists = artistsWithCounts.filter(a => a.name);
    }

    // Calculate total results
    const totalResults =
      results.tracks.length +
      results.albums.length +
      results.artists.length;

    console.log(`✅ Search results: ${results.tracks.length} tracks, ${results.albums.length} albums, ${results.artists.length} artists`);

    return NextResponse.json({
      success: true,
      query,
      totalResults,
      results
    });

  } catch (error) {
    console.error('❌ Search API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to perform search',
      results: {
        tracks: [],
        albums: [],
        artists: []
      }
    }, { status: 500 });
  }
}
