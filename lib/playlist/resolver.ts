/**
 * Database resolver for playlist tracks
 */

import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';
import type { RemoteItem, ResolvedTrack, EpisodeGroup, PlaylistConfig, GroupedItems } from './types';
import type { V4VValue } from '@/lib/v4v-utils';
import { generateEpisodeId } from './parser';
import { playlistTrackFromRow } from './db-track';
import { decodeHtmlEntities } from '@/lib/decode-entities';

/** Check if a URL looks like an actual image (not just a bare domain) */
function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    // Reject bare domains with no path (e.g. "http://thebearsnare.com")
    return parsed.pathname !== '/' && parsed.pathname !== '';
  } catch {
    return false;
  }
}

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
        chaptersUrl: true,
        chapters: true,
        valueTimeSplits: true,
        Feed: {
          select: {
            id: true,
            guid: true,
            title: true,
            artist: true,
            image: true
          }
        }
      }
    });

    const queryTime = Date.now() - startTime;
    console.log(`📊 [${config.shortName}] Database query completed in ${queryTime}ms - found ${tracks.length}/${itemGuids.length} tracks`);

    // Group tracks by GUID - multiple tracks can share the same GUID when the same song
    // appears in both its original album feed and a podcast show feed (e.g. UpBEATS).
    // We must prefer the track from the feed specified in the remoteItem's feedGuid so that
    // the correct value block (artist's, not the show's) is used.
    const tracksByGuid = new Map<string, Array<typeof tracks[0]>>();
    for (const track of tracks) {
      if (!track.guid) continue;
      const arr = tracksByGuid.get(track.guid);
      if (arr) {
        arr.push(track);
      } else {
        tracksByGuid.set(track.guid, [track]);
      }
    }

    const resolvedTracks: ResolvedTrack[] = [];

    // Single pass through remote items - only use database data
    for (const remoteItem of remoteItems) {
      const candidates = tracksByGuid.get(remoteItem.itemGuid);
      // Prefer the track whose Feed.guid matches the remoteItem's feedGuid;
      // fall back to the first candidate if no exact feed match is found.
      const track = candidates && candidates.length > 0
        ? (candidates.find(t => t.Feed?.guid === remoteItem.feedGuid) ?? candidates[0])
        : undefined;

      if (track && track.Feed && track.audioUrl && track.guid) {
        const artistName = track.artist ||
          (track.Feed.artist === 'Unresolved GUID' ? track.Feed.title : track.Feed.artist) ||
          'Unknown Artist';
        const imageUrl = (isValidImageUrl(track.image) ? track.image : null) || track.Feed.image || '/placeholder-podcast.jpg';

        resolvedTracks.push({
          id: track.id,
          title: decodeHtmlEntities(track.title),
          artist: decodeHtmlEntities(artistName),
          audioUrl: track.audioUrl,
          url: track.audioUrl,
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: imageUrl,
          albumTitle: decodeHtmlEntities(track.Feed.title),
          feedTitle: decodeHtmlEntities(track.Feed.title),
          feedId: track.Feed.id,
          guid: track.guid,
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue as V4VValue | null,
          chaptersUrl: (track as any).chaptersUrl || undefined,
          chapters: (track as any).chapters || undefined,
          valueTimeSplits: (track as any).valueTimeSplits || undefined,
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

  // Pre-index tracks by episodeId for O(1) lookups instead of O(n) per episode
  // This changes O(episodes × tracks) to O(tracks + episodes)
  const tracksByEpisode = new Map<string, ResolvedTrack[]>();
  for (const track of tracks) {
    if (track.episodeId) {
      const existing = tracksByEpisode.get(track.episodeId);
      if (existing) {
        existing.push(track);
      } else {
        tracksByEpisode.set(track.episodeId, [track]);
      }
    }
  }

  return groupedItems.episodes.map((group, index) => {
    const episodeId = generateEpisodeId(group.title);
    const episodeTracks = tracksByEpisode.get(episodeId) || [];
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
        SystemPlaylistTrack: {
          orderBy: { position: 'asc' },
          include: {
            Track: {
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
                chaptersUrl: true,
                chapters: true,
                valueTimeSplits: true,
                Feed: {
                  select: {
                    id: true,
                    // The track's real feed guid — see ./db-track.ts.
                    guid: true,
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

    if (!dbPlaylist || dbPlaylist.SystemPlaylistTrack.length === 0) {
      return { found: false };
    }

    console.log(`⚡ [${config.shortName}] Using database playlist (${dbPlaylist.SystemPlaylistTrack.length} tracks)`);

    // Transform to expected response format. The mapping lives in ./db-track.ts
    // so it can be tested without a database.
    const tracks = dbPlaylist.SystemPlaylistTrack.map(playlistTrackFromRow);

    // Build episode groups from database data using O(n) pre-indexing
    const tracksByEpisode = new Map<string, typeof tracks>();
    for (const track of tracks) {
      if (track.episodeId) {
        const existing = tracksByEpisode.get(track.episodeId);
        if (existing) {
          existing.push(track);
        } else {
          tracksByEpisode.set(track.episodeId, [track]);
        }
      }
    }

    const episodes: EpisodeGroup[] = Array.from(tracksByEpisode.entries()).map(([epId, episodeTracks], idx) => ({
      id: epId,
      title: episodeTracks[0]?.episodeTitle || epId.replace('ep-', '').replace(/-/g, ' ') || 'Unknown Episode',
      trackCount: episodeTracks.length,
      tracks: episodeTracks as any,
      index: idx
    }));

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
        updatedAt: new Date(),
        artwork: artworkUrl,
        link: playlistLink,
      }
    });

    // Delete existing tracks and re-insert with new positions
    await prisma.systemPlaylistTrack.deleteMany({
      where: { playlistId: config.id }
    });

    // Insert tracks with positions
    // Note: Due to @@unique([playlistId, trackId]), same track can only appear once
    // We keep the first occurrence of each track
    const seenTrackIds = new Set<string>();
    const trackInserts = tracks
      .map((track, index) => ({
        id: `${config.id}-${track.id}-${index}`, // Composite ID
        playlistId: config.id,
        trackId: track.id,
        position: index,
        episodeId: track.episodeId || null,
        episodeTitle: track.episodeTitle || null,
      }))
      .filter(t => {
        if (!t.trackId) return false;
        if (seenTrackIds.has(t.trackId)) return false; // Skip duplicates
        seenTrackIds.add(t.trackId);
        return true;
      });

    if (trackInserts.length > 0) {
      await prisma.systemPlaylistTrack.createMany({
        data: trackInserts,
        skipDuplicates: true,
      });
    }

    const skipped = tracks.length - trackInserts.length;
    console.log(`💾 [${config.shortName}] Saved ${trackInserts.length} tracks to SystemPlaylist${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`);
  } catch (dbError) {
    console.error(`❌ [${config.shortName}] Error saving to SystemPlaylist:`, dbError);
    // Don't fail the request if DB save fails
  }
}
