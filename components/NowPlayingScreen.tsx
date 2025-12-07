'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAudio } from '@/contexts/AudioContext';
import { SkipBack, SkipForward, Play, Pause, Shuffle, Repeat, ChevronDown, Zap, Share2 } from 'lucide-react';
import { toast } from '@/components/Toast';
import { getAlbumArtworkUrl } from '@/lib/cdn-utils';
import { adjustColorBrightness, ensureGoodContrast } from '@/lib/color-utils';
import { colorCache } from '@/lib/color-cache';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { generateAlbumUrl } from '@/lib/url-utils';
import UserMenu from '@/components/UserMenu';

interface NowPlayingScreenProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function NowPlayingScreen({ isOpen, onClose }: NowPlayingScreenProps = {}) {
  const router = useRouter();
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
  const [titleOverflows, setTitleOverflows] = useState(false);

  const progressRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

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

  // Check if title overflows its container
  useEffect(() => {
    if (titleRef.current) {
      const overflows = titleRef.current.scrollWidth > titleRef.current.clientWidth;
      setTitleOverflows(overflows);
    }
  }, [currentTrack?.title]);

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
    if (albumArt && !albumArt.includes('/api/placeholder/')) {

      // Check database first
      const fetchColors = async () => {
        try {
          // First try to get from database (realtime=true for testing - remove after tuning)
          const response = await fetch(`/api/artwork-colors?imageUrl=${encodeURIComponent(originalImageUrl)}&realtime=true`);

          if (response.ok) {
            const { data } = await response.json();
            setDominantColor(data.enhancedColor);
            setContrastColors({
              backgroundColor: data.backgroundColor,
              textColor: data.textColor
            });
            return;
          }

          // If not in database, process and store it

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
    <div className="fixed top-0 left-0 right-0 z-50 overflow-hidden" style={{ height: '100dvh', minHeight: '100vh' }}>
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
        paddingTop: 'max(env(safe-area-inset-top), 16px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)'
      }}>
        {/* Header */}
        <div className="relative flex items-center justify-between p-4 pb-2">
          <button
            onClick={() => {
              if (onClose) {
                onClose();
              } else {
                setFullscreenMode(false);
              }
            }}
            className="p-2 rounded-full bg-black/20 backdrop-blur-sm hover:bg-black/30 transition-all duration-200 z-10"
          >
            <ChevronDown className="w-6 h-6" />
          </button>

          {/* Playing from button - absolutely centered */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Close fullscreen mode first
              if (onClose) {
                onClose();
              } else {
                setFullscreenMode(false);
              }
              // Then navigate to album page
              const albumUrl = generateAlbumUrl(currentPlayingAlbum.title);
              router.push(albumUrl);
            }}
            className="absolute left-1/2 -translate-x-1/2 text-center rounded-lg py-2 px-4 max-w-xs cursor-pointer hover:bg-black/50 active:scale-95 transition-all duration-200 z-10"
            style={{
              backgroundColor: 'rgba(0,0,0,0.4)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)'
            }}
          >
            <p
              className="text-sm font-medium pointer-events-none"
              style={{
                color: contrastColors.textColor,
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                fontWeight: '500'
              }}
            >
              Playing from
            </p>
            <p
              className="text-sm font-semibold truncate pointer-events-none"
              style={{
                color: contrastColors.textColor,
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                fontWeight: '600'
              }}
            >
              {currentPlayingAlbum.title}
            </p>
          </button>

          {/* User Menu */}
          <UserMenu />
        </div>

        {/* Album Art */}
        <div className="flex items-start justify-center px-8 pt-12">
          <div className="relative w-full max-w-sm aspect-square">
            <img
              src={albumArt}
              alt={currentPlayingAlbum.title}
              className="w-full h-full object-cover rounded-2xl shadow-2xl"
              style={{
                boxShadow: `0 25px 50px ${dominantColor}30`
              }}
            />

