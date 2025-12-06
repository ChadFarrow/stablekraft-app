import { NextResponse } from 'next/server';
import { processPlaylistFeedDiscovery, resolveItemGuid } from '@/lib/feed-discovery';
import { playlistCache } from '@/lib/playlist-cache';
import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';

const ITDV_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';

// Persistent cache duration - 90 days for static playlists (manual refresh when needed)
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours for daily updates

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
    console.log('🎵 Fetching ITDV playlist...', { userAgent: request.headers.get('user-agent')?.slice(0, 50) });
    
    // Check for force refresh parameter
    const forceRefresh = new URL(request.url).searchParams.has('refresh');

    // FAST PATH: Try database first (instant, no XML fetch needed)
    if (!forceRefresh) {
      try {
        const dbPlaylist = await prisma.systemPlaylist.findUnique({
          where: { id: 'itdv' },
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
            id: 'itdv-playlist', title: dbPlaylist.title, artist: 'ChadF',
            description: dbPlaylist.description, image: dbPlaylist.artwork, tracks,
            episodes, hasEpisodeMarkers: episodes.length > 0, totalTracks: tracks.length,
            publishedAt: dbPlaylist.updatedAt.toISOString(), isPlaylistCard: true, playlistUrl: '/playlist/itdv',
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

    // Check persistent cache first
    if (!forceRefresh && playlistCache.isCacheValid('itdv-playlist', CACHE_DURATION)) {
      const cachedData = playlistCache.getCachedData('itdv-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }
    
    // Fetch the playlist XML
    const response = await fetch(ITDV_PLAYLIST_URL, {
      headers: {
        'User-Agent': 'StableKraft-Playlist-Parser/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }
    
    const xmlText = await response.text();
    console.log('📄 Fetched playlist XML, length:', xmlText.length);

    // Parse the XML with episode markers
    const parsedItems = parsePlaylistWithEpisodes(xmlText);
    const { episodes: groupedEpisodes, ungroupedItems, hasEpisodeMarkers } = groupItemsByEpisode(parsedItems);

    // Collect all remote items (from episodes + ungrouped)
    const allRemoteItems: RemoteItem[] = [];
    groupedEpisodes.forEach(ep => {
      ep.remoteItems.forEach(item => allRemoteItems.push(item));
    });
    ungroupedItems.forEach(item => allRemoteItems.push(item));

    const artworkUrl = parseArtworkUrl(xmlText);
    console.log(`📋 Found ${allRemoteItems.length} remote items in ${groupedEpisodes.length} episodes (${hasEpisodeMarkers ? 'with' : 'without'} episode markers)`);
    console.log('🎨 Found artwork URL:', artworkUrl);

    // Resolve playlist items to get actual track data from the database
    console.log('🔍 Resolving playlist items to actual tracks...');
    const resolvedTracks = await resolvePlaylistItems(allRemoteItems);
    console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

    // Auto-discover and add unresolved feeds to database
    const unresolvedItems = allRemoteItems.filter(item => {
      return !resolvedTracks.find(track => track.playlistContext?.itemGuid === item.itemGuid);
    });

    if (unresolvedItems.length > 0) {
      console.log(`🔍 Processing ${unresolvedItems.length} unresolved items for feed discovery...`);
      try {
        const addedFeedsCount = await processPlaylistFeedDiscovery(unresolvedItems);
        console.log(`✅ Feed discovery: ${addedFeedsCount} new feeds added to database`);
      } catch (error) {
        console.error('❌ Error during feed discovery:', error);
      }
    }

    // Create a map of resolved tracks by itemGuid for quick lookup
    const resolvedTrackMap = new Map(
      resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
    );

    // Create tracks for ALL remote items, using resolved data when available
    const allTracks = allRemoteItems.map((item, index) => {
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
          description: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in ITDV podcast`,
          albumTitle: resolvedTrack.albumTitle,
          feedTitle: resolvedTrack.feedTitle,
          feedId: resolvedTrack.feedId,
          guid: resolvedTrack.guid,
          v4vValue: resolvedTrack.v4vValue,
          v4vRecipient: resolvedTrack.v4vRecipient,
          // Episode context
          episodeId: item.episodeId,
          episodeTitle: item.episodeTitle,
          episodeIndex: item.episodeIndex
        };
      } else {
        return null;
      }
    }).filter(Boolean);

    // Filter to only include tracks with valid audio URLs AND real database IDs
    const tracks = allTracks.filter(track => {
      if (!track || !track.url || track.url.length === 0) return false;
      if (track.id.startsWith('api-')) return false;
      if (track.id.startsWith('itdv-track-')) return false;
      return true;
    });

    console.log(`🎯 Filtered tracks: ${allTracks.length} total -> ${tracks.length} playable`);

    // Build episode groups with resolved tracks
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

    console.log(`📺 Built ${episodes.length} episode groups with tracks`);
    
    // Create a single virtual album that represents the ITDV playlist
    const playlistAlbum = {
      id: 'itdv-playlist',
      title: 'ITDV Music Playlist',
      artist: 'Various Artists',
      album: 'ITDV Music Playlist',
      description: 'Every music reference from Into The Doerfel-Verse podcast',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg',
      url: ITDV_PLAYLIST_URL,
      tracks: tracks,
      feedId: 'itdv-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true,
      playlistUrl: '/playlist/itdv',
      albumUrl: '/album/itdv-music-playlist',
      // Episode grouping
      episodes,
      hasEpisodeMarkers,
      playlistContext: {
        source: 'itdv-playlist',
        originalUrl: ITDV_PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: allRemoteItems.length,
        totalEpisodes: episodes.length
      }
    };
    
    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);
    
    const responseData = {
      success: true,
      albums: [playlistAlbum], // Return as single album
      totalCount: 1,
      playlist: {
        title: 'ITDV Music Playlist',
        description: 'Every music reference from Into The Doerfel-Verse podcast',
        author: 'ChadF',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };

    // Save to SystemPlaylist table for instant page loads (only on refresh)
    if (forceRefresh) {
      try {
        console.log('💾 Saving ITDV playlist to database...');
        await prisma.systemPlaylist.upsert({
          where: { id: 'itdv' },
          update: { title: 'ITDV Music Playlist', description: 'Every music reference from Into The Doerfel-Verse podcast', artwork: artworkUrl },
          create: { id: 'itdv', title: 'ITDV Music Playlist', description: 'Every music reference from Into The Doerfel-Verse podcast', artwork: artworkUrl }
        });
        await prisma.systemPlaylistTrack.deleteMany({ where: { playlistId: 'itdv' } });
        // Use 'tracks' (filtered) not 'resolvedTracks' - api-* IDs don't exist in Track table
        const trackInserts = tracks
          .filter((track: any) => track.id && !track.id.startsWith('api-') && !track.id.startsWith('itdv-track-'))
          .map((track: any, index: number) => ({ playlistId: 'itdv', trackId: track.id, position: index, episodeId: track.episodeId || null }));
        if (trackInserts.length > 0) {
          await prisma.systemPlaylistTrack.createMany({ data: trackInserts, skipDuplicates: true });
        }
        console.log(`💾 Saved ${trackInserts.length} tracks to SystemPlaylist`);
      } catch (dbError) {
        console.error('❌ Error saving to SystemPlaylist:', dbError);
      }
    }

    // Cache the response
    playlistCache.setCachedData('itdv-playlist', responseData);
    
    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('❌ Error fetching ITDV playlist:', error);
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
        const resolvedTrack = {
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
            source: 'itdv-playlist'
          }
        };
        
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
                  source: 'itdv-playlist',
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
    
    return resolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving playlist items:', error);
    return [];
  }
}