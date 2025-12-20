/**
 * Database resolver for playlist tracks
 */

import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';
import type { RemoteItem, ResolvedTrack, EpisodeGroup, PlaylistConfig, GroupedItems } from './types';
import { generateEpisodeId } from './parser';

/**
 * Resolve playlist items from database
 */
export async function resolvePlaylistItems(
  remoteItems: RemoteItem[],
  config: PlaylistConfig
): Promise<ResolvedTrack[]> {
  const startTime = Date.now();

  try {
    // Get unique item GUIDs from the playlist (these map to track.guid)
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 [${config.shortName}] Database lookup for ${itemGuids.length} unique track GUIDs`);

    // DATABASE-ONLY: Single optimized query with all needed data
    const tracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids },
        status: 'active'
      },
      select: {
        id: true,
        guid: true,
        title: true,
        artist: true,
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
    });

    const queryTime = Date.now() - startTime;
    console.log(`📊 [${config.shortName}] Database query completed in ${queryTime}ms - found ${tracks.length}/${itemGuids.length} tracks`);

    // Create a map for quick lookup by track GUID
    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: ResolvedTrack[] = [];

    // Single pass through remote items - only use database data
    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);

      if (track && track.Feed && track.audioUrl && track.guid) {
        const artistName = track.artist ||
          (track.Feed.artist === 'Unresolved GUID' ? track.Feed.title : track.Feed.artist) ||
          'Unknown Artist';
        const imageUrl = track.image || track.Feed.image || '/placeholder-podcast.jpg';

        resolvedTracks.push({
          id: track.id,
          title: track.title,
          artist: artistName,
          audioUrl: track.audioUrl,
          url: track.audioUrl,
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: imageUrl,
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          feedId: track.Feed.id,
          guid: track.guid,
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          episodeTitle: remoteItem.episodeTitle,
          episodeId: remoteItem.episodeId,
          episodeIndex: remoteItem.episodeIndex,
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: `${config.id}-playlist`
          }
        });
      }
    }

    // Final resolution statistics
    const totalTime = Date.now() - startTime;
    const resolutionRate = ((resolvedTracks.length / remoteItems.length) * 100).toFixed(1);

    console.log(`🎯 [${config.shortName}] DATABASE RESOLUTION COMPLETE (${totalTime}ms):`);
    console.log(`📊 Total Items: ${remoteItems.length}`);
    console.log(`📊 Database Resolved: ${resolvedTracks.length} (${resolutionRate}%)`);
    console.log(`📊 Missing from DB: ${remoteItems.length - resolvedTracks.length}`);

    if (resolvedTracks.length < remoteItems.length) {
      console.log(`💡 TIP: Run playlist parsing jobs to add missing tracks to database`);
    }

    return resolvedTracks;
  } catch (error) {
    console.error(`❌ [${config.shortName}] Error resolving playlist items:`, error);
    return [];
  }
}

/**
 * Build track objects with episode context and filtering
 */
export function buildTracksWithContext(
  remoteItems: RemoteItem[],
  resolvedTracks: ResolvedTrack[],
  artworkUrl: string | null,
  config: PlaylistConfig
): ResolvedTrack[] {
  // Create a map of resolved tracks by itemGuid for quick lookup
  const resolvedTrackMap = new Map(
    resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
  );

  // Create tracks for ALL remote items, using resolved data when available
  const tracksAll: (ResolvedTrack | null)[] = remoteItems.map((item) => {
    const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

    if (resolvedTrack) {
      const enrichedTrack: ResolvedTrack = {
        ...resolvedTrack,
        startTime: 0,
        endTime: validateDuration(resolvedTrack.duration, resolvedTrack.title) || 180,
        duration: validateDuration(resolvedTrack.duration, resolvedTrack.title) || 180,
        source: 'database',
        image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
        description: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in ${config.name}`,
        resolved: true,
        episodeTitle: item.episodeTitle || config.name,
        episodeId: item.episodeId,
        episodeIndex: item.episodeIndex
      };
      return enrichedTrack;
    }
    return null;
  });

  // Filter out null entries and tracks without audio URLs
  const tracks = tracksAll.filter((track): track is ResolvedTrack =>
    track !== null &&
    Boolean(track.audioUrl) &&
    track.audioUrl.length > 0 &&
    !track.audioUrl.includes('placeholder')
  );

  console.log(`🎯 [${config.shortName}] Filtered tracks: ${tracksAll.length} -> ${tracks.length}`);

  return tracks;
}

