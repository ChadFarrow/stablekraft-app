/**
 * Track deduplication utilities
 */
import { createErrorLogger } from '../error-utils';
import type { MusicTrack } from './types';

export class TrackDeduplicator {
  private static readonly logger = createErrorLogger('TrackDeduplicator');

  /**
   * Deduplicate tracks based on title, episode, and source priority
   * Prioritizes value-split tracks over chapter tracks for better V4V data
   */
  static deduplicateTracks(tracks: MusicTrack[]): MusicTrack[] {
    const trackMap = new Map<string, MusicTrack>();

    // Sort tracks to prioritize value-split tracks over chapter tracks
    const sortedTracks = tracks.sort((a, b) => {
      // Prioritize value-split tracks (they have V4V data)
      if (a.source === 'value-split' && b.source === 'chapter') return -1;
      if (a.source === 'chapter' && b.source === 'value-split') return 1;

      // Prioritize tracks with V4V data
      const aHasV4V = a.valueForValue?.feedGuid && a.valueForValue?.itemGuid;
      const bHasV4V = b.valueForValue?.feedGuid && b.valueForValue?.itemGuid;
      if (aHasV4V && !bHasV4V) return -1;
      if (!aHasV4V && bHasV4V) return 1;

      // Prioritize resolved V4V tracks
      if (a.valueForValue?.resolved && !b.valueForValue?.resolved) return -1;
      if (!a.valueForValue?.resolved && b.valueForValue?.resolved) return 1;

      return 0;
    });

    for (const track of sortedTracks) {
      // Create deduplication keys based on different strategies
      const keys = [];

      // Strategy 1: Episode + title (for tracks with same title in same episode)
      const titleKey = `${track.episodeId}-${track.title.toLowerCase().trim()}`;
      keys.push(titleKey);

      // Strategy 2: Episode + start time (for exact timing matches)
      const timeKey = `${track.episodeId}-${track.startTime}`;
      keys.push(timeKey);

      // Strategy 3: V4V reference (for same V4V track referenced multiple ways)
      if (track.valueForValue?.feedGuid && track.valueForValue?.itemGuid) {
        const v4vKey = `v4v-${track.valueForValue.feedGuid}-${track.valueForValue.itemGuid}`;
        keys.push(v4vKey);
      }

      // Check if any of these keys already exist
      const existingKey = keys.find(key => trackMap.has(key));

      if (!existingKey) {
        // No duplicate found, add this track and all its keys
        keys.forEach(key => trackMap.set(key, track));
      } else {
        // Duplicate found, check if current track should replace the existing one
        const existingTrack = trackMap.get(existingKey)!;
        const shouldReplace = this.shouldReplaceTrack(existingTrack, track);

        if (shouldReplace) {
          // Remove old track's keys
          const oldKeys = this.generateTrackKeys(existingTrack);
          oldKeys.forEach(oldKey => trackMap.delete(oldKey));

          // Add new track's keys
          keys.forEach(key => trackMap.set(key, track));

          this.logger.info('Replaced duplicate track', {
            old: { title: existingTrack.title, source: existingTrack.source, startTime: existingTrack.startTime },
            new: { title: track.title, source: track.source, startTime: track.startTime }
          });
        } else {
          this.logger.warn('Duplicate track removed', {
            title: track.title,
            startTime: track.startTime,
            source: track.source,
            reason: 'Lower priority than existing track'
          });
        }
      }
    }

    // Get unique tracks from the map
    const uniqueTracksSet = new Set(trackMap.values());
    const deduplicatedTracks = Array.from(uniqueTracksSet);

    this.logger.info('Deduplication completed', {
      originalCount: tracks.length,
      deduplicatedCount: deduplicatedTracks.length,
      duplicatesRemoved: tracks.length - deduplicatedTracks.length
    });

    return deduplicatedTracks;
  }

  /**
   * Generate all possible keys for a track for deduplication cleanup
   */
  private static generateTrackKeys(track: MusicTrack): string[] {
    const keys = [];

    // Title key
    keys.push(`${track.episodeId}-${track.title.toLowerCase().trim()}`);

    // Time key
    keys.push(`${track.episodeId}-${track.startTime}`);

    // V4V key
    if (track.valueForValue?.feedGuid && track.valueForValue?.itemGuid) {
      keys.push(`v4v-${track.valueForValue.feedGuid}-${track.valueForValue.itemGuid}`);
    }

    return keys;
  }

  /**
   * Determine if a new track should replace an existing duplicate
   */
  private static shouldReplaceTrack(existing: MusicTrack, candidate: MusicTrack): boolean {
    // Prioritize value-split tracks over chapter tracks
    if (candidate.source === 'value-split' && existing.source === 'chapter') return true;
    if (candidate.source === 'chapter' && existing.source === 'value-split') return false;

    // Prioritize tracks with V4V data
    const candidateHasV4V = candidate.valueForValue?.feedGuid && candidate.valueForValue?.itemGuid;
    const existingHasV4V = existing.valueForValue?.feedGuid && existing.valueForValue?.itemGuid;
    if (candidateHasV4V && !existingHasV4V) return true;
    if (!candidateHasV4V && existingHasV4V) return false;

    // Prioritize resolved V4V tracks
    if (candidate.valueForValue?.resolved && !existing.valueForValue?.resolved) return true;
    if (!candidate.valueForValue?.resolved && existing.valueForValue?.resolved) return false;

    // Prioritize tracks with longer duration (more complete)
    if (candidate.duration > existing.duration) return true;
    if (candidate.duration < existing.duration) return false;

    // Keep existing track by default
    return false;
  }
}