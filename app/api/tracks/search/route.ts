import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiCache } from '@/lib/api-utils';
import { parseSearchQuery, normalizeQuery, buildFieldFilters } from '@/lib/search-utils';

// Initialize cache instance
const searchCache = new ApiCache();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// GET /api/tracks/search - Advanced search endpoint
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('q');
    const type = searchParams.get('type'); // 'all' | 'music' | 'podcast' | 'v4v'
    
    if (!rawQuery) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    // Normalize and parse query
    const query = normalizeQuery(rawQuery);
    const parsedQuery = parseSearchQuery(query);
    
    // Build cache key
    const cacheKey = `tracks-search:${type}:${query}`;
    
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
    
    // Build search conditions
    const searchConditions = {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { artist: { contains: query, mode: 'insensitive' as const } },
        { album: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
        { subtitle: { contains: query, mode: 'insensitive' as const } },
        // Add keyword and category search
        ...parsedQuery.terms.flatMap(term => [
          { itunesKeywords: { has: term } },
          { itunesCategories: { has: term } }
        ])
      ]
    };

    // Add field filters if any
    const fieldFilters = buildFieldFilters(parsedQuery);
    
    // Add type-specific filters
    let typeFilter = {};
    if (type === 'music') {
      typeFilter = {
        feed: {
          type: { in: ['album', 'playlist'] }
        }
      };
    } else if (type === 'podcast') {
      typeFilter = {
        feed: {
          type: 'podcast'
        }
      };
    } else if (type === 'v4v') {
      typeFilter = {
        v4vValue: { not: null }
      };
    }
    
    // Combine conditions
    const whereConditions: any[] = [searchConditions, typeFilter];
    if (Object.keys(fieldFilters).length > 0) {
      whereConditions.push(fieldFilters);
    }
    const where = {
      AND: whereConditions
    };
    
    // Execute search with limits for performance
    const results = await prisma.track.findMany({
      where,
      take: 100, // Limit results
      orderBy: [
        { publishedAt: 'desc' },
        { title: 'asc' }
      ],
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            type: true,
            image: true
          }
        }
      }
    });

    // Apply relevance-based sorting
    const queryLower = query.toLowerCase();
    results.sort((a, b) => {
      // Title exact match gets highest priority
      const aTitleExact = a.title.toLowerCase() === queryLower ? 1000 : 0;
      const bTitleExact = b.title.toLowerCase() === queryLower ? 1000 : 0;
      
      // Title starts with query
      const aTitleStarts = a.title.toLowerCase().startsWith(queryLower) ? 500 : 0;
      const bTitleStarts = b.title.toLowerCase().startsWith(queryLower) ? 500 : 0;
      
      // Calculate scores
      const aScore = aTitleExact + aTitleStarts;
      const bScore = bTitleExact + bTitleStarts;
      
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      
      // Fall back to publishedAt
      const aTime = a.publishedAt?.getTime() || 0;
      const bTime = b.publishedAt?.getTime() || 0;
      return bTime - aTime;
    });
    
    // Group results by category
    const groupedResults = {
      albums: results.filter(t => t.Feed.type === 'album'),
      playlists: results.filter(t => t.Feed.type === 'playlist'),
      podcasts: results.filter(t => t.Feed.type === 'podcast'),
      v4v: results.filter(t => t.v4vValue !== null),
      all: results,
      total: results.length
    };
    
    // Cache the results
    searchCache.set(cacheKey, groupedResults, CACHE_TTL);
    
    return NextResponse.json(groupedResults, {
      headers: {
        'X-Cache': 'MISS',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (error) {
    console.error('Error searching tracks:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}

// POST /api/tracks/search - Advanced search with filters
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      query,
      filters = {},
      pagination = { page: 1, limit: 50 },
      sorting = { field: 'publishedAt', order: 'desc' }
    } = body;
    
    // Build complex search query
    const where: any = {};
    
    // Text search
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { artist: { contains: query, mode: 'insensitive' } },
        { album: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } }
      ];
    }
    
    // Apply filters
    if (filters.feedIds && filters.feedIds.length > 0) {
      where.feedId = { in: filters.feedIds };
    }
    
    if (filters.artists && filters.artists.length > 0) {
      where.artist = { in: filters.artists };
    }
    
    if (filters.albums && filters.albums.length > 0) {
      where.album = { in: filters.albums };
    }
    
    if (filters.dateFrom || filters.dateTo) {
      where.publishedAt = {};
      if (filters.dateFrom) {
        where.publishedAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        where.publishedAt.lte = new Date(filters.dateTo);
      }
    }
    
    if (filters.durationMin || filters.durationMax) {
      where.duration = {};
      if (filters.durationMin) {
        where.duration.gte = filters.durationMin;
      }
      if (filters.durationMax) {
        where.duration.lte = filters.durationMax;
      }
    }
    
    if (filters.explicit !== undefined) {
      where.explicit = filters.explicit;
    }
    
    if (filters.hasV4V) {
      where.v4vValue = { not: null };
    }
    
    if (filters.hasImage) {
      where.image = { not: null };
    }
    
    // Pagination
    const skip = (pagination.page - 1) * pagination.limit;
    
    // Execute query
    const [tracks, total] = await Promise.all([
      prisma.track.findMany({
        where,
        skip,
        take: pagination.limit,
        orderBy: { [sorting.field]: sorting.order },
        include: {
          Feed: {
            select: {
              id: true,
              title: true,
              artist: true,
              type: true,
              image: true
            }
          }
        }
      }),
      prisma.track.count({ where })
    ]);
    
    // Get aggregations for faceted search
    const [artists, albums] = await Promise.all([
      prisma.track.groupBy({
        by: ['artist'],
        where,
        _count: true,
        orderBy: { _count: { artist: 'desc' } },
        take: 20
      }),
      prisma.track.groupBy({
        by: ['album'],
        where,
        _count: true,
        orderBy: { _count: { album: 'desc' } },
        take: 20
      })
    ]);
    
    return NextResponse.json({
      tracks,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit)
      },
      facets: {
        artists: artists.filter(a => a.artist).map(a => ({
          value: a.artist,
          count: a._count
        })),
        albums: albums.filter(a => a.album).map(a => ({
          value: a.album,
          count: a._count
        }))
      }
    });
  } catch (error) {
    console.error('Error in advanced search:', error);
    return NextResponse.json(
      { error: 'Advanced search failed' },
      { status: 500 }
    );
  }
}