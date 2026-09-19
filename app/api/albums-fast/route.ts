import { NextResponse } from 'next/server';
import { isForceRefresh } from '@/lib/admin-route-policy';
import { compressedJson } from '@/lib/compressed-json';
import { createRouteLimiter, enforceRateLimit } from '@/lib/rate-limit-guard';
import { albumFeedSelect, feedToAlbum } from '@/lib/catalog/album-shape';
import { prisma } from '@/lib/prisma';
import { getPlaylistUrls, getAllPlaylistIds } from '@/lib/playlist/configs';
import { getBlacklistedFeedIds, BLACKLISTED_FEED_URLS, isBowlAfterBowlPodcastEntry, isHenrikFlymanWavlakeMirror } from '@/lib/feed-exclusions';
import {
  PLAYLIST_CACHE_DURATION,
  albumsFastCatalog,
  albumsFastPodcasts,
  getAlbumsFastPlaylistCache,
  invalidateAlbumsFastCache,
  type CachedData,
  type FeedWithTracks,
} from '@/lib/caches/albums-fast-cache';

/** Most albums have fewer than this; the full list comes from /api/albums/[slug]. */
const ALBUM_TRACK_LIMIT = 20;

/** Enough newest episodes to render a podcast card. The detail page fetches the rest. */
const PODCAST_EPISODE_LIMIT = 20;

const cache = getAlbumsFastPlaylistCache();

// publisher-stats.json is baked into the build (public/), so parse it once per
// process instead of hitting the filesystem on every DB-cache miss.
let publisherStatsCache: any[] | null = null;

function loadPublisherStats(): any[] {
  if (publisherStatsCache !== null) {
    return publisherStatsCache;
  }
  let stats: any[] = [];
  try {
    const fs = require('fs');
    const path = require('path');
    const publisherDataPath = path.join(process.cwd(), 'public', 'publisher-stats.json');

    if (fs.existsSync(publisherDataPath)) {
      const publisherData = JSON.parse(fs.readFileSync(publisherDataPath, 'utf8'));
      stats = publisherData.publishers || [];
      if (process.env.NODE_ENV === 'development') {
        console.log(`📊 Loaded ${stats.length} publisher feeds from publisher-stats.json`);
      }
    } else if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ No publisher-stats.json found, using empty publisher stats');
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('❌ Error loading publisher stats:', error);
    }
  }
  publisherStatsCache = stats;
  return stats;
}

