'use client';

import React, { useState, useEffect } from 'react';
import CDNImage from '@/components/CDNImage';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';

interface Track {
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
  volume: number;
  isShuffleMode?: boolean;
  onPlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
  onToggleShuffle?: () => void;
  onOpenFullscreen?: () => void;
}

const NowPlaying: React.FC<NowPlayingProps> = ({
  track,
  isPlaying,
  currentTime,
  volume,
  isShuffleMode = false,
  onPlayPause,
  onPrevious,
  onNext,
  onSeek,
  onVolumeChange,
  onClose,
  onToggleShuffle,
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
    <div className="container mx-auto flex items-center gap-4">
      {/* Album Info - Left Side */}
      <div
        onClick={onOpenFullscreen}
        className="flex items-center gap-3 min-w-0 flex-1 hover:bg-gray-700 rounded-lg p-2 -m-2 transition-colors cursor-pointer"
      >
        <CDNImage 
          key={`${track.title}-${track.artist}-${track.albumArt}`}
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
      </div>
      
      {/* Progress Bar - Right Side */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <span className="text-xs text-white w-12 text-right">
          {formatTime(currentTime)}
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
        <span className="text-xs text-white w-12 text-left">
          {formatTime(track.duration)}
        </span>
      </div>
      
      {/* Volume Control and Close Button - Hide volume on mobile */}
      <div className="flex items-center gap-3">
        {/* Volume Control - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-2">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer slider"
            style={{
              background: `linear-gradient(to right, white 0%, white ${volume * 100}%, #4b5563 ${volume * 100}%, #4b5563 100%)`
            }}
          />
        </div>
        
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