'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const MMM_CONFIG: PlaylistConfig = {
  cacheKey: 'mmm_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/mmm',
  title: 'Modern Music Movements Playlist',
  description: 'Every music reference from Modern Music Movements podcast',
  useAudioContext: true
};

export default function MMMPlaylistPage() {
  // Force rebuild - using PlaylistTemplateCompact
  return <PlaylistTemplateCompact config={MMM_CONFIG} />;
}