            {/* Boost Button - Top-left corner overlay - always show */}
            <button
              className="absolute top-4 left-4 z-20 p-3 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg pointer-events-auto touch-manipulation"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowBoostModal(true);
              }}
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

            {/* Favorite Button - Top-right corner overlay */}
            {currentTrack?.id && (
              <div
                className="absolute top-4 right-4 z-20"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div
                  className="backdrop-blur-md rounded-full w-12 h-12 flex items-center justify-center pointer-events-auto touch-manipulation active:scale-95 transition-all shadow-xl"
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    border: '2px solid rgba(255,255,255,0.1)'
                  }}
                >
                  <FavoriteButton
                    trackId={currentTrack.id}
                    size={28}
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
        <div className="px-8 pt-16 pb-6 text-center">
          <div className="overflow-hidden">
            <h1
              ref={titleRef}
              className={`text-2xl font-bold mb-2 whitespace-nowrap ${titleOverflows ? 'animate-marquee hover:animate-none' : ''}`}
            >
              <Link href={`${generateAlbumUrl(currentPlayingAlbum.title)}${currentTrack.id ? `?track=${currentTrack.id}` : ''}`} className="underline">
                {currentTrack.title || 'Unknown Track'}
              </Link>
              {titleOverflows && (
                <>
                  <span className="px-8" />
                  <Link href={`${generateAlbumUrl(currentPlayingAlbum.title)}${currentTrack.id ? `?track=${currentTrack.id}` : ''}`} className="underline">
                    {currentTrack.title || 'Unknown Track'}
                  </Link>
                </>
              )}
            </h1>
          </div>
          <p className="text-lg opacity-80 truncate">
            {currentTrack.artist || currentPlayingAlbum.artist || 'Unknown Artist'}
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
        <div className="px-8 pb-4 relative">
          {/* Share Button - Bottom left, floating */}
          <button
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                const albumUrl = generateAlbumUrl(currentPlayingAlbum.title);
                // Include track parameter if track has an ID
                const trackParam = currentTrack.id ? `?track=${currentTrack.id}` : '';
                const shareUrl = `${window.location.origin}${albumUrl}${trackParam}`;

                // Try native share first (mobile)
                if (navigator.share) {
                  await navigator.share({
                    title: currentTrack.title,
                    text: `${currentTrack.title} by ${currentTrack.artist || currentPlayingAlbum.artist}`,
                    url: shareUrl,
                  });
                } else {
                  // Fallback to clipboard
                  await navigator.clipboard.writeText(shareUrl);
                }
              } catch (error) {
                // User cancelled share or error
                if ((error as Error).name !== 'AbortError') {
                  toast.error('Failed to share');
                }
              }
            }}
            className="absolute left-8 -bottom-8 p-2 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 touch-manipulation"
            style={{
              backgroundColor: `${contrastColors.textColor}15`,
              color: `${contrastColors.textColor}90`
            }}
            title="Share this track"
          >
            <Share2 className="w-5 h-5" />
          </button>

          {/* Center Controls */}
          <div className="flex items-center justify-between w-full max-w-xs mx-auto">
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
              className="p-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
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
          trackId={currentTrack.id}
          feedId={currentPlayingAlbum.feedId || currentPlayingAlbum.id}
          trackTitle={currentTrack.title}
          artistName={currentPlayingAlbum.artist || 'Unknown Artist'}
          lightningAddress={currentTrack.v4vRecipient}
          valueSplits={currentTrack.v4vValue?.recipients || currentTrack.v4vValue?.destinations || []}
          autoOpen={true}
          onClose={() => setShowBoostModal(false)}
          feedUrl={currentPlayingAlbum.feedUrl || currentPlayingAlbum.link}
          episodeGuid={currentTrack.guid}
          remoteFeedGuid={(currentTrack as any).feedGuid || currentPlayingAlbum.feedGuid || currentPlayingAlbum.guid}
          albumName={(currentTrack as any).feedTitle || (currentTrack as any).albumTitle || currentPlayingAlbum.title}
          publisherGuid={(currentPlayingAlbum as any).publisher?.feedGuid}
          publisherUrl={(currentPlayingAlbum as any).publisher?.publisherUrl}
        />
      )}
    </div>
  );
}