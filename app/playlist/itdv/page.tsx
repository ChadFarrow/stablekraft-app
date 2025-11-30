'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const ITDV_CONFIG: PlaylistConfig = {
  cacheKey: 'itdv_playlist_cache_v3', // Bumped to v3 for fast + pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/itdv-fast', // Fast endpoint with progressive loading + client-side pagination
  title: 'ITDV Music Playlist',
  description: 'Every music reference from Into The Doerfel-Verse podcast',
  useAudioContext: true
};

export default function ITDVPlaylistPage() {
  return <PlaylistTemplateCompact config={ITDV_CONFIG} />;
}