// Function to get playlist albums
async function getPlaylistAlbums() {
  try {
    const now = Date.now();
    
    // Check if we have cached playlist data and it's still fresh
    if (cache.playlistData && (now - cache.playlistTimestamp) < PLAYLIST_CACHE_DURATION) {
      if (process.env.NODE_ENV === 'development') {
        console.log('⚡ Using cached playlist data');
      }
      return cache.playlistData;
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Fetching playlist data in parallel...');
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
    const playlists = [
      'upbeats', 'b4ts', 'hgh', 'itdv', 'iam',
      'flowgnar', 'mmm', 'mmt', 'sas'
    ];

    // Fetch all playlists in parallel for better performance
    const results = await Promise.allSettled(
      playlists.map(async (playlist) => {
        const response = await fetch(`${baseUrl}/api/playlist/${playlist}`, {
          next: { revalidate: 300 } // Cache for 5 minutes
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${playlist}`);
        }

        const data = await response.json();
        if (data.success && data.albums && data.albums.length > 0) {
          return data.albums[0];
        }
        return null;
      })
    );

    // Extract successful results
    const playlistAlbums = results
      .filter((result) => result.status === 'fulfilled' && result.value !== null)
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    
    // Cache the results
    cache.playlistData = playlistAlbums;
    cache.playlistTimestamp = now;

    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ Cached ${playlistAlbums.length} playlists for fast access`);
    }
    return playlistAlbums;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching playlist albums:', error);
    }
    return cache.playlistData || []; // Return cached data if available, empty array otherwise
  }
}

/**
 * Per-IP ceiling on this route. Module scope so the buckets survive between
 * requests. Log-only until RATE_LIMIT_MODE=enforce — see lib/rate-limit-guard.ts.
 */
const limiter = createRouteLimiter(120);

/**
 * The full catalog read behind `albumsFastCatalog`: every active feed, sorted as
 * the grid wants it, with up to ALBUM_TRACK_LIMIT tracks each. Filtering, sorting
 * and pagination all happen in JavaScript on this one cached result, so the query
 * never varies with the request.
 */
async function loadCatalog(): Promise<CachedData> {
  const feeds = await prisma.feed.findMany({
    where: { status: 'active', markedDead: false },
    // Shared shape — this select was written out twice in this file and a
    // third time in /api/feeds/recent. See lib/catalog/album-shape.ts.
    select: albumFeedSelect(ALBUM_TRACK_LIMIT),
    orderBy: [
      { priority: 'asc' },
      { createdAt: 'desc' }
    ]
  }) as FeedWithTracks[];
  // Publisher stats come from the pre-built publisher data file: actual
  // publisher feeds (podcast:publisher references), not individual albums.
  return { feeds, publisherStats: loadPublisherStats() };
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(limiter, request.headers, 'albums-fast');
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const filter = searchParams.get('filter') || 'all'; // albums, eps, singles, all
    const sort = searchParams.get('sort') || 'default'; // Sort order: name-asc, added-desc, year-desc, etc.
    const forceRefresh = isForceRefresh(searchParams); // Admin-gated in middleware

    // Clear cache if refresh requested
    if (forceRefresh) {
      invalidateAlbumsFastCache();
      console.log('🔄 Cache cleared due to refresh=true parameter');
    }

    // Redirect publisher filter requests to the publishers API
    if (filter === 'publishers') {
      if (process.env.NODE_ENV === 'development') {
        console.log(`🚫 albums-fast: Rejecting ${filter} filter - should use /api/publishers instead`);
      }
      return NextResponse.json({
        albums: [],
        totalCount: 0,
        hasMore: false,
        offset: 0,
        limit: 0,
        publisherStats: [],
        lastUpdated: new Date().toISOString(),
        message: `Use /api/publishers for ${filter} data`
      });
    }
    
    const now = Date.now();

    // Started HERE, awaited far below. It is independent of the feed load, but
    // it used to be awaited after it — so on a cache miss the two round-trips
    // were strictly serial, and on a cache HIT this one was still the only
    // thing the request waited on. Deliberately not cached (see its note at the
    // await): it has to react to a PATCH flag flip without waiting out the
    // 15-minute feeds cache.
    const msoPublishersPromise = prisma.feed.findMany({
      where: { type: 'publisher', musicShowOnly: true },
      select: { artist: true, title: true },
    });
    // If the feed load below throws before we reach the await, this promise
    // would reject with nobody listening. The no-op handler marks it handled;
    // the error still surfaces at the await site, where the outer try/catch
    // takes it. Standard idiom for a deliberately-early-started promise.
    msoPublishersPromise.catch(() => {});

    // Served from memory; Postgres is asked only for a fingerprint every 15 minutes,
    // and re-read in full only when that changes (or every 6 hours). See
    // lib/caches/fingerprinted-cache.ts for why — this rebuild was most of the
    // database's billed egress. Concurrent requests share one load.
    const { feeds, publisherStats } = await albumsFastCatalog.get(loadCatalog);
    const catalogBuiltAt = albumsFastCatalog.builtAt();

    // Transform feeds into album format for frontend.
    // API contract for sort/display: releaseDate = album release (oldest track date when available); dateAdded = when feed was added to site.
    // Run POST /api/admin/backfill-oldest-pubdate to backfill oldestItemPubdate so "Year" sort uses real release dates.
    const albums = feeds.map((feed: FeedWithTracks) =>
      // Shared mapper — this object literal was written out seven times across
      // the repo, and one copy had already drifted: app/publisher/[id]/page.tsx
      // used `lastFetched` (the last POLL time) as the release date.
      feedToAlbum(feed, { dedupeTracks: true })
    );
    
    // Filter out Bowl After Bowl podcast (mis-imported as type='album') but keep
    // Bowl Covers (legit music). Shared helper keeps /api/feeds/recent in sync.
    const podcastFilteredAlbums = albums.filter(album => {
      const isBab = isBowlAfterBowlPodcastEntry({
        id: album.id,
        title: album.title,
        artist: album.artist,
        feedUrl: album.feedUrl,
      });
      if (isBab && process.env.NODE_ENV === 'development') {
        console.log(`🚫 Filtering out Bowl After Bowl podcast: ${album.title} by ${album.artist}`);
      }
      return !isBab;
    });

    // Filter out unresolved feed GUID placeholders - these have no usable data
    const unresolvedFilteredAlbums = podcastFilteredAlbums.filter(album => {
      const albumTitle = album.title?.toLowerCase() || '';

      // Filter out unresolved feed GUID placeholders
      if (albumTitle.startsWith('unresolved-feed-guid-')) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`🚫 Filtering out unresolved feed GUID: ${album.title}`);
        }
        return false;
      }

      return true;
    });

    // Music-show-only artist gate. The MSO flag means "don't show this
    // artist's albums in catalog views, but keep tracks reachable via
    // any curated music show that played them." Curated playlists pull
    // from SystemPlaylistTrack and don't go through albums-fast, so
    // hiding album feeds here doesn't break playlist playback. Match the
    // artist-key shape used by the publisher-album cron (artist || title,
    // case-insensitive trim) so orphan albums (publisherId=null) are
    // caught alongside linked ones. Query runs every request — small
    // enough (<100 publishers typically), and we need it to react to
    // PATCH flag flips without waiting on the 15-min feeds cache.
    // It is STARTED near the top of the handler so it overlaps the feed load
    // instead of following it.
    const msoPublishers = await msoPublishersPromise;
    const msoArtistKeys = new Set<string>();
    for (const p of msoPublishers) {
      const key = (p.artist || p.title || '').trim().toLowerCase();
      if (key) msoArtistKeys.add(key);
    }
    const msoFilteredAlbums = msoArtistKeys.size === 0
      ? unresolvedFilteredAlbums
      : unresolvedFilteredAlbums.filter(album => {
          const artistKey = (album.artist || '').trim().toLowerCase();
          return !msoArtistKeys.has(artistKey);
        });

    // Deduplicate albums with same title and artist (keep the one with more tracks or from preferred source)
    const deduplicatedAlbums = (() => {
      const seen = new Map<string, typeof msoFilteredAlbums[0]>();

      for (const album of msoFilteredAlbums) {
        // Create a key from normalized title + artist
        const key = `${album.title?.toLowerCase().trim()}|${album.artist?.toLowerCase().trim()}`;
        const existing = seen.get(key);

        if (!existing) {
          seen.set(key, album);
        } else {
          // Keep the one with more tracks, or prefer non-Wavlake (artist's own site) as tiebreaker
          const existingTrackCount = existing.tracks?.length || 0;
          const newTrackCount = album.tracks?.length || 0;
          const existingIsWavlake = existing.feedUrl?.includes('wavlake.com');
          const newIsWavlake = album.feedUrl?.includes('wavlake.com');

          // Prefer more tracks, then non-Wavlake (artist's own hosting) as tiebreaker
          const shouldReplace =
            newTrackCount > existingTrackCount ||
            (existingIsWavlake && !newIsWavlake && newTrackCount >= existingTrackCount);

          if (shouldReplace) {
            if (process.env.NODE_ENV === 'development') {
              console.log(`🔄 Dedup: Replacing "${existing.title}" (${existingTrackCount} tracks, wavlake: ${existingIsWavlake}) with (${newTrackCount} tracks, wavlake: ${newIsWavlake})`);
            }
            seen.set(key, album);
          } else if (process.env.NODE_ENV === 'development') {
            console.log(`🔄 Dedup: Keeping "${existing.title}" (${existingTrackCount} tracks), skipping duplicate (${newTrackCount} tracks)`);
          }
        }
      }

      return Array.from(seen.values());
    })();

    // Filter out playlist feeds, blacklisted feeds, and podcast feeds from album grid
    const playlistUrls = getPlaylistUrls();
    const playlistIds = getAllPlaylistIds();
    const blacklistedIds = getBlacklistedFeedIds();
    const nonPlaylistAlbums = deduplicatedAlbums.filter(album =>
      !playlistIds.includes(album.id) &&
      !blacklistedIds.includes(album.id) &&
      album.type !== 'podcast' &&
      (!album.feedUrl || !playlistUrls.includes(album.feedUrl)) &&
      (!album.feedUrl || !BLACKLISTED_FEED_URLS.includes(album.feedUrl)) &&
      // Henrik Flyman pulled all his music off Wavlake (self-hosts at
      // henrikflyman.com) — treat any of his lingering Wavlake mirrors as dead.
      !isHenrikFlymanWavlakeMirror({ artist: album.artist, feedUrl: album.feedUrl })
    );

    // Apply filtering
    let filteredAlbums = nonPlaylistAlbums;
    if (filter !== 'all') {
      switch (filter) {
        case 'albums':
          filteredAlbums = deduplicatedAlbums.filter(album =>
            album.tracks && album.tracks.length >= 6
          );
          break;
        case 'eps':
          filteredAlbums = deduplicatedAlbums.filter(album =>
            album.tracks && album.tracks.length >= 2 && album.tracks.length <= 5
          );
          break;
        case 'singles':
          filteredAlbums = deduplicatedAlbums.filter(album =>
            album.tracks && album.tracks.length === 1
          );
          break;
        case 'playlist':
          // Start with empty array for playlist filter - playlists will be added after this
          filteredAlbums = [];
          break;
        case 'podcasts': {
          // Show all podcast-type feeds (type='podcast' in DB). Cached like the
          // catalog: this ran a query on EVERY request, reading ~1,060 episodes
          // to return ~217 (Prisma trims to `take` after the read — see below).
          const podcastFeeds = await albumsFastPodcasts.get(() => prisma.feed.findMany({
            where: {
              status: 'active',
              type: 'podcast',
              markedDead: false,
            },
            // Ordered in the database, bounded in the response. This select
            // used to omit `take` entirely, so it returned every episode of
            // every podcast — with `chapters` and `valueTimeSplits` attached —
            // and then sorted them newest-first in JavaScript. An 800-episode
            // show returned 800 heavy rows to render one card.
            //
            // `take` does NOT bound the database read, though: Prisma's query
            // log shows the Track query with no LIMIT, and the engine trims to
            // `take` per feed after reading every row (2026-09-19: 1,060 read,
            // 217 returned). That is why this result is cached above.
            //
            // `order: 'newest'` is required, not cosmetic: taking N rows in the
            // default order would give the N OLDEST episodes, and the JS sort
            // would then present the wrong episodes in the right order.
            //
            // The card only needs enough episodes to render; the full list
            // comes from /api/albums/[id], which the podcast detail page uses.
            select: albumFeedSelect(PODCAST_EPISODE_LIMIT, { order: 'newest' }),
          }) as Promise<FeedWithTracks[]>);
          filteredAlbums = podcastFeeds.map((feed) => ({
            // Same shared mapper. The sort is done by the database now, so
            // `newestFirst` is no longer needed here. Podcasts default to type
            // 'podcast' and report only the feed's own V4V, with no track
            // fallback.
            ...feedToAlbum(feed, {
              defaultType: 'podcast',
              v4vTrackFallback: false,
            }),
            isPodcast: true,
            totalTracks: feed._count?.Track || feed.Track?.length || 0,
          }));
          break;
        }
        case 'videos':
          // Filter albums that have at least one video track (either mediaType is video or has video in alternateEnclosures)
          filteredAlbums = deduplicatedAlbums.filter(album =>
            album.tracks && album.tracks.some((track: any) =>
              track.mediaType === 'video' ||
              (track.alternateEnclosures && track.alternateEnclosures.some((enc: any) =>
                enc.type?.includes('video')
              ))
            )
          );
          break;
      }
    }
    
    // Sort albums based on requested sort order
    switch (sort) {
      case 'added-desc':
        filteredAlbums.sort((a, b) => new Date(b.dateAdded || b.releaseDate || 0).getTime() - new Date(a.dateAdded || a.releaseDate || 0).getTime());
        break;
      case 'added-asc':
        filteredAlbums.sort((a, b) => new Date(a.dateAdded || a.releaseDate || 0).getTime() - new Date(b.dateAdded || b.releaseDate || 0).getTime());
        break;
      case 'year-desc':
        filteredAlbums.sort((a, b) => new Date(b.releaseDate || 0).getTime() - new Date(a.releaseDate || 0).getTime());
        break;
      case 'year-asc':
        filteredAlbums.sort((a, b) => new Date(a.releaseDate || 0).getTime() - new Date(b.releaseDate || 0).getTime());
        break;
      case 'name-desc':
        filteredAlbums.sort((a, b) => b.title.toLowerCase().localeCompare(a.title.toLowerCase()));
        break;
      case 'name-asc':
        filteredAlbums.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
        break;
      case 'tracks-desc':
        filteredAlbums.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0));
        break;
      case 'tracks-asc':
        filteredAlbums.sort((a, b) => (a.trackCount || 0) - (b.trackCount || 0));
        break;
      default: {
        // Default: format (Albums → EPs → Singles) then alphabetically by title
        // Build a Map for O(1) feed lookups instead of O(n) .find() per album
        const feedMap = new Map(feeds.map(f => [f.id, f]));

        const getFormatOrder = (trackCount: number) => {
          if (trackCount >= 6) return 1; // Albums first
          if (trackCount >= 2) return 2; // EPs second
          return 3; // Singles last
        };

        filteredAlbums.sort((a, b) => {
          const aCount = feedMap.get(a.id)?._count?.Track || 0;
          const bCount = feedMap.get(b.id)?._count?.Track || 0;

          const aFormatOrder = getFormatOrder(aCount);
          const bFormatOrder = getFormatOrder(bCount);

          if (aFormatOrder !== bFormatOrder) {
            return aFormatOrder - bFormatOrder;
          }

          return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
        });
        break;
      }
    }
    
    // Add playlist albums only when specifically requesting playlists
    if (filter === 'playlist') {
      const playlistAlbums = await getPlaylistAlbums();
      if (playlistAlbums.length > 0) {
        filteredAlbums.push(...playlistAlbums);
      }
    }
    
    // Get accurate total count of filtered results
    // Since we always load all feeds, filteredAlbums.length is the accurate total count
    let totalCount = filteredAlbums.length;

    // Calculate format counts for "all" filter (helps frontend with format-aware pagination)
    let formatCounts = { albums: 0, eps: 0, singles: 0 };
    if (filter === 'all') {
      filteredAlbums.forEach(album => {
        const trackCount = album.trackCount || album.tracks?.length || 0;
        if (trackCount >= 6) formatCounts.albums++;
        else if (trackCount >= 2) formatCounts.eps++;
        else formatCounts.singles++;
      });
    }

    // Apply final pagination to filtered results
    const paginatedAlbums = filteredAlbums.slice(offset, offset + limit);
    
    return compressedJson(request, {
      success: true,
      albums: paginatedAlbums,
      totalCount, // Total count of filtered results (for pagination)
      publisherStats,
      metadata: {
        returnedAlbums: paginatedAlbums.length,
        totalAlbums: totalCount,
        offset,
        limit,
        filter,
        sort,
        cached: catalogBuiltAt < now, // loaded before this request arrived
        cacheAge: now - catalogBuiltAt,
        source: 'database',
        formatCounts: filter === 'all' ? formatCounts : undefined
      }
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'CDN-Cache-Control': 'public, s-maxage=60',
      }
    });
    
  } catch (error) {
    // Always log errors, even in production
    console.error('❌ Albums Fast API Error:', error);
    return NextResponse.json({
      error: 'Failed to load albums'
    }, { status: 500 });
  }
}