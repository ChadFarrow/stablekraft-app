import { NextResponse } from 'next/server';
import { resolveItemGuid } from '@/lib/feed-discovery';
import { playlistCache } from '@/lib/playlist-cache';
import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';

// Increase timeout for this route to 5 minutes
export const maxDuration = 300;

const TOP100_JSON_URL = 'https://stats.podcastindex.org/v4vmusic.json';

// Cache duration - 1 hour (matches hourly updates from source)
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

interface Top100Item {
  rank: number;
  boosts: string;
  title: string;
  author: string;
  image: string;
  feedId: number;
  feedUrl: string;
  feedGuid: string;
  itemGuid: string;
}

interface Top100Response {
  title: string;
  description: string;
  timestamp: number;
  items: Top100Item[];
}

export async function GET(request: Request) {
  try {
    console.log('🏆 Fetching Top 100 V4V Music playlist...', { userAgent: request.headers.get('user-agent')?.slice(0, 50) });

    // Check for force refresh parameter
    const forceRefresh = new URL(request.url).searchParams.has('refresh');

    // Check persistent cache first
    if (!forceRefresh && playlistCache.isCacheValid('top100-playlist', CACHE_DURATION)) {
      const cachedData = playlistCache.getCachedData('top100-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached Top 100 data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch the Top 100 JSON
    const response = await fetch(TOP100_JSON_URL, {
      headers: {
        'User-Agent': 'StableKraft-Playlist-Parser/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Top 100: ${response.status}`);
    }

    const data: Top100Response = await response.json();
    console.log('📊 Fetched Top 100 data:', data.items.length, 'items');
    console.log('📅 Data timestamp:', new Date(data.timestamp * 1000).toISOString());

    // Resolve items to get audio URLs
    const resolvedTracks = await resolveTop100Items(data.items);
    console.log(`✅ Resolved ${resolvedTracks.length} tracks`);

    // Filter out tracks without audio URLs
    const tracks = resolvedTracks.filter(track =>
      track.audioUrl && track.audioUrl.length > 0
    );

    console.log(`🎯 Filtered tracks: ${resolvedTracks.length} -> ${tracks.length} (removed ${resolvedTracks.length - tracks.length} tracks without audio)`);

    // Create the playlist album
    const playlistAlbum = {
      id: 'top100-playlist',
      title: 'Top 100 V4V Music',
      artist: 'Various Artists',
      album: 'Top 100 V4V Music',
      description: data.description || 'The hottest tracks in the Value4Value music economy, updated hourly',
      image: tracks[0]?.image || '/placeholder-podcast.jpg',
      coverArt: tracks[0]?.image || '/placeholder-podcast.jpg',
      url: TOP100_JSON_URL,
      link: 'https://stats.podcastindex.org/v4vmusic.html',
      tracks: tracks,
      feedId: 'top100-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date(data.timestamp * 1000).toISOString(),
      isPlaylistCard: true,
      playlistUrl: '/playlist/top100',
      playlistContext: {
        source: 'top100-playlist',
        originalUrl: TOP100_JSON_URL,
        resolvedTracks: tracks.length,
        totalItems: data.items.length,
        lastUpdated: new Date(data.timestamp * 1000).toISOString()
      }
    };

    console.log(`✅ Created Top 100 playlist with ${playlistAlbum.tracks.length} tracks`);

    const responseData = {
      success: true,
      albums: [playlistAlbum],
      totalCount: 1,
      playlist: {
        title: 'Top 100 V4V Music',
        description: data.description || 'The hottest tracks in the Value4Value music economy, updated hourly',
        author: 'Podcast Index',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };

    // Cache the response
    playlistCache.setCachedData('top100-playlist', responseData);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching Top 100 playlist:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function resolveTop100Items(items: Top100Item[]) {
  try {
    // Get unique item GUIDs
    const itemGuids = [...new Set(items.map(item => item.itemGuid))];
    console.log(`🔍 Looking up ${itemGuids.length} unique track GUIDs`);

    // Find tracks in database by GUID
    const tracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      include: {
        Feed: true
      }
    });

    console.log(`📊 Found ${tracks.length} matching tracks in database`);

    // Create a map for quick lookup
    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: any[] = [];
    const unresolvedItems: Top100Item[] = [];

    // First pass: resolve items from database
    for (const item of items) {
      const track = trackMap.get(item.itemGuid);

      if (track && track.Feed) {
        resolvedTracks.push({
          id: track.id,
          title: track.title,
          artist: track.artist || item.author,
          episodeTitle: track.Feed.title || item.author,
          audioUrl: track.audioUrl || '',
          startTime: 0,
          endTime: validateDuration(track.duration, track.title) || 180,
          duration: validateDuration(track.duration, track.title) || 180,
          source: 'database',
          image: track.image || item.image || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `#${item.rank} on the V4V Music charts`,
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          guid: track.guid,
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          rank: item.rank,
          boosts: parseInt(item.boosts) || 0,
          resolved: true,
          playlistContext: {
            feedGuid: item.feedGuid,
            itemGuid: item.itemGuid,
            source: 'top100-playlist',
            rank: item.rank
          }
        });
      } else {
        unresolvedItems.push(item);
      }
    }

    console.log(`📊 Database resolved: ${resolvedTracks.length}, need API: ${unresolvedItems.length}`);

    // Second pass: resolve via Podcast Index API
    if (unresolvedItems.length > 0) {
      console.log(`🔍 Resolving ${unresolvedItems.length} items via Podcast Index API...`);

      let processedCount = 0;
      const maxToProcess = Math.min(100, unresolvedItems.length);

      for (const item of unresolvedItems.slice(0, maxToProcess)) {
        try {
          const apiResult = await resolveItemGuid(item.feedGuid, item.itemGuid);

          if (apiResult && apiResult.audioUrl) {
            resolvedTracks.push({
              id: `api-${item.itemGuid}`,
              title: apiResult.title || item.title,
              artist: apiResult.feedTitle || item.author,
              episodeTitle: apiResult.feedTitle || item.author,
              audioUrl: apiResult.audioUrl,
              startTime: 0,
              endTime: validateDuration(apiResult.duration, apiResult.title) || 180,
              duration: validateDuration(apiResult.duration, apiResult.title) || 180,
              source: 'api',
              image: apiResult.image || item.image || '/placeholder-podcast.jpg',
              feedGuid: item.feedGuid,
              itemGuid: item.itemGuid,
              description: `#${item.rank} on the V4V Music charts`,
              albumTitle: apiResult.feedTitle || item.author,
              feedTitle: apiResult.feedTitle || item.author,
              guid: apiResult.guid || item.itemGuid,
              rank: item.rank,
              boosts: parseInt(item.boosts) || 0,
              resolved: true,
              playlistContext: {
                feedGuid: item.feedGuid,
                itemGuid: item.itemGuid,
                source: 'top100-playlist',
                rank: item.rank,
                resolvedViaAPI: true
              }
            });
            console.log(`✅ API resolved #${item.rank}: ${apiResult.title}`);
          } else {
            // Use data from JSON as fallback (no audio URL)
            resolvedTracks.push({
              id: `top100-${item.rank}`,
              title: item.title,
              artist: item.author,
              episodeTitle: item.author,
              audioUrl: '', // No audio URL available
              startTime: 0,
              endTime: 180,
              duration: 180,
              source: 'json-only',
              image: item.image || '/placeholder-podcast.jpg',
              feedGuid: item.feedGuid,
              itemGuid: item.itemGuid,
              description: `#${item.rank} on the V4V Music charts`,
              albumTitle: item.author,
              feedTitle: item.author,
              guid: item.itemGuid,
              rank: item.rank,
              boosts: parseInt(item.boosts) || 0,
              resolved: false,
              playlistContext: {
                feedGuid: item.feedGuid,
                itemGuid: item.itemGuid,
                source: 'top100-playlist',
                rank: item.rank,
                isPlaceholder: true
              }
            });
            console.log(`📝 No audio for #${item.rank}: ${item.title}`);
          }

          processedCount++;
          if (processedCount % 20 === 0) {
            console.log(`📊 API Progress: ${processedCount}/${maxToProcess}`);
          }
        } catch (error) {
          console.error(`❌ Error resolving #${item.rank} ${item.title}:`, error);
        }
      }
    }

    // Sort by rank to maintain chart order
    resolvedTracks.sort((a, b) => a.rank - b.rank);

    // Statistics
    const dbResolved = resolvedTracks.filter(t => t.source === 'database').length;
    const apiResolved = resolvedTracks.filter(t => t.source === 'api').length;
    const withAudio = resolvedTracks.filter(t => t.audioUrl).length;

    console.log(`🎯 FINAL TOP 100 RESOLUTION:`);
    console.log(`📊 Database: ${dbResolved} | API: ${apiResolved} | With Audio: ${withAudio}/${resolvedTracks.length}`);

    return resolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving Top 100 items:', error);
    return [];
  }
}
