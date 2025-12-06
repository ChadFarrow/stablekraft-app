import { NextResponse } from 'next/server';
import { resolveItemGuid } from '@/lib/feed-discovery';
import { autoPopulateFeeds, parseRemoteItemsForFeeds } from '@/lib/auto-populate-feeds';
import { playlistCache } from '@/lib/playlist-cache';
import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';

// Increase timeout for this route to 5 minutes
export const maxDuration = 300;

const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

// Persistent cache duration - 6 hours for daily updates
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  episodeTitle?: string;  // Episode this track belongs to
  episodeId?: string;     // Episode ID for grouping
  episodeIndex?: number;  // Position within episode
}

interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  description: string;
  image: string;
  audioUrl: string;
  url?: string; // For compatibility with RSSAlbum type
  duration: number;
  publishedAt: string;
  feedGuid: string;
  itemGuid: string;
}

// Parsed items from XML (episode markers or remote items)
interface ParsedEpisodeMarker {
  type: 'episode';
  title: string;
}

interface ParsedRemoteItem {
  type: 'remoteItem';
  feedGuid: string;
  itemGuid: string;
}

type ParsedPlaylistItem = ParsedEpisodeMarker | ParsedRemoteItem;

// Episode group for API response
interface EpisodeGroup {
  id: string;
  title: string;
  trackCount: number;
  tracks: any[];
  index: number;
}

function parseArtworkUrl(xmlText: string): string | null {
  // Parse the <image><url>...</url></image> structure
  const imageRegex = /<image>\s*<url>(.*?)<\/url>\s*<\/image>/s;
  const match = xmlText.match(imageRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

function parseRemoteItems(xmlText: string): RemoteItem[] {
  const remoteItems: RemoteItem[] = [];

  // Simple regex parsing for podcast:remoteItem tags
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;

  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    const feedGuid = match[1];
    const itemGuid = match[2];

    if (feedGuid && itemGuid) {
      remoteItems.push({
        feedGuid,
        itemGuid
      });
    }
  }

  return remoteItems;
}

// Parse playlist with episode markers - extracts both episode markers and remote items in order
function parsePlaylistWithEpisodes(xmlText: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];

  // Combined regex to match both episode markers and remote items in document order
  // Match: <podcast:txt purpose="episode">...</podcast:txt>
  // Match: <podcast:remoteItem feedGuid="..." itemGuid="..."/>
  const combinedRegex = /<podcast:txt\s+purpose="episode">([^<]*)<\/podcast:txt>|<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*\/?>/g;

  let match;
  while ((match = combinedRegex.exec(xmlText)) !== null) {
    if (match[1] !== undefined) {
      // Episode marker - match[1] is the episode title
      items.push({
        type: 'episode',
        title: match[1].trim()
      });
    } else if (match[2] && match[3]) {
      // Remote item - match[2] is feedGuid, match[3] is itemGuid
      items.push({
        type: 'remoteItem',
        feedGuid: match[2],
        itemGuid: match[3]
      });
    }
  }

  return items;
}

