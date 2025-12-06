import { NextResponse } from 'next/server';
import { processPlaylistFeedDiscovery, resolveItemGuid } from '@/lib/feed-discovery';
import { playlistCache } from '@/lib/playlist-cache';
import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';

const FLOWGNAR_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-music-playlist.xml';

const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  episodeTitle?: string;
  episodeId?: string;
  episodeIndex?: number;
}

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

interface EpisodeGroup {
  id: string;
  title: string;
  trackCount: number;
  tracks: any[];
  index: number;
}

function parseArtworkUrl(xmlText: string): string | null {
  const imageRegex = /<image>\s*<url>(.*?)<\/url>\s*<\/image>/s;
  const match = xmlText.match(imageRegex);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

function parsePlaylistWithEpisodes(xmlText: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];
  const combinedRegex = /<podcast:txt\s+purpose="episode">([^<]*)<\/podcast:txt>|<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*\/?>/g;

  let match;
  while ((match = combinedRegex.exec(xmlText)) !== null) {
    if (match[1] !== undefined) {
      items.push({ type: 'episode', title: match[1].trim() });
    } else if (match[2] && match[3]) {
      items.push({ type: 'remoteItem', feedGuid: match[2], itemGuid: match[3] });
    }
  }
  return items;
}

function generateEpisodeId(title: string): string {
  return 'ep-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

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
      if (currentEpisode && currentEpisode.remoteItems.length > 0) {
        episodes.push(currentEpisode);
      }
      currentEpisode = { title: item.title, remoteItems: [] };
    } else if (item.type === 'remoteItem') {
      const remoteItem: RemoteItem = { feedGuid: item.feedGuid, itemGuid: item.itemGuid };
      if (currentEpisode) {
        remoteItem.episodeTitle = currentEpisode.title;
        remoteItem.episodeId = generateEpisodeId(currentEpisode.title);
        remoteItem.episodeIndex = currentEpisode.remoteItems.length;
        currentEpisode.remoteItems.push(remoteItem);
      } else {
        ungroupedItems.push(remoteItem);
      }
    }
  }

  if (currentEpisode && currentEpisode.remoteItems.length > 0) {
    episodes.push(currentEpisode);
  }

  return { episodes, ungroupedItems, hasEpisodeMarkers: foundEpisodeMarker };
}

