'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const MMM_CONFIG: PlaylistConfig = {
  cacheKey: 'mmm_playlist_cache_v6', // Bumped to v6 for fast + pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/mmm-fast', // Fast endpoint with progressive loading + client-side pagination
  title: 'Mutton, Mead & Music Playlist',
  description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
  useAudioContext: true
};

export default function MMMPlaylistPage() {
  // Force rebuild - using PlaylistTemplateCompact
  return <PlaylistTemplateCompact config={MMM_CONFIG} />;
}