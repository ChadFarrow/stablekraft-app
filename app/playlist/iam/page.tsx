'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const IAM_CONFIG: PlaylistConfig = {
  cacheKey: 'iam_playlist_cache_v5', // Bumped to v5 for fast + pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/iam-fast', // Fast endpoint with progressive loading + client-side pagination
  title: 'It\'s A Mood Music Playlist',
  description: 'Every music reference from It\'s A Mood podcast',
  useAudioContext: true
};

export default function IAMPlaylistPage() {
  // Force rebuild - using PlaylistTemplateCompact
  return <PlaylistTemplateCompact config={IAM_CONFIG} />;
}