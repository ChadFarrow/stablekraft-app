'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';
import LoadingSpinner from '@/components/LoadingSpinner';

function PlaylistContent() {
  const searchParams = useSearchParams();
  const feedId = searchParams?.get('feedId');

  const PLAYLIST_CONFIG: PlaylistConfig = {
    cacheKey: feedId ? `playlist_${feedId}_cache_v2` : 'generic_playlist_cache_v2',
    cacheDuration: 1000 * 60 * 30, // 30 minutes
    apiEndpoint: feedId ? `/api/playlist?format=json&feedId=${feedId}` : '/api/playlist?format=json',
    title: feedId ? 'Playlist' : 'Music Playlist',
    description: feedId ? 'Custom playlist' : 'General music playlist',
    useAudioContext: true
  };

  return <PlaylistTemplateCompact config={PLAYLIST_CONFIG} />;
}

export default function PlaylistPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PlaylistContent />
    </Suspense>
  );
} 