'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const hghHitsgiving2026Config: PlaylistConfig = {
  title: 'Homegrown Hits Hitsgiving 2026 Playlist',
  description: 'The songs of Homegrown Hits Episode 160, the Hitsgiving 2026 special, in play order',
  apiEndpoint: '/api/playlist/hgh-hitsgiving-2026-fast',
  cacheKey: 'hghHitsgiving2026-playlist-v1',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function HGHHitsgiving2026PlaylistPage() {
  return <PlaylistTemplateCompact config={hghHitsgiving2026Config} />;
}
