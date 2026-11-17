/**
 * Canonical playback key for offline downloads.
 *
 * Both the download path (given a track's media URL) and the playback path
 * (AudioContext's getAudioUrlsToTry, given the same media URL) must derive an
 * IDENTICAL key so a downloaded blob is found at play time. This is a pure,
 * SSR-safe function (no window / DOM access) shared by both sides.
 *
 * It mirrors the normalization AudioContext applies before building its URL
 * candidate list: unwrap op3.dev analytics wrappers, encode stray spaces, and
 * upgrade http -> https. It deliberately does NOT apply the proxy rewrite —
 * the key is the ORIGINAL media URL (the download is then fetched via the
 * proxy when the host needs it).
 */
export function primaryPlaybackKey(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';

  let url = rawUrl;

  // Unwrap op3.dev analytics wrappers so the key is the real media URL.
  if (url.includes('op3.dev/e/') && url.includes('/https://')) {
    const direct = url.split('/https://')[1];
    if (direct) {
      url = `https://${direct}`;
    }
  }

  // Encode stray spaces (many RSS feeds ship unencoded spaces).
  if (url.includes(' ') && !url.includes('%20')) {
    url = url.replace(/ /g, '%20');
  }

  // Upgrade http -> https.
  if (url.startsWith('http://')) {
    url = url.replace(/^http:/, 'https:');
  }

  return url;
}

/** True for streaming formats that can't be saved as a single blob (HLS). */
export function isNonDownloadableUrl(url: string | undefined | null): boolean {
  return Boolean(url && typeof url === 'string' && url.toLowerCase().includes('.m3u8'));
}
