'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const FLOWGNAR_CONFIG: PlaylistConfig = {
  cacheKey: 'flowgnar_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/flowgnar',
  title: 'Flowgnar Music Playlist',
  description: 'Curated playlist from Flowgnar podcast featuring Value4Value independent artists',
  useAudioContext: true
};

export default function FlowgnarPlaylistPage() {
  return <PlaylistTemplateCompact config={FLOWGNAR_CONFIG} />;
}