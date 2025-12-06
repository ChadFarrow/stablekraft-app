import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ApiCache } from '@/lib/api-utils';
import { parseSearchQuery, buildTsQuery, normalizeQuery, buildFieldFilters } from '@/lib/search-utils';
import { fuzzySearchTracks, fuzzySearchAlbums, fuzzySearchArtists, calculateThreshold } from '@/lib/fuzzy-search';

const prisma = new PrismaClient();

// Initialize cache instance
const searchCache = new ApiCache();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Build full-text search WHERE clause using PostgreSQL ts_rank
 */
function buildFullTextSearchWhere(normalizedQuery: string, fieldFilters: Record<string, any>) {
  // For tracks: use searchVector if populated, otherwise fall back to contains
  // We'll use raw SQL for full-text search when searchVector exists
  
  // Build field filters if any
  const andConditions: any[] = [];

  // Add field-specific filters
  Object.entries(fieldFilters).forEach(([field, condition]) => {
    andConditions.push({ [field]: condition });
  });

  return { andConditions };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const QUERY_TIMEOUT = 10000; // 10 seconds timeout
  
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('q')?.trim() || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200); // Max 200 results
    const type = searchParams.get('type') || 'all'; // all, tracks, albums, artists
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const offset = (page - 1) * limit;
    const fuzzy = searchParams.get('fuzzy') !== 'false'; // Default to true

    // Early return for empty query
    if (!rawQuery || rawQuery.length < 2) {
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

    // Normalize and parse query
    const query = normalizeQuery(rawQuery);
    const parsedQuery = parseSearchQuery(query);
    
    // Build cache key (include page for pagination and fuzzy mode)
    const cacheKey = `search:${type}:${limit}:${page}:${fuzzy}:${query}`;
    
    // Check cache
    const cached = searchCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
          'Cache-Control': 'public, max-age=300'
        }
      });
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(`🔍 Search request: query="${query}", type="${type}", limit=${limit}`);
    }

    const fieldFilters = buildFieldFilters(parsedQuery);
    const tsQuery = buildTsQuery(parsedQuery);

    let results: any = {
      tracks: [],
      albums: [],
      artists: []
    };

    // Search tracks
    if (type === 'all' || type === 'tracks') {
      if (fuzzy) {
        // Use fuzzy search with trigram similarity
        const fuzzyTracks = await fuzzySearchTracks({
          query,
          limit,
          offset
        });

        results.tracks = fuzzyTracks.map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          image: track.image || track.feedImage,
          audioUrl: track.audioUrl,
          duration: track.duration,
          publishedAt: track.publishedAt,
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          guid: track.guid,
          feedId: track.feedId,
          feedTitle: track.feedTitle,
          similarity: track.similarity
        }));
      } else {
        // Fallback to exact match search (original ILIKE behavior)
        const whereConditions: any[] = [];
        const hasTitleArtistPattern = fieldFilters.title && fieldFilters.artist;

        if (hasTitleArtistPattern) {
          whereConditions.push({
            AND: [
              { title: { contains: parsedQuery.fieldFilters.title?.[0] || '', mode: 'insensitive' } },
              { artist: { contains: parsedQuery.fieldFilters.artist?.[0] || '', mode: 'insensitive' } }
            ]
          });
        } else {
          const primarySearchConditions: any[] = [
            { title: { contains: query, mode: 'insensitive' } },
            { artist: { contains: query, mode: 'insensitive' } }
          ];

          if (query.length >= 4) {
            primarySearchConditions.push(
              { album: { contains: query, mode: 'insensitive' } },
              { subtitle: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } }
            );
          }

          whereConditions.push({ OR: primarySearchConditions });

          if (Object.keys(fieldFilters).length > 0) {
            whereConditions.push(fieldFilters);
          }
        }

        const tracks = await prisma.track.findMany({
          where: {
            AND: [
              ...whereConditions,
              { feedId: { notIn: ['lnurl-testing-podcast', 'lnurl-test-feed'] } }
            ]
          },
          include: {
            Feed: {
              select: { title: true, artist: true, image: true }
            }
          },
          skip: offset,
          take: limit,
          orderBy: [{ publishedAt: 'desc' }]
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
    }

    // Search albums (grouped by Feed)
    if (type === 'all' || type === 'albums') {
      if (fuzzy) {
        // Use fuzzy search with trigram similarity
        const fuzzyAlbums = await fuzzySearchAlbums({
          query,
          limit,
          offset
        });

        results.albums = fuzzyAlbums.map(album => ({
          id: album.id,
          title: album.title,
          artist: album.artist,
          description: album.description,
          coverArt: album.coverArt,
          type: album.type,
          totalTracks: Number(album.totalTracks),
          feedUrl: album.feedUrl,
          feedGuid: album.id,
          similarity: album.similarity
        }));
      } else {
        // Fallback to exact match search
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
          orderBy: [{ updatedAt: 'desc' }]
        });

        // Filter out Bowl After Bowl podcast content (but keep Bowl Covers) and test feeds
        const filteredAlbums = albums.filter(album => {
          // Exclude test feeds
          if (album.id === 'lnurl-testing-podcast' || album.id === 'lnurl-test-feed') {
            return false;
          }

          const albumTitle = album.title?.toLowerCase() || '';
          const albumArtist = album.artist?.toLowerCase() || '';
          const feedUrl = album.originalUrl?.toLowerCase() || '';

          if (album.id === 'bowl-covers' || albumTitle.includes('bowl covers')) {
            return true;
          }

          const isBowlAfterBowlPodcast = (
            (albumTitle.includes('bowl after bowl') && !albumTitle.includes('covers')) ||
            (albumArtist.includes('bowl after bowl') && !albumTitle.includes('covers')) ||
            (feedUrl.includes('bowlafterbowl.com') && !albumTitle.includes('covers') && album.id !== 'bowl-covers')
          );

          return !isBowlAfterBowlPodcast;
        });

        const albumsWithCounts = await Promise.all(
          filteredAlbums.map(async (album) => {
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
    }

    // Search artists/publishers (unique artists from Feed)
    if (type === 'all' || type === 'artists') {
      if (fuzzy) {
        // Use fuzzy search with trigram similarity
        const fuzzyArtists = await fuzzySearchArtists({
          query,
          limit,
          offset
        });

        results.artists = fuzzyArtists.map(artist => ({
          name: artist.name,
          image: artist.image,
          albumCount: Number(artist.albumCount),
          totalTracks: Number(artist.totalTracks),
          feedGuid: artist.feedGuid,
          similarity: artist.similarity
        }));
      } else {
        // Fallback to exact match search
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
          orderBy: [{ artist: 'asc' }]
        });

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
    }

    // Calculate total results
    const totalResults =
      results.tracks.length +
      results.albums.length +
      results.artists.length;

    // Check query timeout
    const queryTime = Date.now() - startTime;
    if (queryTime > QUERY_TIMEOUT) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⚠️ Search query took ${queryTime}ms (exceeded ${QUERY_TIMEOUT}ms timeout)`);
      }
    }

    const responseData = {
      success: true,
      query,
      totalResults,
      pagination: {
        page,
        limit,
        total: totalResults,
        totalPages: Math.ceil(totalResults / limit),
        hasMore: (page * limit) < totalResults
      },
      results,
      queryTime: queryTime
    };

    // Cache the results
    searchCache.set(cacheKey, responseData, CACHE_TTL);

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Search results: ${results.tracks.length} tracks, ${results.albums.length} albums, ${results.artists.length} artists (${queryTime}ms)`);
    }

    return NextResponse.json(responseData, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=300',
        'X-Query-Time': queryTime.toString()
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('❌ Search API error:', error);
    }
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
