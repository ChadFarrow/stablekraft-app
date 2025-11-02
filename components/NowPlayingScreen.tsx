'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import { X, SkipBack, SkipForward, Play, Pause, Shuffle, Repeat, ChevronDown, Zap } from 'lucide-react';
import { getAlbumArtworkUrl } from '@/lib/cdn-utils';
import { adjustColorBrightness, ensureGoodContrast } from '@/lib/color-utils';
import { colorCache } from '@/lib/color-cache';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';

interface NowPlayingScreenProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function NowPlayingScreen({ isOpen, onClose }: NowPlayingScreenProps = {}) {
  const {
    currentPlayingAlbum,
    isPlaying,
    currentTrackIndex,
    currentTime,
    duration,
    isShuffleMode,
    repeatMode,
    setRepeatMode,
    playNextTrack,
    playPreviousTrack,
    pause,
    resume,
    seek,
    toggleShuffle,
    isFullscreenMode,
    setFullscreenMode,
  } = useAudio();

  const [isDragging, setIsDragging] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const [dominantColor, setDominantColor] = useState('#1A252F');
  const [contrastColors, setContrastColors] = useState({ backgroundColor: '#1A252F', textColor: '#ffffff' });
  const [showBoostModal, setShowBoostModal] = useState(false);

  const progressRef = useRef<HTMLDivElement>(null);

  // Get current track info
  const currentTrack = currentPlayingAlbum?.tracks?.[currentTrackIndex];

  // Debug: Log V4V data availability
  useEffect(() => {
    if (currentTrack) {
      const trackKeys = Object.keys(currentTrack);
      console.log('⚡ NowPlayingScreen V4V Debug:', {
        trackTitle: currentTrack.title,
        hasV4vRecipient: !!currentTrack.v4vRecipient,
        hasV4vValue: !!currentTrack.v4vValue,
        v4vRecipient: currentTrack.v4vRecipient,
        v4vValue: currentTrack.v4vValue,
        trackKeyCount: trackKeys.length,
        trackKeys: trackKeys,
        fullTrackObject: currentTrack
      });
    }
  }, [currentTrack]);

  // Helper function to proxy external image URLs (same as GlobalNowPlayingBar)
  const getProxiedImageUrl = (imageUrl: string): string => {
    if (!imageUrl) return '';

    // If it's already a local/proxied URL, return as-is
    if (imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')) {
      return imageUrl;
    }

    // Proxy external URLs to avoid CORS issues
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  };

  // Helper function to brighten a hex color
  const brightenColor = (hex: string, percent: number): string => {
    // Remove # if present
    const color = hex.replace('#', '');

    // Parse RGB values
    const r = parseInt(color.substring(0, 2), 16);
    const g = parseInt(color.substring(2, 4), 16);
    const b = parseInt(color.substring(4, 6), 16);

    // Brighten each component
    const brightenComponent = (component: number): number => {
      // If the component is very dark, boost it much more aggressively
      if (component < 30) {
        return Math.min(255, component + (255 - component) * (percent / 100) + 120);
      }
      // For dark components, still boost significantly
      if (component < 80) {
        return Math.min(255, component + (255 - component) * (percent / 100) + 60);
      }
      // For brighter components, use standard brightening
      return Math.min(255, component + (255 - component) * (percent / 100));
    };

    const newR = Math.round(brightenComponent(r));
    const newG = Math.round(brightenComponent(g));
    const newB = Math.round(brightenComponent(b));

    // Convert back to hex
    const toHex = (n: number): string => n.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  };

  // Prioritize track image, fallback to album coverArt, and proxy external URLs
  const originalImageUrl = currentTrack?.image || currentPlayingAlbum?.coverArt || '';
  const albumArt = originalImageUrl
    ? getProxiedImageUrl(originalImageUrl)
    : '/api/placeholder/400/400';

