'use client';

import React, { useState, useEffect } from 'react';
import CDNImage from '@/components/CDNImage';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';

interface Track {
  id?: string;
  title: string;
  artist: string;
  albumTitle: string;
  duration: number;
  albumArt?: string;
}

interface NowPlayingProps {
  track: Track;
  isPlaying: boolean;
  currentTime: number;
  isShuffleMode?: boolean;
  repeatMode?: 'none' | 'one' | 'all';
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onClose: () => void;
  onToggleShuffle?: () => void;
  onToggleRepeat?: () => void;
  onOpenFullscreen?: () => void;
}

const NowPlaying: React.FC<NowPlayingProps> = ({
  track,
  isPlaying,
  currentTime,
  isShuffleMode = false,
  repeatMode = 'none',
  onPlayPause,
  onPrevious,
  onNext,
  onSeek,
  onClose,
  onToggleShuffle,
  onToggleRepeat,
  onOpenFullscreen
}) => {
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  };

  const handleProgressClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * track.duration;
    onSeek(newTime);
  };

  const handleProgressHover = (event: React.MouseEvent<HTMLDivElement>) => {
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const hoverX = event.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, hoverX / rect.width));
    setHoverPosition(percentage);
  };

  const handleProgressLeave = () => {
    setHoverPosition(null);
  };


  return (
    <div className="container mx-auto">
      {/* Mobile Layout - Album art left, info + controls right */}
      <div className="md:hidden flex gap-3 items-center">
        {/* Album Art - Left side */}
        <div
          className="flex-shrink-0 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onOpenFullscreen) {
              onOpenFullscreen();
            }
          }}
        >
          <CDNImage
            key={`${track.id || track.title}-${track.artist}-${track.albumArt || 'no-art'}-mobile`}
            src={track.albumArt || ''}
            alt={track.title}
            width={56}
            height={56}
            className="rounded-lg object-cover w-14 h-14"
            fallbackSrc={getPlaceholderImageUrl('thumbnail')}
          />
        </div>

        {/* Right side - Track info above controls */}
        <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
          {/* Track Info Row */}
          <div
            className="flex items-center justify-between gap-2 cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onOpenFullscreen) {
                onOpenFullscreen();
              }
            }}
          >
            <p className="min-w-0 flex-1 text-sm truncate">
              <span className="font-bold text-white">{track.title}</span>
              <span className="text-gray-400"> - {track.artist}</span>
            </p>
            <span className="text-xs text-white whitespace-nowrap flex-shrink-0">
              {formatTime(currentTime)} / {formatTime(track.duration)}
            </span>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-center gap-4">
            {onToggleShuffle && (
              <button
                onClick={onToggleShuffle}
                className={`rounded-full p-2.5 transition-colors ${
                  isShuffleMode
                    ? 'bg-orange-500 hover:bg-orange-600 text-white'
                    : 'bg-gray-600 hover:bg-gray-500 text-white'
                }`}
                title={isShuffleMode ? 'Disable shuffle' : 'Enable shuffle'}
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                </svg>
              </button>
            )}
            <button
              onClick={onPrevious}
              className="bg-gray-600 hover:bg-gray-500 text-white rounded-full p-2.5 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>
            <button
              onClick={onPlayPause}
              className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-full p-3 transition-all flex items-center justify-center"
              style={{ width: '52px', height: '52px' }}
            >
              {isPlaying ? (
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
              ) : (
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            <button
              onClick={onNext}
              className="bg-gray-600 hover:bg-gray-500 text-white rounded-full p-2.5 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
            {onToggleRepeat && (
              <button
                onClick={onToggleRepeat}
                className={`rounded-full p-2.5 transition-colors relative ${
                  repeatMode !== 'none'
                    ? 'bg-orange-500 hover:bg-orange-600 text-white'
                    : 'bg-gray-600 hover:bg-gray-500 text-white'
                }`}
                title={
                  repeatMode === 'none' ? 'Enable repeat' :
                  repeatMode === 'one' ? 'Repeat one' :
                  'Repeat all'
                }
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                </svg>
                {repeatMode === 'one' && (
                  <span className="absolute -top-1 -right-1 bg-orange-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold text-[10px]">
                    1
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Desktop Layout - Horizontal */}
      <div className="hidden md:flex items-center gap-4">
        {/* Album Info - Left Side */}
        <div
          className="flex items-center gap-3 min-w-0 flex-1 hover:bg-gray-700 rounded-lg p-2 -m-2 transition-colors cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onOpenFullscreen) {
              onOpenFullscreen();
            }
          }}
        >
          <CDNImage
            key={`${track.id || track.title}-${track.artist}-${track.albumArt || 'no-art'}`}
            src={track.albumArt || ''}
            alt={track.title}
            width={48}
            height={48}
            className="rounded-lg object-cover w-12 h-12 flex-shrink-0"
            fallbackSrc={getPlaceholderImageUrl('thumbnail')}
          />
          <div className="min-w-0">
            <p className="font-bold truncate text-white">
              {track.title}
            </p>
            <p className="text-sm text-gray-400 truncate">
              {track.artist}
            </p>
          </div>
        </div>

        {/* Playback Controls - Perfectly Centered */}
        <div className="flex items-center justify-center gap-3 flex-1">
        {/* Shuffle Button */}
        {onToggleShuffle && (
          <button
            onClick={onToggleShuffle}
            className={`rounded-full p-2 transition-colors ${
              isShuffleMode
                ? 'bg-orange-500 hover:bg-orange-600 text-white'
                : 'bg-gray-600 hover:bg-gray-500 text-white'
            }`}
            title={isShuffleMode ? 'Disable shuffle' : 'Enable shuffle'}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
            </svg>
          </button>
        )}

        <button
          onClick={onPrevious}
          className="bg-gray-600 hover:bg-gray-500 text-white rounded-full p-2 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
          </svg>
        </button>
        
        <button
          onClick={onPlayPause}
          className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-full p-3 transition-all"
          style={{ width: '48px', height: '48px' }}
        >
          {isPlaying ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>
        
        <button
          onClick={onNext}
          className="bg-gray-600 hover:bg-gray-500 text-white rounded-full p-2 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
          </svg>
        </button>
        
        {/* Repeat Button */}
        {onToggleRepeat && (
          <button
            onClick={onToggleRepeat}
            className={`rounded-full p-2 transition-colors relative ${
              repeatMode !== 'none'
                ? 'bg-orange-500 hover:bg-orange-600 text-white' 
                : 'bg-gray-600 hover:bg-gray-500 text-white'
            }`}
            title={
              repeatMode === 'none' ? 'Enable repeat' : 
              repeatMode === 'one' ? 'Repeat one' : 
              'Repeat all'
            }
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
            </svg>
            {repeatMode === 'one' && (
              <span className="absolute -top-1 -right-1 bg-orange-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                1
              </span>
            )}
          </button>
        )}
        </div>

        {/* Progress Bar - Right Side (Desktop only) */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <span className="text-xs text-white whitespace-nowrap">
            {formatTime(currentTime)} / {formatTime(track.duration)}
          </span>
          <div
            className="flex-1 h-2 bg-gray-600 rounded-full cursor-pointer relative group"
            onClick={handleProgressClick}
            onMouseMove={handleProgressHover}
            onMouseLeave={handleProgressLeave}
          >
            {/* Current progress */}
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-100"
              style={{ width: `${track.duration ? (currentTime / track.duration) * 100 : 0}%` }}
            />

            {/* Hover preview */}
            {hoverPosition !== null && (
              <div
                className="absolute top-0 left-0 h-full bg-orange-400/60 rounded-full pointer-events-none transition-all duration-75"
                style={{ width: `${hoverPosition * 100}%` }}
              />
            )}

            {/* Hover time tooltip */}
            {hoverPosition !== null && (
              <div
                className="absolute -top-8 bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none"
                style={{
                  left: `${hoverPosition * 100}%`,
                  transform: 'translateX(-50%)',
                  minWidth: 'max-content'
                }}
              >
                {formatTime(hoverPosition * track.duration)}
              </div>
            )}
          </div>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="text-white hover:text-gray-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default NowPlaying; 