/**
 * Build episode groups from resolved tracks
 */
export function buildEpisodeGroups(
  groupedItems: GroupedItems,
  tracks: ResolvedTrack[]
): EpisodeGroup[] {
  if (!groupedItems.hasEpisodeMarkers) {
    return [];
  }

  return groupedItems.episodes.map((group, index) => {
    const episodeId = generateEpisodeId(group.title);
    const episodeTracks = tracks.filter(t => t.episodeId === episodeId);
    return {
      id: episodeId,
      title: group.title,
      trackCount: episodeTracks.length,
      tracks: episodeTracks,
      index
    };
  });
}

/**
 * Get playlist from database (fast path)
 */
export async function getPlaylistFromDatabase(config: PlaylistConfig): Promise<{
  found: boolean;
  response?: any;
}> {
  try {
    const dbPlaylist = await prisma.systemPlaylist.findUnique({
      where: { id: config.id },
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

    if (!dbPlaylist || dbPlaylist.tracks.length === 0) {
      return { found: false };
    }

    console.log(`⚡ [${config.shortName}] Using database playlist (${dbPlaylist.tracks.length} tracks)`);

    // Transform to expected response format
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
      guid: pt.track.guid,
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
    const episodes: EpisodeGroup[] = episodeIds.map((epId, idx) => {
      const episodeTracks = tracks.filter(t => t.episodeId === epId);
      return {
        id: epId!,
        title: epId?.replace('ep-', '').replace(/-/g, ' ') || 'Unknown Episode',
        trackCount: episodeTracks.length,
        tracks: episodeTracks as any,
        index: idx
      };
    });

    const playlistAlbum = {
      id: `${config.id}-playlist`,
      title: dbPlaylist.title,
      artist: config.author,
      description: dbPlaylist.description,
      image: dbPlaylist.artwork,
      link: dbPlaylist.link,
      tracks,
      episodes,
      hasEpisodeMarkers: episodes.length > 0,
      totalTracks: tracks.length,
      publishedAt: dbPlaylist.updatedAt.toISOString(),
      isPlaylistCard: true,
      playlistUrl: config.playlistUrl,
      albumUrl: config.albumUrl,
      type: 'playlist' as const
    };

    return {
      found: true,
      response: {
        success: true,
        albums: [playlistAlbum],
        totalCount: 1,
        fromDatabase: true,
        playlist: {
          title: dbPlaylist.title,
          description: dbPlaylist.description,
          author: config.author,
          totalItems: 1,
          items: [playlistAlbum]
        }
      }
    };
  } catch (dbError) {
    console.log(`⚠️ [${config.shortName}] Database lookup failed:`, dbError);
    return { found: false };
  }
}

/**
 * Save playlist to database for instant loads
 */
export async function savePlaylistToDatabase(
  config: PlaylistConfig,
  tracks: ResolvedTrack[],
  artworkUrl: string | null,
  playlistLink: string | null
): Promise<void> {
  try {
    console.log(`💾 [${config.shortName}] Saving playlist to database...`);

    // Upsert the playlist metadata
    await prisma.systemPlaylist.upsert({
      where: { id: config.id },
      update: {
        title: config.name,
        description: config.description,
        artwork: artworkUrl,
        link: playlistLink,
      },
      create: {
        id: config.id,
        title: config.name,
        description: config.description,
        artwork: artworkUrl,
        link: playlistLink,
      }
    });

    // Delete existing tracks and re-insert with new positions
    await prisma.systemPlaylistTrack.deleteMany({
      where: { playlistId: config.id }
    });

    // Insert tracks with positions
    const trackInserts = tracks
      .map((track, index) => ({
        playlistId: config.id,
        trackId: track.id,
        position: index,
        episodeId: track.episodeId || null,
      }))
      .filter(t => t.trackId);

    if (trackInserts.length > 0) {
      await prisma.systemPlaylistTrack.createMany({
        data: trackInserts,
        skipDuplicates: true,
      });
    }

    console.log(`💾 [${config.shortName}] Saved ${trackInserts.length} tracks to SystemPlaylist`);
  } catch (dbError) {
    console.error(`❌ [${config.shortName}] Error saving to SystemPlaylist:`, dbError);
    // Don't fail the request if DB save fails
  }
}
