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
    maxDuration: TIMEOUT_FAST,
    playlistUrl: '/playlist/mmm',
    albumUrl: '/album/modern-music-movements-playlist',
  },

  hgh: {
    id: 'hgh',
    url: `${GITHUB_BASE}/HGH-music-playlist.xml`,
    name: 'High Grade Hits Playlist',
    shortName: 'HGH',
    author: 'ChadF',
    description: 'High Grade Hits - Premium Value4Value music selections',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/hgh',
    albumUrl: '/album/high-grade-hits-playlist',
  },

  sas: {
    id: 'sas',
    url: `${GITHUB_BASE}/SAS-music-playlist.xml`,
    name: 'Satellite & Scope Playlist',
    shortName: 'SAS',
    author: 'ChadF',
    description: 'Satellite & Scope - Curated Value4Value music discoveries',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/sas',
    albumUrl: '/album/satellite-scope-playlist',
  },

  b4ts: {
    id: 'b4ts',
    url: `${GITHUB_BASE}/b4ts-music-playlist.xml`,
    name: 'Beats 4 The Streets Playlist',
    shortName: 'B4TS',
    author: 'ChadF',
    description: 'Beats 4 The Streets - Urban Value4Value music selections',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/b4ts',
    albumUrl: '/album/beats-4-the-streets-playlist',
  },

  itdv: {
    id: 'itdv',
    url: `${GITHUB_BASE}/ITDV-music-playlist.xml`,
    name: 'In The Digital Void Playlist',
    shortName: 'ITDV',
    author: 'ChadF',
    description: 'In The Digital Void - Electronic Value4Value music',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/itdv',
    albumUrl: '/album/in-the-digital-void-playlist',
  },

  iam: {
    id: 'iam',
    url: `${GITHUB_BASE}/IAM-music-playlist.xml`,
    name: 'Independent Artist Mainstage Playlist',
    shortName: 'IAM',
    author: 'ChadF',
    description: 'Independent Artist Mainstage - Featured Value4Value artists',
    cacheDuration: CACHE_6_HOURS,
    maxDuration: TIMEOUT_STANDARD,
    playlistUrl: '/playlist/iam',
    albumUrl: '/album/independent-artist-mainstage-playlist',
  },

  mmt: {
    id: 'mmt',
    url: `${GITHUB_BASE}/MMT-muic-playlist.xml`, // Note: typo in original filename
    name: 'Monday Music Time Playlist',
    shortName: 'MMT',
    author: 'ChadF',
    description: 'Monday Music Time - Weekly Value4Value music selections',
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
