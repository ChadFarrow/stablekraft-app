'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const upbeatsConfig: PlaylistConfig = {
  title: 'Upbeats Playlist',
  description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/upbeats-fast', // Fast endpoint with progressive loading + client-side pagination
  cacheKey: 'upbeats-playlist-v4', // Bumped to v4 for fast + pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function UpbeatsPlaylistPage() {
  return <PlaylistTemplateCompact config={upbeatsConfig} />;
}