'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import { PlaylistConfig } from '@/types/playlist';

const obshConfig: PlaylistConfig = {
  title: 'The OnlyBoosts Social Hour Music Playlist',
  description: 'Every music reference from The OnlyBoosts Social Hour',
  apiEndpoint: '/api/playlist/obsh-fast',
  cacheKey: 'obsh-playlist-v1',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  useAudioContext: true
};

export default function OBSHPlaylistPage() {
  return <PlaylistTemplateCompact config={obshConfig} />;
}
