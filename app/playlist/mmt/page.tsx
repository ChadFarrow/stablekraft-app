'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const mmtConfig: PlaylistConfig = {
  title: "Mike's Mix Tape Music Playlist",
  description: 'Curated playlist from Mike\'s Mix Tape podcast featuring Value4Value independent artists',
  apiEndpoint: '/api/playlist/mmt-fast', // Fast endpoint with progressive loading + client-side pagination
  cacheKey: 'mmt-playlist-v4', // Bumped to v4 for fast + pagination
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function MMTPlaylistPage() {
  return <PlaylistTemplateCompact config={mmtConfig} />;
}