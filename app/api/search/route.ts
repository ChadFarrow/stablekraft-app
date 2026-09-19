import { NextRequest, NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { createRouteLimiter, enforceRateLimit } from '@/lib/rate-limit-guard';
import { PrismaClient } from '@prisma/client';
import { parseSearchQuery, buildTsQuery, normalizeQuery, buildFieldFilters } from '@/lib/search-utils';
import { fuzzySearchTracks, fuzzySearchAlbums, fuzzySearchArtists, calculateThreshold } from '@/lib/fuzzy-search';
import { searchPlaylists, getPlaylistUrls, getAllPlaylistIds } from '@/lib/playlist/configs';
import { getBlacklistedFeedIds, BLACKLISTED_FEED_URLS, isHenrikFlymanWavlakeMirror } from '@/lib/feed-exclusions';
import { CACHE_TTL, getSearchCache } from '@/lib/caches/search-cache';

const prisma = new PrismaClient();

const searchCache = getSearchCache();

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

/**
 * Per-IP ceiling on this route. Module scope so the buckets survive between
 * requests. Log-only until RATE_LIMIT_MODE=enforce — see lib/rate-limit-guard.ts.
 */
const limiter = createRouteLimiter(60);

export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(limiter, request.headers, 'search');
  if (limited) return limited;

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
          artists: [],
          playlists: []
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
      return compressedJson(request, cached, {
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
      artists: [],
      playlists: [],
      podcasts: []
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
              { feedId: { notIn: ['lnurl-testing-podcast', 'lnurl-test-feed', 'podtards-test'] } }
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
        const playlistUrls = getPlaylistUrls();
        const playlistIds = getAllPlaylistIds();
        const blacklistedIds = getBlacklistedFeedIds();
        const albums = await prisma.feed.findMany({
          where: {
            AND: [
              { status: 'active' },
              { markedDead: false },
              { type: { not: 'publisher' } },
              { originalUrl: { notIn: [...playlistUrls, ...BLACKLISTED_FEED_URLS] } },
              { id: { notIn: [...playlistIds, ...blacklistedIds] } },
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
            },
            _count: {
              select: { Track: true }
            }
          },
          take: limit,
          orderBy: [{ updatedAt: 'desc' }]
        });

        // Filter out Bowl After Bowl podcast content (but keep Bowl Covers) and test feeds
        const filteredAlbums = albums.filter(album => {
          // Exclude test feeds
          if (album.id === 'lnurl-testing-podcast' || album.id === 'lnurl-test-feed' || album.id === 'podtards-test') {
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

          // Henrik Flyman's Wavlake mirrors are dead (he self-hosts now).
          if (isHenrikFlymanWavlakeMirror({ artist: album.artist, feedUrl: album.originalUrl })) {
            return false;
          }

          return !isBowlAfterBowlPodcast;
        });

        const albumsWithCounts = filteredAlbums.map((album) => ({
          id: album.id,
          title: album.title,
          artist: album.artist,
          description: album.description,
          coverArt: album.image,
          type: album.type,
          totalTracks: album._count.Track,
          feedUrl: album.originalUrl,
          feedGuid: album.id,
          v4vRecipient: album.v4vRecipient,
          v4vValue: album.v4vValue,
          updatedAt: album.updatedAt
        }));

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
        // Fallback to exact match search with case-insensitive grouping
        // Use raw SQL to GROUP BY LOWER(artist) to avoid duplicates like "eardiod" vs "Eardiod"
        const searchPattern = `%${query}%`;
        const artistResults = await prisma.$queryRaw<Array<{
          name: string;
          image: string | null;
          feedGuid: string;
          albumCount: bigint;
          totalTracks: bigint;
        }>>`
          SELECT
            MAX(f.artist) as name,
            MIN(f.image) as image,
            MIN(f.id) as "feedGuid",
            COUNT(DISTINCT f.id) as "albumCount",
            COALESCE(SUM(tc.track_count), 0) as "totalTracks"
          FROM "Feed" f
          LEFT JOIN (
            SELECT "feedId", COUNT(*) as track_count
            FROM "Track"
            GROUP BY "feedId"
          ) tc ON tc."feedId" = f.id
          WHERE f.status = 'active'
            AND f."markedDead" = false
            AND f.artist IS NOT NULL
            AND f.artist ILIKE ${searchPattern}
          GROUP BY LOWER(f.artist)
          ORDER BY MAX(f.artist) ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

        results.artists = artistResults.map(artist => ({
          name: artist.name,
          image: artist.image,
          albumCount: Number(artist.albumCount),
          totalTracks: Number(artist.totalTracks),
          feedGuid: artist.feedGuid
        }));
      }
    }

    // Search playlists (in-memory, fast)
    if (type === 'all' || type === 'playlists') {
      results.playlists = searchPlaylists(query).map(p => ({
        id: p.id,
        name: p.name,
        shortName: p.shortName,
        playlistUrl: p.playlistUrl,
        description: p.description
      }));
    }

    // Search podcasts (all feeds with type='podcast')
    if (type === 'all' || type === 'podcasts') {
      const podcastFeeds = await prisma.feed.findMany({
        where: {
          status: 'active',
          type: 'podcast',
          markedDead: false,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { artist: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } }
          ]
        },
        include: {
          _count: { select: { Track: true } }
        },
        take: limit
      });

      results.podcasts = podcastFeeds.map(feed => ({
        id: feed.id,
        title: feed.title,
        artist: feed.artist,
        description: feed.description,
        coverArt: feed.image,
        type: 'podcast',
        totalTracks: feed._count.Track,
        feedUrl: feed.originalUrl,
        feedGuid: feed.guid || feed.id
      }));
    }

    // Calculate total results
    const totalResults =
      results.tracks.length +
      results.albums.length +
      results.artists.length +
      results.playlists.length +
      results.podcasts.length;

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
      console.log(`✅ Search results: ${results.tracks.length} tracks, ${results.albums.length} albums, ${results.artists.length} artists, ${results.playlists.length} playlists (${queryTime}ms)`);
    }

    return compressedJson(request, responseData, {
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
        artists: [],
        playlists: [],
        podcasts: []
      }
    }, { status: 500 });
  }
}
