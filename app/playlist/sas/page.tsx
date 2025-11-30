'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const sasConfig: PlaylistConfig = {
  title: 'Sats and Sounds Music Playlist',
  description: 'Curated playlist from Sats and Sounds podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/sas', // Use regular endpoint with client-side pagination
  cacheKey: 'sas-playlist-v3', // Bumped to v3 for pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function SASPlaylistPage() {
  return <PlaylistTemplateCompact config={sasConfig} />;
}