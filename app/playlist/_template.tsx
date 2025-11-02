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
 * 2. Replace [PLAYLIST_NAME] with your playlist name
 * 3. Replace [PLAYLIST_TITLE] with your playlist title
 * 4. Replace [PLAYLIST_DESCRIPTION] with your playlist description
 * 5. Replace [API_ENDPOINT] with your API endpoint path
 * 6. Replace [CACHE_KEY] with a unique cache key
 * 7. Ensure the API endpoint returns JSON in one of these formats:
 *    - { tracks: Track[] }
 *    - { albums: [{ tracks: Track[] }] }
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

const [PLAYLIST_NAME]_CONFIG: PlaylistConfig = {
  cacheKey: '[CACHE_KEY]_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/[API_ENDPOINT]',
  title: '[PLAYLIST_TITLE]',
  description: '[PLAYLIST_DESCRIPTION]',
  useAudioContext: true
};

export default function [PlaylistName]PlaylistPage() {
  return <PlaylistTemplateCompact config={[PLAYLIST_NAME]_CONFIG} />;
}

