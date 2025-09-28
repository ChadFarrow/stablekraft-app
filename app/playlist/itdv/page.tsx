'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

export const dynamic = 'force-dynamic';

const ITDV_CONFIG: PlaylistConfig = {
  cacheKey: 'itdv_playlist_cache',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/itdv',
  title: 'ITDV Music Playlist',
  description: 'Every music reference from Into The Doerfel-Verse podcast',
  useAudioContext: true
};

export default function ITDVPlaylistPage() {
  return <PlaylistTemplateCompact config={ITDV_CONFIG} />;
}