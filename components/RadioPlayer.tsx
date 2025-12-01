'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useAudio } from '@/contexts/AudioContext';
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import { adjustColorBrightness, ensureGoodContrast } from '@/lib/color-utils';
import { generateAlbumUrl } from '@/lib/url-utils';

export default function RadioPlayer() {
  const {
    currentPlayingAlbum,
    isPlaying,
    currentTrackIndex,
    currentTime,
    duration,
    playNextTrack,
    playPreviousTrack,
    pause,
    resume,
    seek,
  } = useAudio();

  const [dominantColor, setDominantColor] = useState('#1A252F');
  const [contrastColors, setContrastColors] = useState({
    backgroundColor: '#1A252F',
    textColor: '#ffffff'
  });
  const [titleOverflows, setTitleOverflows] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Get current track info
  const currentTrack = currentPlayingAlbum?.tracks?.[currentTrackIndex];

  // Helper function to proxy external image URLs
  const getProxiedImageUrl = (imageUrl: string): string => {
    if (!imageUrl) return '';
    if (imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')) {
      return imageUrl;
    }
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  };

  // Get album artwork
  const originalImageUrl = currentTrack?.image || currentPlayingAlbum?.coverArt || '';
  const albumArt = originalImageUrl
    ? getProxiedImageUrl(originalImageUrl)
    : '/stablekraft-rocket.png';

  // Check if title overflows
  useEffect(() => {
    if (titleRef.current) {
      const overflows = titleRef.current.scrollWidth > titleRef.current.clientWidth;
      setTitleOverflows(overflows);
    }
  }, [currentTrack?.title]);

  // Extract colors from album art
  useEffect(() => {
    if (albumArt && !albumArt.includes('/stablekraft-rocket.png')) {
      const fetchColors = async () => {
        try {
          // First try to get from database
          const response = await fetch(`/api/artwork-colors?imageUrl=${encodeURIComponent(originalImageUrl)}`);

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
          }
        } catch (error) {
          console.warn('Color extraction failed:', error);
          // Use fallback colors
          setDominantColor('#1A252F');
          setContrastColors({ backgroundColor: '#1A252F', textColor: '#ffffff' });
        }
      };

      fetchColors();
    } else {
      // Default colors for placeholder
      setDominantColor('#1A252F');
      setContrastColors({ backgroundColor: '#1A252F', textColor: '#ffffff' });
    }
  }, [albumArt, originalImageUrl]);

  // Handle progress bar click
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

  if (!currentPlayingAlbum || !currentTrack) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ height: '100dvh', minHeight: '100vh' }}
    >
      {/* Dynamic Background */}
      <div
        className="absolute inset-0 transition-all duration-1000"
        style={{
          backgroundColor: contrastColors.backgroundColor,
          background: `linear-gradient(180deg, ${contrastColors.backgroundColor} 0%, ${adjustColorBrightness(contrastColors.backgroundColor, -20)} 100%)`
        }}
      />

      {/* Content */}
      <div
        className="relative flex flex-col h-full items-center justify-center px-8"
        style={{
          color: contrastColors.textColor,
          paddingTop: 'max(env(safe-area-inset-top), 24px)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
        }}
      >
        {/* Radio Badge */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2">
          <div
            className="px-4 py-2 rounded-full text-sm font-medium"
            style={{
              backgroundColor: `${contrastColors.textColor}20`,
              color: contrastColors.textColor
            }}
          >
            StableKraft Radio
          </div>
        </div>

        {/* Album Art */}
        <div className="w-full max-w-sm aspect-square mb-8">
          <img
            src={albumArt}
            alt={currentPlayingAlbum.title}
            className="w-full h-full object-cover rounded-2xl shadow-2xl"
            style={{
              boxShadow: `0 25px 50px ${dominantColor}30`
            }}
          />
        </div>

        {/* Track Info */}
        <div className="w-full max-w-sm text-center mb-8">
          <div className="overflow-hidden">
            <Link href={generateAlbumUrl(currentPlayingAlbum.title)} className="hover:underline">
              <h1
                ref={titleRef}
                className={`text-2xl font-bold mb-2 whitespace-nowrap ${titleOverflows ? 'animate-marquee' : ''}`}
              >
                {currentTrack.title || 'Unknown Track'}
                {titleOverflows && (
                  <>
                    <span className="px-8" />
                    {currentTrack.title || 'Unknown Track'}
                  </>
                )}
              </h1>
            </Link>
          </div>
          <p className="text-lg opacity-80 truncate">
            {currentTrack.artist || currentPlayingAlbum.artist || 'Unknown Artist'}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full max-w-sm mb-8">
          <div
            ref={progressRef}
            className="relative h-1 rounded-full cursor-pointer"
            style={{ backgroundColor: `${contrastColors.textColor}30` }}
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
              className="absolute w-3 h-3 rounded-full shadow-lg"
              style={{
                left: `${progress}%`,
                transform: 'translateX(-50%) translateY(-50%)',
                top: '50%',
                backgroundColor: contrastColors.textColor,
              }}
            />
          </div>

          {/* Time Labels */}
          <div className="flex justify-between text-sm opacity-60 mt-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls - Simplified */}
        <div className="flex items-center justify-center gap-8">
          {/* Previous Button */}
          <button
            onClick={playPreviousTrack}
            className="p-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
              backgroundColor: `${contrastColors.textColor}20`,
              color: contrastColors.textColor
            }}
          >
            <SkipBack className="w-8 h-8" />
          </button>

          {/* Play/Pause Button - Large */}
          <button
            onClick={isPlaying ? pause : resume}
            className="p-6 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg"
            style={{
              backgroundColor: contrastColors.textColor,
              boxShadow: `0 8px 25px rgba(0,0,0,0.3)`
            }}
          >
            {isPlaying ? (
              <Pause className="w-12 h-12" style={{ color: contrastColors.backgroundColor }} />
            ) : (
              <Play className="w-12 h-12 ml-1" style={{ color: contrastColors.backgroundColor }} />
            )}
          </button>

          {/* Next Button */}
          <button
            onClick={playNextTrack}
            className="p-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
              backgroundColor: `${contrastColors.textColor}20`,
              color: contrastColors.textColor
            }}
          >
            <SkipForward className="w-8 h-8" />
          </button>
        </div>
      </div>
    </div>
  );
}
