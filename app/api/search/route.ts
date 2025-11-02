import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { ApiCache } from '@/lib/api-utils';
import { parseSearchQuery, buildTsQuery, normalizeQuery, buildFieldFilters } from '@/lib/search-utils';

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
    
    // Build cache key (include page for pagination)
    const cacheKey = `search:${type}:${limit}:${page}:${query}`;
    
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

    // Search tracks with full-text search
    if (type === 'all' || type === 'tracks') {
      // Build WHERE conditions
      const whereConditions: any[] = [];

      // Check if we have a natural language "X by Y" pattern (both title and artist in fieldFilters)
      const hasTitleArtistPattern = fieldFilters.title && fieldFilters.artist;

      if (hasTitleArtistPattern) {
        // For "X by Y" pattern, require both title AND artist to match
        whereConditions.push({
          AND: [
            { title: { contains: fieldFilters.title[0], mode: 'insensitive' } },
            { artist: { contains: fieldFilters.artist[0], mode: 'insensitive' } }
          ]
        });

        // Add other field filters (like album:xxx) if any
        Object.entries(fieldFilters).forEach(([field, values]) => {
          if (field !== 'title' && field !== 'artist') {
            if (values.length === 1) {
              whereConditions.push({ [field]: { contains: values[0], mode: 'insensitive' } });
            } else {
              whereConditions.push({
                OR: values.map(v => ({ [field]: { contains: v, mode: 'insensitive' } }))
              });
            }
          }
        });
      } else {
        // Default behavior: OR conditions across all fields
        const textSearchConditions: any[] = [
          { title: { contains: query, mode: 'insensitive' } },
          { artist: { contains: query, mode: 'insensitive' } },
          { album: { contains: query, mode: 'insensitive' } },
          { subtitle: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } }
        ];

        // Add keyword and category search
        parsedQuery.terms.forEach(term => {
          textSearchConditions.push({
            itunesKeywords: { has: term }
          });
          textSearchConditions.push({
            itunesCategories: { has: term }
          });
        });

        whereConditions.push({ OR: textSearchConditions });

        // Add field filters if any
        if (Object.keys(fieldFilters).length > 0) {
          whereConditions.push(fieldFilters);
        }
      }

      // Use hybrid search: full-text search when searchVector exists, otherwise use contains
      // For now, use Prisma's contains search which works well with indexes
      // Full-text search will be enabled when searchVector is populated via migration
      
      let tracks = await prisma.track.findMany({
        where: {
          AND: whereConditions
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
        skip: offset,
        take: limit,
        orderBy: [
          // Prioritize title matches, then artist, then album, then by recency
          { publishedAt: 'desc' }
        ]
      });

      // Apply relevance-based sorting in memory
      // Boost exact matches in title
      tracks.sort((a, b) => {
        const queryLower = query.toLowerCase();
        
        // If we have a title+artist pattern, prioritize exact matches
        if (hasTitleArtistPattern) {
          const titlePart = fieldFilters.title[0].toLowerCase();
          const artistPart = fieldFilters.artist[0].toLowerCase();
          
          const aTitleMatch = a.title?.toLowerCase().includes(titlePart) || false;
          const aArtistMatch = a.artist?.toLowerCase().includes(artistPart) || false;
          const bTitleMatch = b.title?.toLowerCase().includes(titlePart) || false;
          const bArtistMatch = b.artist?.toLowerCase().includes(artistPart) || false;
          
          // Both title and artist match (highest priority)
          const aBothMatch = aTitleMatch && aArtistMatch ? 2000 : 0;
          const bBothMatch = bTitleMatch && bArtistMatch ? 2000 : 0;
          
          // Title exact match
          const aTitleExact = a.title?.toLowerCase() === titlePart ? 500 : 0;
          const bTitleExact = b.title?.toLowerCase() === titlePart ? 500 : 0;
          
          // Artist exact match
          const aArtistExact = a.artist?.toLowerCase() === artistPart ? 300 : 0;
          const bArtistExact = b.artist?.toLowerCase() === artistPart ? 300 : 0;
          
          // Title starts with
          const aTitleStarts = a.title?.toLowerCase().startsWith(titlePart) ? 100 : 0;
          const bTitleStarts = b.title?.toLowerCase().startsWith(titlePart) ? 100 : 0;
          
          // Calculate scores
          const aScore = aBothMatch + aTitleExact + aArtistExact + aTitleStarts;
          const bScore = bBothMatch + bTitleExact + bArtistExact + bTitleStarts;
          
          if (aScore !== bScore) {
            return bScore - aScore; // Higher score first
          }
        } else {
          // Default sorting logic for non-pattern queries
          // Title exact match gets highest priority
          const aTitleExact = a.title.toLowerCase() === queryLower ? 1000 : 0;
          const bTitleExact = b.title.toLowerCase() === queryLower ? 1000 : 0;
          
          // Title starts with query
          const aTitleStarts = a.title.toLowerCase().startsWith(queryLower) ? 500 : 0;
          const bTitleStarts = b.title.toLowerCase().startsWith(queryLower) ? 500 : 0;
          
          // Title contains query
          const aTitleContains = a.title.toLowerCase().includes(queryLower) ? 100 : 0;
          const bTitleContains = b.title.toLowerCase().includes(queryLower) ? 100 : 0;
          
          // Artist match
          const aArtistMatch = a.artist?.toLowerCase().includes(queryLower) ? 50 : 0;
          const bArtistMatch = b.artist?.toLowerCase().includes(queryLower) ? 50 : 0;
          
          // Calculate scores
          const aScore = aTitleExact + aTitleStarts + aTitleContains + aArtistMatch;
          const bScore = bTitleExact + bTitleStarts + bTitleContains + bArtistMatch;
          
          if (aScore !== bScore) {
            return bScore - aScore; // Higher score first
          }
        }
        
        // Fall back to recency
        const aTime = a.publishedAt?.getTime() || 0;
        const bTime = b.publishedAt?.getTime() || 0;
        return bTime - aTime;
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
