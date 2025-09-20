'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import { X, SkipBack, SkipForward, Play, Pause, Shuffle, Repeat, ChevronDown } from 'lucide-react';
import { getAlbumArtworkUrl } from '@/lib/cdn-utils';

interface NowPlayingScreenProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NowPlayingScreen({ isOpen, onClose }: NowPlayingScreenProps) {
  const {
    currentPlayingAlbum,
    isPlaying,
    currentTrackIndex,
    currentTime,
    duration,
    isShuffleMode,
    playNextTrack,
    playPreviousTrack,
    pause,
    resume,
    seek,
    toggleShuffle,
  } = useAudio();

  const [isDragging, setIsDragging] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const [isRepeatMode, setIsRepeatMode] = useState(false);
  const [dominantColor, setDominantColor] = useState('#1A252F');
  
  const progressRef = useRef<HTMLDivElement>(null);

  // Get current track info
  const currentTrack = currentPlayingAlbum?.tracks?.[currentTrackIndex];
  const albumArt = currentPlayingAlbum?.coverArt 
    ? getAlbumArtworkUrl(currentPlayingAlbum.coverArt, 'xl')
    : '/api/placeholder/400/400';

  // Extract dominant color from album art (simplified version)
  useEffect(() => {
    if (albumArt && !albumArt.includes('/api/placeholder/')) {
      // For now, use a gradient based on the StableKraft colors
      setDominantColor('#4ECDC4');
    } else {
      setDominantColor('#1A252F');
    }
  }, [albumArt]);

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

  if (!isOpen || !currentPlayingAlbum || !currentTrack) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Animated Background */}
      <div 
        className="absolute inset-0 transition-all duration-1000"
        style={{
          background: `linear-gradient(135deg, ${dominantColor}20 0%, ${dominantColor}40 50%, #000000 100%)`
        }}
      />
      
      {/* Backdrop Blur */}
      <div className="absolute inset-0 backdrop-blur-xl bg-black/30" />
      
      {/* Content */}
      <div className="relative flex flex-col h-full text-white p-safe-plus">
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-2">
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-black/20 backdrop-blur-sm hover:bg-black/30 transition-all duration-200"
          >
            <ChevronDown className="w-6 h-6" />
          </button>
          
          <div className="flex-1 text-center">
            <p className="text-sm opacity-80">Playing from</p>
            <p className="text-sm font-medium truncate">{currentPlayingAlbum.title}</p>
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
            className="relative h-1 bg-white/20 rounded-full cursor-pointer"
            onClick={handleProgressClick}
          >
            <div
              className="absolute h-full rounded-full transition-all duration-100"
              style={{
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${dominantColor} 0%, #FFD700 100%)`
              }}
            />
            <div
              className="absolute w-4 h-4 bg-white rounded-full shadow-lg transform -translate-y-1/2 transition-all duration-100"
              style={{
                left: `${progress}%`,
                transform: `translateX(-50%) translateY(-50%)`,
                boxShadow: `0 4px 12px ${dominantColor}40`
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
        <div className="px-8 pb-safe-plus">
          {/* Secondary Controls */}
          <div className="flex items-center justify-center gap-8 mb-6">
            <button
              onClick={toggleShuffle}
              className={`p-2 rounded-full transition-all duration-200 ${
                isShuffleMode 
                  ? `bg-${dominantColor.replace('#', '')}/30 text-white` 
                  : 'bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              <Shuffle className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => setIsRepeatMode(!isRepeatMode)}
              className={`p-2 rounded-full transition-all duration-200 ${
                isRepeatMode 
                  ? `bg-${dominantColor.replace('#', '')}/30 text-white` 
                  : 'bg-white/10 text-white/60 hover:text-white'
              }`}
            >
              <Repeat className="w-5 h-5" />
            </button>
          </div>

          {/* Main Controls */}
          <div className="flex items-center justify-center gap-6">
            <button
              onClick={playPreviousTrack}
              className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200 hover:scale-105 active:scale-95"
            >
              <SkipBack className="w-6 h-6" />
            </button>
            
            <button
              onClick={isPlaying ? pause : resume}
              className="p-4 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                background: `linear-gradient(135deg, ${dominantColor} 0%, #FFD700 100%)`,
                boxShadow: `0 8px 25px ${dominantColor}40`
              }}
            >
              {isPlaying ? (
                <Pause className="w-8 h-8 text-white" />
              ) : (
                <Play className="w-8 h-8 text-white ml-1" />
              )}
            </button>
            
            <button
              onClick={playNextTrack}
              className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-all duration-200 hover:scale-105 active:scale-95"
            >
              <SkipForward className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}