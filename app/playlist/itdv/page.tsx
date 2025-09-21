'use client';

import PlaylistTemplate from '@/components/PlaylistTemplate';
import type { PlaylistConfig } from '@/types/playlist';

const ITDV_CONFIG: PlaylistConfig = {
  cacheKey: 'itdv_playlist_cache',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/itdv-resolved-songs',
  title: 'Into The Doerfel-Verse',
  description: 'Music tracks from the Into The Doerfel-Verse podcast',
  useAudioContext: true
};

export default function ITDVPlaylistPage() {
  return <PlaylistTemplate config={ITDV_CONFIG} />;
}