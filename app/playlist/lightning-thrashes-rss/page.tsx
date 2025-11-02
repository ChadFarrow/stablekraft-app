'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const LIGHTNING_THRASHES_RSS_CONFIG: PlaylistConfig = {
  cacheKey: 'lightning_thrashes_rss_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/lightning-thrashes-rss',
  title: 'Lightning Thrashes Music Playlist',
  description: 'Every music reference from Lightning Thrashes podcast',
  useAudioContext: true
};

export default function LightningThrashesRSSPlaylistPage() {
  return <PlaylistTemplateCompact config={LIGHTNING_THRASHES_RSS_CONFIG} />;
} 