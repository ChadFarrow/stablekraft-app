/**
 * Audio Prefetch Utility
 * Prefetches upcoming audio tracks using the Cache API for smooth radio playback
 */

const CACHE_NAME = 'stablekraft-audio-cache-v1';
const MAX_CACHED_TRACKS = 3;

// Track which URLs are currently being fetched
const fetchingUrls = new Set<string>();
// Track which URLs have been cached
const cachedUrls = new Set<string>();

/**
 * Prefetch an audio URL into the browser cache
 */
export async function prefetchAudio(url: string): Promise<boolean> {
  if (!url || cachedUrls.has(url) || fetchingUrls.has(url)) {
    return false;
  }

  // Upgrade HTTP to HTTPS
  const secureUrl = url.startsWith('http://') ? url.replace(/^http:/, 'https:') : url;

  try {
    fetchingUrls.add(secureUrl);

    // Check if already in cache
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(secureUrl);

    if (cached) {
      cachedUrls.add(secureUrl);
      fetchingUrls.delete(secureUrl);
      console.log('📦 Audio already cached:', secureUrl.slice(-50));
      return true;
    }

    // Fetch and cache the audio
    console.log('⬇️ Prefetching audio:', secureUrl.slice(-50));

    const response = await fetch(secureUrl, {
      mode: 'cors',
      credentials: 'omit',
    });

    if (response.ok) {
      // Clone the response before caching (responses can only be used once)
      await cache.put(secureUrl, response.clone());
      cachedUrls.add(secureUrl);
      console.log('✅ Audio cached successfully:', secureUrl.slice(-50));
      fetchingUrls.delete(secureUrl);
      return true;
    } else {
      console.warn('⚠️ Failed to prefetch audio:', response.status);
      fetchingUrls.delete(secureUrl);
      return false;
    }
  } catch (error) {
    // CORS errors are expected for some audio sources - fail silently
    console.log('⚠️ Could not prefetch (likely CORS):', secureUrl.slice(-50));
    fetchingUrls.delete(secureUrl);
    return false;
  }
}

/**
 * Prefetch multiple upcoming tracks
 */
export async function prefetchUpcomingTracks(
  tracks: Array<{ url?: string; title?: string }>,
  startIndex: number = 0
): Promise<void> {
  const tracksToFetch = tracks.slice(startIndex, startIndex + MAX_CACHED_TRACKS);

  // Prefetch in sequence to avoid overwhelming the network
  for (const track of tracksToFetch) {
    if (track?.url) {
      await prefetchAudio(track.url);
    }
  }
}

/**
 * Clear old cached audio to free up space
 */
export async function clearAudioCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
    cachedUrls.clear();
    console.log('🗑️ Audio cache cleared');
  } catch (error) {
    console.warn('Failed to clear audio cache:', error);
  }
}

/**
 * Get cache stats
 */
export async function getCacheStats(): Promise<{ count: number; urls: string[] }> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    return {
      count: keys.length,
      urls: keys.map(req => req.url)
    };
  } catch {
    return { count: 0, urls: [] };
  }
}

/**
 * Check if a URL is cached
 */
export function isUrlCached(url: string): boolean {
  const secureUrl = url.startsWith('http://') ? url.replace(/^http:/, 'https:') : url;
  return cachedUrls.has(secureUrl);
}

/**
 * Check if a URL is currently being fetched
 */
export function isUrlFetching(url: string): boolean {
  const secureUrl = url.startsWith('http://') ? url.replace(/^http:/, 'https:') : url;
  return fetchingUrls.has(secureUrl);
}
