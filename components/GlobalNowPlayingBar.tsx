'use client';

import React from 'react';
import NowPlaying from './NowPlaying';
import { useAudio } from '@/contexts/AudioContext';
import { getPlaceholderImageUrl } from '@/lib/cdn-utils';

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

  // Get the artwork URL with proper fallbacks
  const getArtworkUrl = React.useCallback((trackIndex: number): string => {
    if (!currentPlayingAlbum) return getPlaceholderImageUrl('thumbnail');

    const track = currentPlayingAlbum.tracks?.[trackIndex];
    const trackImage = track?.image;
    const albumCoverArt = currentPlayingAlbum.coverArt;

    // Prioritize track image, then album cover art
    // Check if track image is valid
    if (trackImage && trackImage.trim() !== '' && trackImage !== 'null') {
      return getProxiedImageUrl(trackImage);
    }

    // Fallback to album cover art if valid
    if (albumCoverArt && albumCoverArt.trim() !== '' && albumCoverArt !== 'null') {
      return getProxiedImageUrl(albumCoverArt);
    }

    // Use placeholder when no artwork is available
    return getPlaceholderImageUrl('thumbnail');
  }, [currentPlayingAlbum]);

  // Create track object for NowPlaying component
  // Use useMemo to ensure the object reference changes when dependencies change
  const currentTrack = React.useMemo(() => {
    if (!currentPlayingAlbum) return null;

    const track = currentPlayingAlbum.tracks?.[currentTrackIndex];
    return {
      id: track?.id || track?.guid || track?.episodeId || `${currentPlayingAlbum.id || currentPlayingAlbum.title}-${currentTrackIndex}`,
      title: track?.title || `Track ${currentTrackIndex + 1}`,
      artist: track?.artist || currentPlayingAlbum.artist,
      albumTitle: currentPlayingAlbum.title,
      duration: duration || 0,
      // Get artwork URL with proper fallbacks
      albumArt: getArtworkUrl(currentTrackIndex)
    };
  }, [currentPlayingAlbum, currentTrackIndex, duration, getArtworkUrl]);

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

  // Don't render if currentTrack is null
  if (!currentTrack) {
    return null;
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