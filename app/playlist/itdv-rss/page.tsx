'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const ITDV_RSS_CONFIG: PlaylistConfig = {
  cacheKey: 'itdv_rss_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/itdv',
  title: 'Into The Doerfel-Verse Music Playlist',
  description: 'Every music reference from Into The Doerfel-Verse podcast',
  useAudioContext: true
};

export default function ITDVRSSPlaylistPage() {
  return <PlaylistTemplateCompact config={ITDV_RSS_CONFIG} />;
}
