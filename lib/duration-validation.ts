/**
 * Duration validation utilities for music tracks
 */

// Maximum reasonable duration for a music track (2 hours in seconds)
const MAX_MUSIC_TRACK_DURATION = 7200;

/**
 * Validates and sanitizes duration values for music tracks
 * Returns undefined for obviously corrupted data (e.g., > 2 hours)
 */
export function validateDuration(duration: number | null | undefined, trackTitle?: string): number | undefined {
  if (!duration) return undefined;

  // Check for suspiciously long durations
  if (duration > MAX_MUSIC_TRACK_DURATION) {
    const hours = Math.floor(duration / 3600);
    const days = Math.floor(duration / 86400);
    console.warn(
      `⚠️  Suspicious duration detected for track "${trackTitle || 'Unknown'}": ` +
      `${duration}s (${days > 0 ? `${days}d ` : ''}${hours}h). ` +
      `This exceeds maximum expected duration for music (${MAX_MUSIC_TRACK_DURATION}s). ` +
      `Setting to undefined.`
    );
    return undefined;
  }

  return duration;
}
