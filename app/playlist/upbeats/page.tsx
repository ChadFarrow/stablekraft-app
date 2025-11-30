'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const upbeatsConfig: PlaylistConfig = {
  title: 'Upbeats Playlist',
  description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/upbeats', // Use regular endpoint with client-side pagination
  cacheKey: 'upbeats-playlist-v3', // Bumped to v3 for pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function UpbeatsPlaylistPage() {
  return <PlaylistTemplateCompact config={upbeatsConfig} />;
}