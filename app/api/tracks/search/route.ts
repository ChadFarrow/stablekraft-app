import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/tracks/search - Advanced search endpoint
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const type = searchParams.get('type'); // 'all' | 'music' | 'podcast' | 'v4v'
    
    if (!query) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }
    
    // Build search conditions
    const searchConditions = {
      OR: [
        { title: { contains: query, mode: 'insensitive' as const } },
        { artist: { contains: query, mode: 'insensitive' as const } },
        { album: { contains: query, mode: 'insensitive' as const } },
        { description: { contains: query, mode: 'insensitive' as const } },
        { subtitle: { contains: query, mode: 'insensitive' as const } }
      ]
    };
    
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
    const where = {
      AND: [searchConditions, typeFilter]
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
    
    // Group results by category
    const groupedResults = {
      albums: results.filter(t => t.Feed.type === 'album'),
      playlists: results.filter(t => t.Feed.type === 'playlist'),
      podcasts: results.filter(t => t.Feed.type === 'podcast'),
      v4v: results.filter(t => t.v4vValue !== null),
      all: results,
      total: results.length
    };
    
    return NextResponse.json(groupedResults);
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