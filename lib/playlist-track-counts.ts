/**
 * Utility for dynamically fetching playlist track counts from XML files
 * Counts <podcast:remoteItem> tags in each playlist XML
 */

// Fallback counts to return immediately on cold cache (updated Dec 6, 2025)
const FALLBACK_COUNTS: Record<string, number> = {
  'mmm': 1606,
  'upbeats': 609,
  'b4ts': 562,
  'sas': 728,
  'mmt': 172,
  'hgh': 922,
  'iam': 340,
  'itdv': 125,
  'flowgnar': 188,
};

// Playlist XML URLs from the chadf-musicl-playlists repo
const PLAYLIST_URLS: Record<string, string> = {
  'mmm': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml',
  'upbeats': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml',
  'b4ts': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml',
  'sas': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml',
  'mmt': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml',
  'hgh': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml',
  'iam': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml',
  'itdv': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml',
  'flowgnar': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-music-playlist.xml',
};

// Cache for track counts - refreshes every 6 hours
interface TrackCountCache {
  counts: Record<string, number>;
  timestamp: number;
}

let trackCountCache: TrackCountCache | null = null;
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours

/**
 * Count <podcast:remoteItem> tags in an XML string
 */
function countRemoteItems(xml: string): number {
  const matches = xml.match(/<podcast:remoteItem[^>]*>/g);
  return matches ? matches.length : 0;
}

/**
 * Fetch track count for a single playlist
 */
async function fetchPlaylistTrackCount(playlistId: string): Promise<number> {
  const url = PLAYLIST_URLS[playlistId];
  if (!url) {
    console.warn(`No URL configured for playlist: ${playlistId}`);
    return 0;
  }

  try {
    const response = await fetch(url, {
      next: { revalidate: 3600 }, // Cache for 1 hour at fetch level
    });

    if (!response.ok) {
      console.error(`Failed to fetch playlist XML for ${playlistId}: ${response.status}`);
      return 0;
    }

    const xml = await response.text();
    return countRemoteItems(xml);
  } catch (error) {
    console.error(`Error fetching playlist ${playlistId}:`, error);
    return 0;
  }
}

// Track if background refresh is in progress to avoid duplicate fetches
let isRefreshing = false;

/**
 * Trigger background refresh of track counts (non-blocking)
 */
function triggerBackgroundRefresh(): void {
  if (isRefreshing) return;
  isRefreshing = true;

  console.log('🔄 Background fetching playlist track counts from XML files...');

  const playlistIds = Object.keys(PLAYLIST_URLS);
  const countPromises = playlistIds.map(async (id) => {
    const count = await fetchPlaylistTrackCount(id);
    return { id, count };
  });

  Promise.all(countPromises)
    .then((results) => {
      const counts: Record<string, number> = {};
      for (const { id, count } of results) {
        counts[id] = count;
        console.log(`  📊 ${id}: ${count} tracks`);
      }

      trackCountCache = {
        counts,
        timestamp: Date.now(),
      };
      console.log('✅ Playlist track counts cached');
    })
    .catch((error) => {
      console.error('❌ Background refresh failed:', error);
    })
    .finally(() => {
      isRefreshing = false;
    });
}

/**
 * Get all playlist track counts (uses cache, returns fallbacks immediately if cold)
 */
export async function getAllPlaylistTrackCounts(): Promise<Record<string, number>> {
  // Check cache
  if (trackCountCache && (Date.now() - trackCountCache.timestamp) < CACHE_DURATION) {
    return trackCountCache.counts;
  }

  // Cache is cold - return fallbacks immediately, refresh in background
  console.log('⚡ Returning fallback track counts (cache cold)');
  triggerBackgroundRefresh();
  return FALLBACK_COUNTS;
}

/**
 * Get track count for a specific playlist (uses cache)
 */
export async function getPlaylistTrackCount(playlistId: string): Promise<number> {
  const counts = await getAllPlaylistTrackCounts();
  return counts[playlistId] || 0;
}

/**
 * Force refresh of track counts cache
 */
export function invalidateTrackCountCache(): void {
  trackCountCache = null;
  console.log('🗑️ Track count cache invalidated');
}

/**
 * Get the XML URL for a playlist
 */
export function getPlaylistXmlUrl(playlistId: string): string | undefined {
  return PLAYLIST_URLS[playlistId];
}
