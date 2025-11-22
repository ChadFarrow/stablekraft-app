'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const upbeatsConfig: PlaylistConfig = {
  title: 'Upbeats Playlist',
  description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/upbeats-fast', // Use fast endpoint with progressive loading
  cacheKey: 'upbeats-playlist-v2', // Bumped to v2 for correct feed order
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function UpbeatsPlaylistPage() {
  return <PlaylistTemplateCompact config={upbeatsConfig} />;
}