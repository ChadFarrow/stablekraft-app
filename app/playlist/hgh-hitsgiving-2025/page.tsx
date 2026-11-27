'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const hghHitsgiving2025Config: PlaylistConfig = {
  title: 'Homegrown Hits Hitsgiving 2025 Playlist',
  description: 'The songs of Homegrown Hits Episode 112, the Hitsgiving 2025 special, in play order',
  apiEndpoint: '/api/playlist/hgh-hitsgiving-2025-fast',
  cacheKey: 'hghHitsgiving2025-playlist-v1',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function HGHHitsgiving2025PlaylistPage() {
  return <PlaylistTemplateCompact config={hghHitsgiving2025Config} />;
}
