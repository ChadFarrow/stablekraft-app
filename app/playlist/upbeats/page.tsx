'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

export const dynamic = 'force-dynamic';

const upbeatsConfig: PlaylistConfig = {
  title: 'Upbeats Playlist',
  description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/upbeats', // Use regular endpoint with full data
  cacheKey: 'upbeats-playlist',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function UpbeatsPlaylistPage() {
  return <PlaylistTemplateCompact config={upbeatsConfig} />;
}