// Generate a stable ID from episode title
function generateEpisodeId(title: string): string {
  return 'ep-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

// Group parsed items by episode
function groupItemsByEpisode(parsedItems: ParsedPlaylistItem[]): {
  episodes: { title: string; remoteItems: RemoteItem[] }[];
  ungroupedItems: RemoteItem[];
  hasEpisodeMarkers: boolean;
} {
  const episodes: { title: string; remoteItems: RemoteItem[] }[] = [];
  const ungroupedItems: RemoteItem[] = [];
  let currentEpisode: { title: string; remoteItems: RemoteItem[] } | null = null;
  let foundEpisodeMarker = false;

  for (const item of parsedItems) {
    if (item.type === 'episode') {
      foundEpisodeMarker = true;
      // Start new episode group
      if (currentEpisode && currentEpisode.remoteItems.length > 0) {
        episodes.push(currentEpisode);
      }
      currentEpisode = {
        title: item.title,
        remoteItems: []
      };
    } else if (item.type === 'remoteItem') {
      const remoteItem: RemoteItem = {
        feedGuid: item.feedGuid,
        itemGuid: item.itemGuid
      };

      if (currentEpisode) {
        // Add episode context to the remote item
        remoteItem.episodeTitle = currentEpisode.title;
        remoteItem.episodeId = generateEpisodeId(currentEpisode.title);
        remoteItem.episodeIndex = currentEpisode.remoteItems.length;
        currentEpisode.remoteItems.push(remoteItem);
      } else {
        // Track before any episode marker
        ungroupedItems.push(remoteItem);
      }
    }
  }

  // Push final episode if it has tracks
  if (currentEpisode && currentEpisode.remoteItems.length > 0) {
    episodes.push(currentEpisode);
  }

  return {
    episodes,
    ungroupedItems,
    hasEpisodeMarkers: foundEpisodeMarker
  };
}

export async function GET(request: Request) {
  try {
    console.log('🎵 Fetching HGH playlist...', { userAgent: request.headers.get('user-agent')?.slice(0, 50) });

    // Check for force refresh parameter
    const forceRefresh = new URL(request.url).searchParams.has('refresh');

    // FAST PATH: Try database first (instant, no XML fetch needed)
    if (!forceRefresh) {
      try {
        const dbPlaylist = await prisma.systemPlaylist.findUnique({
          where: { id: 'hgh' },
          include: {
            tracks: {
              orderBy: { position: 'asc' },
              include: {
                track: {
                  select: {
                    id: true,
                    guid: true,
                    title: true,
                    artist: true,
                    album: true,
                    audioUrl: true,
                    duration: true,
                    publishedAt: true,
                    image: true,
                    v4vRecipient: true,
                    v4vValue: true,
                    Feed: {
                      select: {
                        id: true,
                        title: true,
                        artist: true,
                        image: true
                      }
                    }
                  }
                }
              }
            }
          }
        });

        if (dbPlaylist && dbPlaylist.tracks.length > 0) {
          console.log(`⚡ Using database playlist (${dbPlaylist.tracks.length} tracks)`);

          const tracks = dbPlaylist.tracks.map((pt, index) => ({
            id: pt.track.id,
            title: pt.track.title,
            artist: pt.track.artist || pt.track.Feed?.artist || 'Unknown Artist',
            album: pt.track.album || pt.track.Feed?.title || 'Unknown Album',
            audioUrl: pt.track.audioUrl,
            duration: pt.track.duration || 0,
            image: pt.track.image || pt.track.Feed?.image,
            publishedAt: pt.track.publishedAt?.toISOString(),
            v4vRecipient: pt.track.v4vRecipient,
            v4vValue: pt.track.v4vValue,
            feedGuid: pt.track.guid,
            itemGuid: pt.track.guid,
            index,
            episodeId: pt.episodeId,
            playlistContext: {
              episodeTitle: pt.episodeId,
              itemGuid: pt.track.guid,
              position: pt.position
            }
          }));

          // Build episode groups from database data
          const episodeIds = [...new Set(tracks.filter(t => t.episodeId).map(t => t.episodeId))];
          const episodes = episodeIds.map((epId, idx) => {
            const episodeTracks = tracks.filter(t => t.episodeId === epId);
            return {
              id: epId,
              title: epId?.replace('ep-', '').replace(/-/g, ' ') || 'Unknown Episode',
              trackCount: episodeTracks.length,
              tracks: episodeTracks,
              index: idx
            };
          });

          const playlistAlbum = {
            id: 'hgh-playlist',
            title: dbPlaylist.title,
            artist: 'ChadF',
            description: dbPlaylist.description,
            image: dbPlaylist.artwork,
            tracks,
            episodes,
            hasEpisodeMarkers: episodes.length > 0,
            totalTracks: tracks.length,
            publishedAt: dbPlaylist.updatedAt.toISOString(),
            isPlaylistCard: true,
            playlistUrl: '/playlist/hgh',
          };

          return NextResponse.json({
            success: true,
            albums: [playlistAlbum],
            totalCount: 1,
            fromDatabase: true,
            playlist: {
              title: dbPlaylist.title,
              description: dbPlaylist.description,
              author: 'ChadF',
              totalItems: 1,
              items: [playlistAlbum]
            }
          });
        }
      } catch (dbError) {
        console.log('⚠️ Database lookup failed, falling back to cache/fetch:', dbError);
      }
    }

    // Check persistent cache first
    if (!forceRefresh && playlistCache.isCacheValid('hgh-playlist', CACHE_DURATION)) {
      const cachedData = playlistCache.getCachedData('hgh-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch the playlist XML
    const response = await fetch(HGH_PLAYLIST_URL, {
      headers: {
        'User-Agent': 'StableKraft-Playlist-Parser/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }

    const xmlText = await response.text();
    console.log('📄 Fetched playlist XML, length:', xmlText.length);

    // Parse the XML to extract remote items and artwork
    const artworkUrl = parseArtworkUrl(xmlText);
    console.log('🎨 Found artwork URL:', artworkUrl);

    // Parse playlist with episode markers
    const parsedItems = parsePlaylistWithEpisodes(xmlText);
    const { episodes: episodeGroups, ungroupedItems, hasEpisodeMarkers } = groupItemsByEpisode(parsedItems);

    // Flatten all remote items for resolution (preserving episode context)
    const allRemoteItems: RemoteItem[] = [
      ...ungroupedItems,
      ...episodeGroups.flatMap(ep => ep.remoteItems)
    ];

    console.log('📋 Found remote items:', allRemoteItems.length);
    console.log('📺 Found episode markers:', hasEpisodeMarkers ? episodeGroups.length : 0);
    if (hasEpisodeMarkers) {
      console.log('📺 Episodes:', episodeGroups.map(e => `"${e.title}" (${e.remoteItems.length} tracks)`).join(', '));
    }

    console.log('🔍 Resolving playlist items to actual tracks...');

    // AUTOMATIC FEED POPULATION - This is now automatic for all playlists!
    const allFeedGuids = parseRemoteItemsForFeeds(xmlText);
    await autoPopulateFeeds(allFeedGuids, 'Homegrown Hits');

    // Resolve playlist items to get actual track data from the database
    const resolvedTracks = await resolvePlaylistItems(allRemoteItems);
    console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

    // Create a map of resolved tracks by itemGuid for quick lookup
    const resolvedTrackMap = new Map(
      resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
    );

    // Create tracks for ALL remote items, using resolved data when available
    const allTracks = allRemoteItems.map((item, index) => {
      const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

      if (resolvedTrack) {
        // Use real track data with episode context
        return {
          id: resolvedTrack.id,
          title: resolvedTrack.title,
          artist: resolvedTrack.artist,
          audioUrl: resolvedTrack.audioUrl || '',
          url: resolvedTrack.audioUrl || '', // Add url property for compatibility
          duration: validateDuration(resolvedTrack.duration, resolvedTrack.title) || 180,
          publishedAt: resolvedTrack.publishedAt || new Date().toISOString(),
          image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in Homegrown Hits podcast`,
          albumTitle: resolvedTrack.albumTitle,
          feedTitle: resolvedTrack.feedTitle,
          feedId: resolvedTrack.feedId,
          guid: resolvedTrack.guid,
          v4vValue: resolvedTrack.v4vValue,
          v4vRecipient: resolvedTrack.v4vRecipient,
          // Episode grouping data
          episodeTitle: item.episodeTitle || 'Homegrown Hits',
          episodeId: item.episodeId,
          episodeIndex: item.episodeIndex
        };
      } else {
        // Return null for unresolved tracks (will be filtered out)
        return null;
      }
    }).filter(Boolean); // Remove null entries

    // Filter to only include tracks with valid audio URLs AND real database IDs
    // Exclude tracks with API-resolved IDs (api-*) since they're not in the database
    const tracks = allTracks.filter(track => {
      if (!track || !track.url || track.url.length === 0) return false;
      if (track.id.startsWith('api-')) return false;
      if (track.id.startsWith('hgh-track-')) return false;
      return true;
    });

    console.log(`🎯 Filtered tracks: ${allTracks.length} total -> ${tracks.length} playable (removed ${allTracks.length - tracks.length} without audio or database IDs)`);

    // Build episode objects from resolved tracks
    const episodes: EpisodeGroup[] = hasEpisodeMarkers
      ? episodeGroups.map((group, index) => {
          const episodeId = generateEpisodeId(group.title);
          const episodeTracks = tracks.filter((t: any) => t.episodeId === episodeId);
          return {
            id: episodeId,
            title: group.title,
            trackCount: episodeTracks.length,
            tracks: episodeTracks,
            index
          };
        })
      : [];

    if (hasEpisodeMarkers) {
      console.log(`📺 Built ${episodes.length} episodes with resolved tracks`);
    }

    // Create a single virtual album that represents the HGH playlist
    const playlistAlbum = {
      id: 'hgh-playlist',
      title: 'Homegrown Hits Music Playlist',
      artist: 'Various Artists',
      album: 'Homegrown Hits Music Playlist',
      description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg', // Add coverArt field for consistency
      url: HGH_PLAYLIST_URL,
      tracks: tracks,
      episodes: episodes,                    // Episode grouping data
      hasEpisodeMarkers: hasEpisodeMarkers,  // Flag for frontend
      feedId: 'hgh-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true, // Mark as playlist card for proper URL generation
      playlistUrl: '/playlist/hgh', // Set the playlist URL
      albumUrl: '/album/homegrown-hits-music-playlist', // Set the album URL for album-style display
      playlistContext: {
        source: 'hgh-playlist',
        originalUrl: HGH_PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: allRemoteItems.length,
        totalEpisodes: episodes.length
      }
    };

    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks and ${episodes.length} episodes`);

    const responseData = {
      success: true,
      albums: [playlistAlbum], // Return as single album
      totalCount: 1,
      playlist: {
        title: 'Homegrown Hits Music Playlist',
        description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
        author: 'ChadF',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };

    // Save to SystemPlaylist table for instant page loads (only on refresh)
    if (forceRefresh) {
      try {
        console.log('💾 Saving HGH playlist to database...');

        await prisma.systemPlaylist.upsert({
          where: { id: 'hgh' },
          update: {
            title: 'Homegrown Hits Music Playlist',
            description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
            artwork: artworkUrl,
          },
          create: {
            id: 'hgh',
            title: 'Homegrown Hits Music Playlist',
            description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
            artwork: artworkUrl,
          }
        });

        await prisma.systemPlaylistTrack.deleteMany({
          where: { playlistId: 'hgh' }
        });

        // Use 'tracks' (filtered) not 'resolvedTracks' - api-* IDs don't exist in Track table
        const trackInserts = tracks
          .filter((track: any) => track.id && !track.id.startsWith('api-') && !track.id.startsWith('hgh-track-'))
          .map((track: any, index: number) => ({
            playlistId: 'hgh',
            trackId: track.id,
            position: index,
            episodeId: track.episodeId || null,
          }));

        if (trackInserts.length > 0) {
          await prisma.systemPlaylistTrack.createMany({
            data: trackInserts,
            skipDuplicates: true,
          });
        }

        console.log(`💾 Saved ${trackInserts.length} tracks to SystemPlaylist`);
      } catch (dbError) {
        console.error('❌ Error saving to SystemPlaylist:', dbError);
      }
    }

    // Cache the response
    playlistCache.setCachedData('hgh-playlist', responseData);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching HGH playlist:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function resolvePlaylistItems(remoteItems: RemoteItem[]) {
  try {
    // Get unique item GUIDs from the playlist (these map to track.guid)
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 Looking up ${itemGuids.length} unique track GUIDs for ${remoteItems.length} playlist items`);

    // Find tracks in database by GUID
    const tracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      include: {
        Feed: true
      },
      orderBy: [
        { trackOrder: 'asc' },
        { publishedAt: 'asc' },
        { createdAt: 'asc' }
      ]
    });

    console.log(`📊 Found ${tracks.length} matching tracks in database`);

    // Create a map for quick lookup by track GUID
    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: any[] = [];
    const unresolvedItems: RemoteItem[] = [];

    // First pass: resolve items found in database
    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);

      if (track && track.Feed) {
        // Create track object with feed context
        const resolvedTrack: any = {
          id: track.id,
          title: track.title,
          artist: track.artist || (track.Feed.artist === 'Unresolved GUID' ? track.Feed.title : track.Feed.artist) || 'Unknown Artist',
          audioUrl: track.audioUrl,
          url: track.audioUrl, // Add url property for compatibility
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: track.image || track.Feed.image || '/placeholder-podcast.jpg',
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          feedId: track.Feed.id,
          guid: track.guid,
          v4vRecipient: track.v4vRecipient, // Include V4V payment data
          v4vValue: track.v4vValue, // Include full V4V value splits for BoostButton
          // Add playlist context
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: 'hgh-playlist'
          }
        };

        // If audioUrl is missing, mark for API resolution to fill in the gap
        if (!track.audioUrl) {
          resolvedTrack.needsApiResolution = true;
          console.log(`🔍 Track "${track.title}" needs API resolution for missing audioUrl`);
        }

        resolvedTracks.push(resolvedTrack);
      } else {
        unresolvedItems.push(remoteItem);
      }
    }

    console.log(`📊 Found ${resolvedTracks.length} tracks in database, ${unresolvedItems.length} need API resolution`);

    // Second pass: resolve unresolved items using Podcast Index API (PARALLELIZED)
    if (unresolvedItems.length > 0) {
      const maxToProcess = Math.min(200, unresolvedItems.length);
      console.log(`🔍 Resolving ${maxToProcess} items via Podcast Index API (parallel batches)...`);

      const BATCH_SIZE = 10;
      const itemsToProcess = unresolvedItems.slice(0, maxToProcess);

      for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
        const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(itemsToProcess.length / BATCH_SIZE);

        console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`);

        const batchResults = await Promise.allSettled(
          batch.map(async (remoteItem) => {
            try {
              const apiResult = await resolveItemGuid(remoteItem.feedGuid, remoteItem.itemGuid);
              return { remoteItem, apiResult, error: null };
            } catch (error) {
              return { remoteItem, apiResult: null, error };
            }
          })
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            const { remoteItem, apiResult } = result.value;

            if (apiResult) {
              const resolvedTrack = {
                id: `api-${remoteItem.itemGuid}`,
                title: apiResult.title || 'Unknown Track',
                artist: apiResult.feedTitle || 'Unknown Artist',
                audioUrl: apiResult.audioUrl || '',
                url: apiResult.audioUrl || '',
                duration: apiResult.duration || 0,
                publishedAt: apiResult.publishedAt?.toISOString() || new Date().toISOString(),
                image: apiResult.image || apiResult.feedImage || '/placeholder-podcast.jpg',
                albumTitle: apiResult.feedTitle,
                feedTitle: apiResult.feedTitle,
                feedId: `api-feed-${remoteItem.feedGuid}`,
                guid: apiResult.guid,
                description: apiResult.description,
                playlistContext: {
                  feedGuid: remoteItem.feedGuid,
                  itemGuid: remoteItem.itemGuid,
                  source: 'hgh-playlist',
                  resolvedViaAPI: true
                }
              };
              resolvedTracks.push(resolvedTrack);
            }
          }
        }

        if (i + BATCH_SIZE < itemsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      console.log(`✅ Parallel resolution complete: processed ${maxToProcess} items in ${Math.ceil(maxToProcess / BATCH_SIZE)} batches`);
    }

    // Third pass: Enhance database tracks that need API resolution (PARALLELIZED)
    const tracksNeedingEnhancement = resolvedTracks.filter(track => track.needsApiResolution);
    if (tracksNeedingEnhancement.length > 0) {
      console.log(`🔗 Enhancing ${tracksNeedingEnhancement.length} database tracks with API data (parallel)...`);

      const BATCH_SIZE = 10;
      for (let i = 0; i < tracksNeedingEnhancement.length; i += BATCH_SIZE) {
        const batch = tracksNeedingEnhancement.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.allSettled(
          batch.map(async (track) => {
            try {
              const apiResult = await resolveItemGuid(track.playlistContext.feedGuid, track.playlistContext.itemGuid);
              return { track, apiResult };
            } catch (error) {
              return { track, apiResult: null };
            }
          })
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            const { track, apiResult } = result.value;
            if (apiResult && apiResult.audioUrl) {
              track.audioUrl = apiResult.audioUrl;
              track.url = apiResult.audioUrl;
              if (!track.duration && apiResult.duration) track.duration = apiResult.duration;
              if (!track.image && apiResult.image) track.image = apiResult.image;
            }
            delete track.needsApiResolution;
          }
        }

        if (i + BATCH_SIZE < tracksNeedingEnhancement.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    return resolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving playlist items:', error);
    return [];
  }
}