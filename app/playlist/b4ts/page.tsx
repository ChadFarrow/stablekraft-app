'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const b4tsConfig: PlaylistConfig = {
  title: 'Behind the Sch3m3s Music Playlist',
  description: 'Curated playlist from Behind the Sch3m3s podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/b4ts', // Use regular endpoint with caching
  cacheKey: 'b4ts-playlist',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function B4TSPlaylistPage() {
  return <PlaylistTemplateCompact config={b4tsConfig} />;
}