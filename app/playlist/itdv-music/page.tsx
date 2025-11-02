'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const ITDV_MUSIC_CONFIG: PlaylistConfig = {
  cacheKey: 'itdv_music_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/itdv-music',
  title: 'ITDV Music Library',
  description: 'Original music tracks from Into The Doerfel Verse with V4V resolution',
  useAudioContext: true
};

export default function ITDVMusicPlaylistPage() {
  return <PlaylistTemplateCompact config={ITDV_MUSIC_CONFIG} />;
}