export async function GET(request: Request) {
  try {
    console.log('🎵 Fetching Flowgnar playlist...');

    const forceRefresh = new URL(request.url).searchParams.has('refresh');

    // FAST PATH: Try database first
    if (!forceRefresh) {
      try {
        const dbPlaylist = await prisma.systemPlaylist.findUnique({
          where: { id: 'flowgnar' },
          include: {
            tracks: {
              orderBy: { position: 'asc' },
              include: {
                track: {
                  select: {
                    id: true, guid: true, title: true, artist: true, album: true,
                    audioUrl: true, duration: true, publishedAt: true, image: true,
                    v4vRecipient: true, v4vValue: true,
                    Feed: { select: { id: true, title: true, artist: true, image: true } }
                  }
                }
              }
            }
          }
        });

        if (dbPlaylist && dbPlaylist.tracks.length > 0) {
          console.log(`⚡ Using database playlist (${dbPlaylist.tracks.length} tracks)`);
          const tracks = dbPlaylist.tracks.map((pt, index) => ({
            id: pt.track.id, title: pt.track.title,
            artist: pt.track.artist || pt.track.Feed?.artist || 'Unknown Artist',
            album: pt.track.album || pt.track.Feed?.title || 'Unknown Album',
            audioUrl: pt.track.audioUrl, duration: pt.track.duration || 0,
            image: pt.track.image || pt.track.Feed?.image,
            publishedAt: pt.track.publishedAt?.toISOString(),
            v4vRecipient: pt.track.v4vRecipient, v4vValue: pt.track.v4vValue,
            feedGuid: pt.track.guid, itemGuid: pt.track.guid, index,
            episodeId: pt.episodeId,
            playlistContext: { episodeTitle: pt.episodeId, itemGuid: pt.track.guid, position: pt.position }
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
            id: 'flowgnar-playlist', title: dbPlaylist.title, artist: 'ChadF',
            description: dbPlaylist.description, image: dbPlaylist.artwork, tracks,
            episodes, hasEpisodeMarkers: episodes.length > 0, totalTracks: tracks.length,
            publishedAt: dbPlaylist.updatedAt.toISOString(), isPlaylistCard: true, playlistUrl: '/playlist/flowgnar',
          };
          return NextResponse.json({
            success: true, albums: [playlistAlbum], totalCount: 1, fromDatabase: true,
            playlist: { title: dbPlaylist.title, description: dbPlaylist.description, author: 'ChadF', totalItems: 1, items: [playlistAlbum] }
          });
        }
      } catch (dbError) {
        console.log('⚠️ Database lookup failed, falling back to cache/fetch:', dbError);
      }
    }

    // Check cache
    if (!forceRefresh && playlistCache.isCacheValid('flowgnar-playlist', CACHE_DURATION)) {
      const cachedData = playlistCache.getCachedData('flowgnar-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch XML
    const response = await fetch(FLOWGNAR_PLAYLIST_URL, {
      headers: { 'User-Agent': 'StableKraft-Playlist-Parser/1.0' }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }

    const xmlText = await response.text();
    console.log('📄 Fetched playlist XML, length:', xmlText.length);

    // Parse with episode markers
    const parsedItems = parsePlaylistWithEpisodes(xmlText);
    const { episodes: groupedEpisodes, ungroupedItems, hasEpisodeMarkers } = groupItemsByEpisode(parsedItems);

    // Collect all remote items
    const allRemoteItems: RemoteItem[] = [];
    groupedEpisodes.forEach(ep => {
      ep.remoteItems.forEach(item => allRemoteItems.push(item));
    });
    ungroupedItems.forEach(item => allRemoteItems.push(item));

    const artworkUrl = parseArtworkUrl(xmlText);
    console.log(`📋 Found ${allRemoteItems.length} remote items in ${groupedEpisodes.length} episodes`);

    // Resolve tracks
    const resolvedTracks = await resolvePlaylistItems(allRemoteItems);
    console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

    // Feed discovery for unresolved
    const unresolvedItems = allRemoteItems.filter(item => {
      return !resolvedTracks.find(track => track.playlistContext?.itemGuid === item.itemGuid);
    });

    if (unresolvedItems.length > 0) {
      try {
        const addedFeedsCount = await processPlaylistFeedDiscovery(unresolvedItems);
        console.log(`✅ Feed discovery: ${addedFeedsCount} new feeds added`);
      } catch (error) {
        console.error('❌ Error during feed discovery:', error);
      }
    }

    // Build tracks with episode context
    const resolvedTrackMap = new Map(
      resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
    );

    const allTracks = allRemoteItems.map((item) => {
      const resolvedTrack = resolvedTrackMap.get(item.itemGuid);
      if (resolvedTrack) {
        return {
          id: resolvedTrack.id,
          title: resolvedTrack.title,
          artist: resolvedTrack.artist,
          audioUrl: resolvedTrack.audioUrl || '',
          url: resolvedTrack.audioUrl || '',
          duration: validateDuration(resolvedTrack.duration, resolvedTrack.title) || 180,
          publishedAt: resolvedTrack.publishedAt || new Date().toISOString(),
          image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `${resolvedTrack.title} by ${resolvedTrack.artist}`,
          albumTitle: resolvedTrack.albumTitle,
          feedTitle: resolvedTrack.feedTitle,
          feedId: resolvedTrack.feedId,
          guid: resolvedTrack.guid,
          v4vValue: resolvedTrack.v4vValue,
          v4vRecipient: resolvedTrack.v4vRecipient,
          episodeId: item.episodeId,
          episodeTitle: item.episodeTitle,
          episodeIndex: item.episodeIndex
        };
      }
      return null;
    }).filter(Boolean);

    const tracks = allTracks.filter(track => {
      if (!track || !track.url || track.url.length === 0) return false;
      if (track.id.startsWith('api-')) return false;
      return true;
    });

    console.log(`🎯 Filtered tracks: ${allTracks.length} -> ${tracks.length} playable`);

    // Build episode groups
    const episodes: EpisodeGroup[] = hasEpisodeMarkers ? groupedEpisodes.map((ep, index) => {
      const episodeTracks = tracks.filter((t: any) => t.episodeId === generateEpisodeId(ep.title));
      return {
        id: generateEpisodeId(ep.title),
        title: ep.title,
        trackCount: episodeTracks.length,
        tracks: episodeTracks,
        index
      };
    }) : [];

    console.log(`📺 Built ${episodes.length} episode groups`);

    const playlistAlbum = {
      id: 'flowgnar-playlist',
      title: 'Flowgnar Music Playlist',
      artist: 'Various Artists',
      description: 'Music from the Flowgnar podcast',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg',
      url: FLOWGNAR_PLAYLIST_URL,
      tracks,
      feedId: 'flowgnar-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true,
      playlistUrl: '/playlist/flowgnar',
      episodes,
      hasEpisodeMarkers,
      playlistContext: {
        source: 'flowgnar-playlist',
        originalUrl: FLOWGNAR_PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: allRemoteItems.length,
        totalEpisodes: episodes.length
      }
    };

    const responseData = {
      success: true,
      albums: [playlistAlbum],
      totalCount: 1,
      playlist: {
        title: 'Flowgnar Music Playlist',
        description: 'Music from the Flowgnar podcast',
        author: 'ChadF',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };

    // Save to database on refresh
    if (forceRefresh) {
      try {
        console.log('💾 Saving Flowgnar playlist to database...');
        await prisma.systemPlaylist.upsert({
          where: { id: 'flowgnar' },
          update: { title: 'Flowgnar Music Playlist', description: 'Music from the Flowgnar podcast', artwork: artworkUrl },
          create: { id: 'flowgnar', title: 'Flowgnar Music Playlist', description: 'Music from the Flowgnar podcast', artwork: artworkUrl }
        });
        await prisma.systemPlaylistTrack.deleteMany({ where: { playlistId: 'flowgnar' } });
        const trackInserts = tracks
          .filter((track: any) => track.id && !track.id.startsWith('api-'))
          .map((track: any, index: number) => ({ playlistId: 'flowgnar', trackId: track.id, position: index, episodeId: track.episodeId || null }));
        if (trackInserts.length > 0) {
          await prisma.systemPlaylistTrack.createMany({ data: trackInserts, skipDuplicates: true });
        }
        console.log(`💾 Saved ${trackInserts.length} tracks to SystemPlaylist`);
      } catch (dbError) {
        console.error('❌ Error saving to SystemPlaylist:', dbError);
      }
    }

    playlistCache.setCachedData('flowgnar-playlist', responseData);
    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching Flowgnar playlist:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function resolvePlaylistItems(remoteItems: RemoteItem[]) {
  try {
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 Looking up ${itemGuids.length} unique track GUIDs`);

    const tracks = await prisma.track.findMany({
      where: { guid: { in: itemGuids } },
      include: { Feed: true },
      orderBy: [{ trackOrder: 'asc' }, { publishedAt: 'asc' }]
    });

    console.log(`📊 Found ${tracks.length} matching tracks in database`);

    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: any[] = [];
    const unresolvedItems: RemoteItem[] = [];

    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);
      if (track && track.Feed) {
        resolvedTracks.push({
          id: track.id,
          title: track.title,
          artist: track.artist || (track.Feed.artist === 'Unresolved GUID' ? track.Feed.title : track.Feed.artist) || 'Unknown Artist',
          audioUrl: track.audioUrl,
          url: track.audioUrl,
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: track.image || track.Feed.image || '/placeholder-podcast.jpg',
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          feedId: track.Feed.id,
          guid: track.guid,
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: 'flowgnar-playlist'
          }
        });
      } else {
        unresolvedItems.push(remoteItem);
      }
    }

    // API resolution for unresolved items
    if (unresolvedItems.length > 0) {
      const maxToProcess = Math.min(100, unresolvedItems.length);
      console.log(`🔍 Resolving ${maxToProcess} items via API...`);

      const BATCH_SIZE = 10;
      for (let i = 0; i < maxToProcess; i += BATCH_SIZE) {
        const batch = unresolvedItems.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (remoteItem) => {
            try {
              const apiResult = await resolveItemGuid(remoteItem.feedGuid, remoteItem.itemGuid);
              return { remoteItem, apiResult };
            } catch {
              return { remoteItem, apiResult: null };
            }
          })
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value.apiResult) {
            const { remoteItem, apiResult } = result.value;
            resolvedTracks.push({
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
              playlistContext: {
                feedGuid: remoteItem.feedGuid,
                itemGuid: remoteItem.itemGuid,
                source: 'flowgnar-playlist',
                resolvedViaAPI: true
              }
            });
          }
        }

        if (i + BATCH_SIZE < maxToProcess) {
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
