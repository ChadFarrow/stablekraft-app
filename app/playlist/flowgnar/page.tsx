'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const FLOWGNAR_CONFIG: PlaylistConfig = {
  cacheKey: 'flowgnar_playlist_cache_v3', // Bumped to v3 for fast + pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/flowgnar-fast', // Fast endpoint with progressive loading + client-side pagination
  title: 'Flowgnar Music Playlist',
  description: 'Curated playlist from Flowgnar podcast featuring Value4Value independent artists',
  useAudioContext: true
};

export default function FlowgnarPlaylistPage() {
  return <PlaylistTemplateCompact config={FLOWGNAR_CONFIG} />;
}