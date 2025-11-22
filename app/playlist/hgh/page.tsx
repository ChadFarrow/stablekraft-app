'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const HGH_CONFIG: PlaylistConfig = {
  cacheKey: 'hgh_playlist_cache_v4', // Bumped to v4 for correct feed order
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/hgh',
  title: 'HGH Music Playlist',
  description: 'Every music reference from Homegrown Hits podcast',
  useAudioContext: true
};

export default function HGHPlaylistPage() {
  // Force rebuild - using PlaylistTemplateCompact
  return <PlaylistTemplateCompact config={HGH_CONFIG} />;
} 