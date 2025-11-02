'use client';

import React from 'react';
import NowPlaying from './NowPlaying';
import { useAudio } from '@/contexts/AudioContext';

const GlobalNowPlayingBar: React.FC = () => {
  const {
    currentPlayingAlbum,
    isPlaying,
    currentTrackIndex,
    currentTime,
    duration,
    isShuffleMode,
    repeatMode,
    setRepeatMode,
    isFullscreenMode,
    setFullscreenMode,
    pause,
    resume,
    seek,
    playNextTrack,
    playPreviousTrack,
    stop,
    toggleShuffle
  } = useAudio();

  // Don't render if nothing is playing or if fullscreen mode is active
  if (!currentPlayingAlbum || isFullscreenMode) {
    return null;
  }

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const handleSeek = (time: number) => {
    seek(time);
  };

  const handleClose = () => {
    stop();
  };

  const handleOpenFullscreen = () => {
    setFullscreenMode(true);
  };

  const handleToggleRepeat = () => {
    // Cycle through repeat modes: none -> all -> one -> none
    const nextMode = repeatMode === 'none' ? 'all' : 
                     repeatMode === 'all' ? 'one' : 
                     'none';
    console.log('🔂 Repeat button clicked:', { currentMode: repeatMode, nextMode });
    setRepeatMode(nextMode);
  };

  // Helper function to proxy external image URLs
  const getProxiedImageUrl = (imageUrl: string): string => {
    if (!imageUrl) return '';

    // If it's already a local/proxied URL, return as-is
    if (imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')) {
      return imageUrl;
    }

    // Proxy external URLs to avoid CORS issues
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  };

  // Create track object for NowPlaying component
  const currentTrack = {
    title: currentPlayingAlbum.tracks?.[currentTrackIndex]?.title || `Track ${currentTrackIndex + 1}`,
    artist: currentPlayingAlbum.artist,
    albumTitle: currentPlayingAlbum.title,
    duration: duration || 0,
    // Prioritize individual track image, fallback to album coverArt, and proxy external URLs
    albumArt: getProxiedImageUrl(
      currentPlayingAlbum.tracks?.[currentTrackIndex]?.image || currentPlayingAlbum.coverArt || ''
    )
  };

  // Debug logging for artwork troubleshooting
  if (process.env.NODE_ENV === 'development' && currentPlayingAlbum.tracks?.[currentTrackIndex]) {
    const track = currentPlayingAlbum.tracks[currentTrackIndex];
    const originalUrl = track.image || currentPlayingAlbum.coverArt || '';
    console.log('🎨 Now Playing Artwork Debug:', {
      trackTitle: track.title,
      trackImage: track.image,
      albumCoverArt: currentPlayingAlbum.coverArt,
      originalUrl: originalUrl,
      proxiedUrl: currentTrack.albumArt,
      hasTrackImage: !!track.image,
      hasAlbumCoverArt: !!currentPlayingAlbum.coverArt,
      isExternalUrl: originalUrl && !originalUrl.startsWith('/') && !originalUrl.includes('/api/proxy-image')
    });
  }

  return (
    <div style={{ 
      position: 'fixed', 
      bottom: 0, 
      left: 0, 
      right: 0, 
      padding: '16px',
      paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', // Add iOS safe area padding
      backgroundColor: '#1f2937',
      borderTop: '1px solid #f97316',
      zIndex: 50
    }}>
      <NowPlaying
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        isShuffleMode={isShuffleMode}
        repeatMode={repeatMode}
        onPlayPause={handlePlayPause}
        onPrevious={playPreviousTrack}
        onNext={playNextTrack}
        onSeek={handleSeek}
        onClose={handleClose}
        onToggleShuffle={toggleShuffle}
        onToggleRepeat={handleToggleRepeat}
        onOpenFullscreen={handleOpenFullscreen}
      />
    </div>
  );
};

export default GlobalNowPlayingBar; 