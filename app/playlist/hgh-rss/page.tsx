'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const HGH_RSS_CONFIG: PlaylistConfig = {
  cacheKey: 'hgh_rss_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/hgh',
  title: 'Homegrown Hits Music Playlist',
  description: 'Every music reference from Homegrown Hits podcast',
  useAudioContext: true
};

export default function HGHRSSPlaylistPage() {
  return <PlaylistTemplateCompact config={HGH_RSS_CONFIG} />;
}