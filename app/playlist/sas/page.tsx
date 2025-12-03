'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const sasConfig: PlaylistConfig = {
  title: 'Sats and Sounds Music Playlist',
  description: 'Curated playlist from Sats and Sounds podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/sas-fast', // Fast endpoint with progressive loading + client-side pagination
  cacheKey: 'sas-playlist-v5', // Bumped to v5 for episode grouping
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function SASPlaylistPage() {
  return <PlaylistTemplateCompact config={sasConfig} />;
}