'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const MMM_CONFIG: PlaylistConfig = {
  cacheKey: 'mmm_playlist_cache_v9', // Bumped to v9 to fix missing episode headers
  cacheDuration: 1000 * 60 * 60 * 6, // 6 hours (increased from 30 minutes for better performance)
  apiEndpoint: '/api/playlist/mmm-fast', // Fast endpoint with progressive loading + client-side pagination
  title: 'Mutton, Mead & Music Playlist',
  description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
  useAudioContext: true
};

export default function MMMPlaylistPage() {
  // Force rebuild - using PlaylistTemplateCompact
  return <PlaylistTemplateCompact config={MMM_CONFIG} />;
}