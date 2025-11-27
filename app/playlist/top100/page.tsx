'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const TOP100_CONFIG: PlaylistConfig = {
  cacheKey: 'top100_playlist_cache_v1',
  cacheDuration: 1000 * 60 * 30, // 30 minutes (source updates hourly)
  apiEndpoint: '/api/playlist/top100',
  title: 'Top 100 V4V Music',
  description: 'The hottest tracks in the Value4Value music economy, updated hourly',
  useAudioContext: true
};

export default function Top100PlaylistPage() {
  return <PlaylistTemplateCompact config={TOP100_CONFIG} />;
}
