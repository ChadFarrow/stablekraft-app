'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const TOP100_MUSIC_CONFIG: PlaylistConfig = {
  cacheKey: 'top100_music_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/top100-music',
  title: 'Top 100 Music - Value for Value Charts',
  description: 'The top 100 music tracks by value received in sats, showcasing the most supported Value for Value music content',
  useAudioContext: true
};

export default function Top100MusicPage() {
  return <PlaylistTemplateCompact config={TOP100_MUSIC_CONFIG} />;
}