/**
 * Playlist configurations
 * Each playlist has its own config with URL, cache settings, and metadata
 */

import type { PlaylistConfig } from './types';

const GITHUB_BASE = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs';

// Cache durations
const CACHE_6_HOURS = 1000 * 60 * 60 * 6;
const CACHE_12_HOURS = 1000 * 60 * 60 * 12;

// Timeout durations (seconds)
const TIMEOUT_FAST = 60;      // For database-only operations
const TIMEOUT_STANDARD = 300; // For operations that may need API calls

export const PLAYLIST_CONFIGS: Record<string, PlaylistConfig> = {
  mmm: {
    id: 'mmm',
    url: `${GITHUB_BASE}/MMM-music-playlist.xml`,
    name: 'Mutton, Mead & Music Playlist',
    shortName: 'MMM',
    author: 'ChadF',
    description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
    cacheDuration: CACHE_12_HOURS,
    maxDuration: TIMEOUT_STANDARD, // MMM has 1,685+ tracks - needs longer timeout
    playlistUrl: '/playlist/mmm',
    albumUrl: '/album/modern-music-movements-playlist',
  },

  hgh: {
    id: 'hgh',
    url: `${GITHUB_BASE}/HGH-music-playlist.xml`,
    name: 'Homegrown Hits Playlist',
    shortName: 'HGH',
    author: 'ChadF',
    description: 'Homegrown Hits - Premium Value4Value music selections',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/hgh',
    albumUrl: '/album/high-grade-hits-playlist',
  },
  // A supplement to hgh: the songs of one Hitsgiving episode (Homegrown Hits' Thanksgiving special).
  hghHitsgiving2024: {
    id: 'hghHitsgiving2024',
    url: `${GITHUB_BASE}/HGH-hitsgiving-2024-playlist.xml`,
    name: 'Homegrown Hits Hitsgiving 2024 Playlist',
    shortName: 'HGH Hitsgiving 2024',
    author: 'ChadF',
    description: 'The songs of Homegrown Hits Episode 62, the Hitsgiving 2024 special, in play order',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/hgh-hitsgiving-2024',
    albumUrl: '/playlist/hgh-hitsgiving-2024',
  },
  // A supplement to hgh: the songs of one Hitsgiving episode (Homegrown Hits' Thanksgiving special).
  hghHitsgiving2025: {
    id: 'hghHitsgiving2025',
    url: `${GITHUB_BASE}/HGH-hitsgiving-2025-playlist.xml`,
    name: 'Homegrown Hits Hitsgiving 2025 Playlist',
    shortName: 'HGH Hitsgiving 2025',
    author: 'ChadF',
    description: 'The songs of Homegrown Hits Episode 112, the Hitsgiving 2025 special, in play order',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/hgh-hitsgiving-2025',
    albumUrl: '/playlist/hgh-hitsgiving-2025',
  },
  // A supplement to hgh: the songs of one Hitsgiving episode (Homegrown Hits' Thanksgiving special).
  hghHitsgiving2026: {
    id: 'hghHitsgiving2026',
    url: `${GITHUB_BASE}/HGH-hitsgiving-2026-playlist.xml`,
    name: 'Homegrown Hits Hitsgiving 2026 Playlist',
    shortName: 'HGH Hitsgiving 2026',
    author: 'ChadF',
    description: 'The songs of Homegrown Hits Episode 160, the Hitsgiving 2026 special, in play order',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/hgh-hitsgiving-2026',
    albumUrl: '/playlist/hgh-hitsgiving-2026',
  },

  sas: {
    id: 'sas',
    url: `${GITHUB_BASE}/SAS-music-playlist.xml`,
    name: 'Sats & Sounds Playlist',
    shortName: 'SAS',
    author: 'ChadF',
    description: 'Sats & Sounds - Curated Value4Value music discoveries',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/sas',
    albumUrl: '/album/satellite-scope-playlist',
  },

  b4ts: {
    id: 'b4ts',
    url: `${GITHUB_BASE}/b4ts-music-playlist.xml`,
    name: 'Before The Sch3m3s Playlist',
    shortName: 'B4TS',
    author: 'ChadF',
    description: 'Before The Sch3m3s - Urban Value4Value music selections',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/b4ts',
    albumUrl: '/album/beats-4-the-streets-playlist',
  },

  itdv: {
    id: 'itdv',
    url: `${GITHUB_BASE}/ITDV-music-playlist.xml`,
    name: 'Into The Doerfel-Verse Playlist',
    shortName: 'ITDV',
    author: 'ChadF',
    description: 'Into The Doerfel-Verse - Electronic Value4Value music',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/itdv',
    albumUrl: '/album/in-the-digital-void-playlist',
  },

  iam: {
    id: 'iam',
    url: `${GITHUB_BASE}/IAM-music-playlist.xml`,
    name: "It's A Mood Playlist",
    shortName: 'IAM',
    author: 'ChadF',
    description: "It's A Mood - Featured Value4Value artists",
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/iam',
    albumUrl: '/album/independent-artist-mainstage-playlist',
  },

  mmt: {
    id: 'mmt',
    url: `${GITHUB_BASE}/MMT-muic-playlist.xml`, // Note: typo in original filename
    name: "Mike's Mix Tape Playlist",
    shortName: 'MMT',
    author: 'ChadF',
    description: "Mike's Mix Tape - Weekly Value4Value music selections",
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/mmt',
    albumUrl: '/album/monday-music-time-playlist',
  },

  upbeats: {
    id: 'upbeats',
    url: `${GITHUB_BASE}/upbeats-music-playlist.xml`,
    name: 'Upbeats Playlist',
    shortName: 'Upbeats',
    author: 'ChadF',
    description: 'Upbeats - Uplifting Value4Value music',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/upbeats',
    albumUrl: '/album/upbeats-playlist',
  },

  flowgnar: {
    id: 'flowgnar',
    url: `${GITHUB_BASE}/flowgnar-music-playlist.xml`,
    name: 'Flowgnar Playlist',
    shortName: 'Flowgnar',
    author: 'ChadF',
    description: 'Flowgnar - Flow and gnarly Value4Value music',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/flowgnar',
    albumUrl: '/album/flowgnar-playlist',
  },

  lt: {
    id: 'lt',
    url: `${GITHUB_BASE}/LT-music-playlist.xml`,
    name: 'Lightning Thrashes Music Playlist',
    shortName: 'LT',
    author: 'ChadF',
    description: 'Curated playlist from Lightning Thrashes featuring Value4Value independent artists',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/lt',
    albumUrl: '/album/lightning-thrashes-playlist',
  },

  tft: {
    id: 'tft',
    url: `${GITHUB_BASE}/TFT-music-playlist.xml`,
    name: 'Two for Tunestr Music Playlist',
    shortName: 'TFT',
    author: 'ChadF',
    description: 'Every music reference from Two for Tunestr',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/tft',
    albumUrl: '/album/tft-playlist',
  },

  obsh: {
    id: 'obsh',
    url: `${GITHUB_BASE}/OBSH-music-playlist.xml`,
    name: 'The OnlyBoosts Social Hour Music Playlist',
    shortName: 'OBSH',
    author: 'ChadF',
    description: 'Every music reference from The OnlyBoosts Social Hour',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/obsh',
    albumUrl: '/album/obsh-playlist',
  },

  greatestHits: {
    id: 'greatestHits',
    url: `${GITHUB_BASE}/Greatest-Hits-music-playlist.xml`,
    name: "ChadF's Greatest Hits Music Playlist",
    shortName: 'Greatest Hits',
    author: 'ChadF',
    description: 'Most frequently played tracks across all ChadF musicL playlists - songs appearing 2+ times, organized by play count',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/greatest-hits',
    albumUrl: '/album/greatest-hits-playlist',
  },
};

/**
 * Get config by playlist ID
 */
export function getPlaylistConfig(id: string): PlaylistConfig | undefined {
  return PLAYLIST_CONFIGS[id];
}

/**
 * Get all playlist IDs
 */
export function getAllPlaylistIds(): string[] {
  return Object.keys(PLAYLIST_CONFIGS);
}

/**
 * Get all playlist XML URLs (for excluding from DB queries)
 */
export function getPlaylistUrls(): string[] {
  return Object.values(PLAYLIST_CONFIGS).map(c => c.url);
}

/**
 * Fuzzy-match a query against playlist name, shortName, and id
 */
export function searchPlaylists(query: string): PlaylistConfig[] {
  const q = query.toLowerCase();
  return Object.values(PLAYLIST_CONFIGS).filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.shortName.toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q)
  );
}
