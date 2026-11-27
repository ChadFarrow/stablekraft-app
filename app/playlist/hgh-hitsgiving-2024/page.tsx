'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const hghHitsgiving2024Config: PlaylistConfig = {
  title: 'Homegrown Hits Hitsgiving 2024 Playlist',
  description: 'The songs of Homegrown Hits Episode 62, the Hitsgiving 2024 special, in play order',
  apiEndpoint: '/api/playlist/hgh-hitsgiving-2024-fast',
  cacheKey: 'hghHitsgiving2024-playlist-v1',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function HGHHitsgiving2024PlaylistPage() {
  return <PlaylistTemplateCompact config={hghHitsgiving2024Config} />;
}
