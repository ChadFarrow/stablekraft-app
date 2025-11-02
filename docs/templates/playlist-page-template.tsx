'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

/**
 * TEMPLATE: New Playlist Page
 * 
 * This is the standard template for creating new playlist pages.
 * All playlist pages should follow this exact structure.
 * 
 * Copy this file to create a new playlist page:
 * 
 * 1. Create a new directory: app/playlist/[playlist-name]/page.tsx
 * 2. Replace all placeholder values below with your actual values
 * 3. Ensure the API endpoint exists and returns JSON in the correct format
 * 
 * Replace these placeholders:
 * - [PLAYLIST_NAME] -> your playlist name (e.g., "new_playlist")
 * - [PlaylistName] -> PascalCase version (e.g., "NewPlaylist")
 * - [PLAYLIST_TITLE] -> display title (e.g., "New Playlist Music")
 * - [PLAYLIST_DESCRIPTION] -> description text
 * - [API_ENDPOINT] -> API route path (e.g., "new-playlist")
 * - [CACHE_KEY] -> unique cache key (e.g., "new_playlist")
 * 
 * Example API response format:
 * {
 *   "success": true,
 *   "tracks": [...] 
 *   // OR
 *   "albums": [{
 *     "title": "Playlist Title",
 *     "tracks": [...],
 *     "coverArt": "https://...",
 *     "image": "https://..."
 *   }]
 * }
 */

// Replace this constant name and all placeholder values
const PLAYLIST_NAME_CONFIG: PlaylistConfig = {
  cacheKey: 'playlist_name_playlist_cache_v2', // Replace 'playlist_name' with your cache key
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/playlist-name', // Replace 'playlist-name' with your API endpoint
  title: 'Playlist Title', // Replace with your playlist title
  description: 'Playlist description', // Replace with your playlist description
  useAudioContext: true
};

export default function PlaylistNamePage() { // Replace 'PlaylistName' with your component name
  return <PlaylistTemplateCompact config={PLAYLIST_NAME_CONFIG} />; // Replace 'PLAYLIST_NAME_CONFIG' with your config constant name
}