  // Extract dominant color from album art and ensure good contrast
  useEffect(() => {
    console.log('🎨 useEffect triggered:', { albumArt, originalImageUrl, currentTrack: currentTrack?.title });

    if (albumArt && !albumArt.includes('/api/placeholder/')) {
      // Debug logging
      console.log('🎨 Fullscreen Color Extraction Debug:', {
        originalImageUrl,
        proxiedAlbumArt: albumArt,
        trackTitle: currentTrack?.title,
        isProxied: albumArt.includes('/api/proxy-image')
      });

      // Check database first
      const fetchColors = async () => {
        try {
          // First try to get from database
          const response = await fetch(`/api/artwork-colors?imageUrl=${encodeURIComponent(originalImageUrl)}`);

          if (response.ok) {
            const { data } = await response.json();
            if (process.env.NODE_ENV === 'development') {
              console.log('🎨 Using database colors for:', currentTrack?.title);
            }
            setDominantColor(data.enhancedColor);
            setContrastColors({
              backgroundColor: data.backgroundColor,
              textColor: data.textColor
            });
            return;
          }

          // If not in database, process and store it
          if (process.env.NODE_ENV === 'development') {
            console.log('🎨 Processing new color for database:', currentTrack?.title);
          }

          const processResponse = await fetch('/api/artwork-colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: originalImageUrl })
          });

          if (processResponse.ok) {
            const { data } = await processResponse.json();
            setDominantColor(data.enhancedColor);
            setContrastColors({
              backgroundColor: data.backgroundColor,
              textColor: data.textColor
            });
          } else {
            throw new Error('Failed to process color');
          }

        } catch (error) {
          console.warn('🎨 Database color processing failed, using fallback color:', error);

          // Use a deterministic fallback color based on track position
          const vibrantColors = ['#E11D48', '#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6', '#EF4444', '#06B6D4', '#84CC16', '#EC4899', '#10B981'];
          const colorIndex = (currentTrackIndex || 0) % vibrantColors.length;
          const color = vibrantColors[colorIndex];

          if (process.env.NODE_ENV === 'development') {
            console.log('🎨 Using deterministic fallback color:', color);
          }

          const brightenAmount = 40;
          const brightenedColor = brightenColor(color, brightenAmount);

          if (process.env.NODE_ENV === 'development') {
            console.log('🎨 Brightened fallback color:', brightenedColor, 'from original:', color);
          }

          setDominantColor(brightenedColor);
          const colors = ensureGoodContrast(brightenedColor);
          setContrastColors(colors);
        }
      };

      fetchColors();
    } else {
      const fallbackColor = '#1A252F';
      setDominantColor(fallbackColor);
      setContrastColors({ backgroundColor: fallbackColor, textColor: '#ffffff' });
    }
  }, [albumArt, currentTrackIndex, originalImageUrl, currentTrack?.title]);

  // Handle progress bar interaction
  const handleProgressClick = (e: React.MouseEvent) => {
    if (progressRef.current && duration > 0) {
      const rect = progressRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = x / rect.width;
      const newTime = percentage * duration;
      seek(newTime);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Use isFullscreenMode from AudioContext if isOpen prop is not provided
  const shouldShow = isOpen !== undefined ? isOpen : isFullscreenMode;


  if (!shouldShow || !currentPlayingAlbum || !currentTrack) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Solid Color Background - ITDV Style with good contrast */}
      <div 
        className="absolute inset-0 transition-all duration-1000"
        style={{
          backgroundColor: contrastColors.backgroundColor,
          background: `linear-gradient(180deg, ${contrastColors.backgroundColor} 0%, ${adjustColorBrightness(contrastColors.backgroundColor, -20)} 100%)`
        }}
      />
      
      {/* Content */}
      <div className="relative flex flex-col h-full" style={{
        color: contrastColors.textColor,
        paddingTop: 'max(env(safe-area-inset-top), 40px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)'
      }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-2">
          <button
            onClick={() => {
              if (onClose) {
                onClose();
              } else {
                setFullscreenMode(false);
              }
            }}
            className="p-2 rounded-full bg-black/20 backdrop-blur-sm hover:bg-black/30 transition-all duration-200"
          >
            <ChevronDown className="w-6 h-6" />
          </button>
          
          <div 
            className="text-center rounded-lg py-2 px-4 max-w-xs mx-auto"
            style={{
              backgroundColor: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)'
            }}
          >
            <p 
              className="text-sm font-medium"
              style={{
                color: contrastColors.textColor,
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                fontWeight: '500'
              }}
            >
              Playing from
            </p>
            <p 
              className="text-sm font-semibold truncate"
              style={{
                color: contrastColors.textColor,
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                fontWeight: '600'
              }}
            >
              {currentPlayingAlbum.title}
            </p>
          </div>
          
          <div className="w-10" /> {/* Spacer for center alignment */}
        </div>

        {/* Album Art */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="relative w-full max-w-sm aspect-square">
            <img
              src={albumArt}
              alt={currentPlayingAlbum.title}
              className="w-full h-full object-cover rounded-2xl shadow-2xl"
              style={{
                boxShadow: `0 25px 50px ${dominantColor}30`
              }}
            />

            {/* Boost Button - Top-left corner overlay */}
            {(currentTrack?.v4vRecipient || currentTrack?.v4vValue) && (
              <button
                onClick={() => setShowBoostModal(true)}
                className="absolute top-4 left-4 p-3 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg z-20"
                style={{
                  backgroundColor: '#FBBF24', // Yellow color
                  color: '#000000',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}
                title="Send a boost"
              >
                <Zap className="w-6 h-6" fill="#000000" />
              </button>
            )}

            {/* Favorite Button - Top-right corner overlay */}
            {currentTrack?.guid && (
              <div
                className="absolute top-4 right-4 z-20"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div
                  className="bg-black/60 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center pointer-events-auto touch-manipulation hover:bg-black/80 transition-colors shadow-lg"
                  style={{
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                  }}
                >
                  <FavoriteButton
                    trackId={currentTrack.guid}
                    size={22}
                    className="text-white"
                  />
                </div>
              </div>
            )}

            {/* Reflection effect */}
            <div
              className="absolute -bottom-4 left-0 right-0 h-20 bg-gradient-to-b from-transparent to-black/20 rounded-b-2xl"
              style={{
                background: `linear-gradient(to bottom, transparent 0%, ${dominantColor}10 100%)`
              }}
            />
          </div>
        </div>

        {/* Track Info */}
        <div className="px-8 pb-6 text-center">
          <h1 className="text-2xl font-bold mb-2 truncate">
            {currentTrack.title || 'Unknown Track'}
          </h1>
          <p className="text-lg opacity-80 truncate">
            {currentPlayingAlbum.artist || 'Unknown Artist'}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="px-8 pb-6">
          <div
            ref={progressRef}
            className="relative h-1 rounded-full cursor-pointer"
            style={{
              backgroundColor: `${contrastColors.textColor}30`
            }}
            onClick={handleProgressClick}
          >
            <div
              className="absolute h-full rounded-full transition-all duration-100"
              style={{
                width: `${progress}%`,
                backgroundColor: contrastColors.textColor
              }}
            />
            <div
              className="absolute w-3 h-3 rounded-full shadow-lg transform -translate-y-1/2 transition-all duration-100"
              style={{
                left: `${progress}%`,
                transform: `translateX(-50%) translateY(-50%)`,
                backgroundColor: contrastColors.textColor,
                boxShadow: `0 4px 12px rgba(0,0,0,0.3)`
              }}
            />
          </div>
          
          {/* Time Labels */}
          <div className="flex justify-between text-sm opacity-60 mt-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="px-8 pb-8">
          {/* All Controls in Single Row */}
          <div className="flex items-center justify-center gap-4">
            {/* Shuffle Button */}
            <button
              onClick={toggleShuffle}
              className="p-2 rounded-full transition-all duration-200"
              style={{
                backgroundColor: isShuffleMode
                  ? `${contrastColors.textColor}30`
                  : `${contrastColors.textColor}10`,
                color: isShuffleMode
                  ? contrastColors.textColor
                  : `${contrastColors.textColor}60`
              }}
            >
              <Shuffle className="w-5 h-5" />
            </button>

            {/* Previous Button */}
            <button
              onClick={playPreviousTrack}
              className="p-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                backgroundColor: `${contrastColors.textColor}20`,
                color: contrastColors.textColor
              }}
            >
              <SkipBack className="w-6 h-6" />
            </button>
            
            {/* Play/Pause Button */}
            <button
              onClick={isPlaying ? pause : resume}
              className="p-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg mx-2"
              style={{
                backgroundColor: contrastColors.textColor,
                boxShadow: `0 8px 25px rgba(0,0,0,0.3)`
              }}
            >
              {isPlaying ? (
                <Pause className="w-8 h-8" style={{ color: contrastColors.backgroundColor }} />
              ) : (
                <Play className="w-8 h-8 ml-1" style={{ color: contrastColors.backgroundColor }} />
              )}
            </button>
            
            {/* Next Button */}
            <button
              onClick={playNextTrack}
              className="p-3 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                backgroundColor: `${contrastColors.textColor}20`,
                color: contrastColors.textColor
              }}
            >
              <SkipForward className="w-6 h-6" />
            </button>
            
            {/* Repeat Button */}
            <button
              onClick={() => {
                // Cycle through repeat modes: none -> all -> one -> none
                const nextMode = repeatMode === 'none' ? 'all' : 
                                repeatMode === 'all' ? 'one' : 
                                'none';
                console.log('🔂 Fullscreen repeat button clicked:', { currentMode: repeatMode, nextMode });
                setRepeatMode(nextMode);
              }}
              className="p-2 rounded-full transition-all duration-200 relative"
              style={{
                backgroundColor: repeatMode !== 'none'
                  ? `${contrastColors.textColor}30` 
                  : `${contrastColors.textColor}10`,
                color: repeatMode !== 'none'
                  ? contrastColors.textColor 
                  : `${contrastColors.textColor}60`
              }}
              title={
                repeatMode === 'none' ? 'Enable repeat' : 
                repeatMode === 'one' ? 'Repeat one' : 
                'Repeat all'
              }
            >
              <Repeat className="w-5 h-5" />
              {repeatMode === 'one' && (
                <span 
                  className="absolute -top-1 -right-1 text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold"
                  style={{
                    backgroundColor: contrastColors.textColor,
                    color: contrastColors.backgroundColor
                  }}
                >
                  1
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Boost Modal */}
      {showBoostModal && currentTrack && (
        <BoostButton
          trackId={currentTrack.guid}
          feedId={currentPlayingAlbum.feedId || currentPlayingAlbum.id}
          trackTitle={currentTrack.title}
          artistName={currentPlayingAlbum.artist || 'Unknown Artist'}
          lightningAddress={currentTrack.v4vRecipient}
          valueSplits={currentTrack.v4vValue?.recipients}
          autoOpen={true}
          onClose={() => setShowBoostModal(false)}
          feedUrl={currentPlayingAlbum.feedUrl || currentPlayingAlbum.link}
          episodeGuid={currentTrack.guid}
          remoteFeedGuid={currentPlayingAlbum.feedGuid || currentPlayingAlbum.guid}
          albumName={currentPlayingAlbum.title}
        />
      )}
    </div>
  );
}