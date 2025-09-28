'use client';

import { useState, useEffect, useRef } from 'react';
import { BoostButton } from '@/components/Lightning/BoostButton';

interface NowPlayingTrack {
  id: string;
  title: string;
  artist: string;
  albumArtwork?: string;
  artwork?: string;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
}

interface NowPlayingBarProps {
  currentTrack?: NowPlayingTrack | null;
  onPlayPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (time: number) => void;
}

export default function NowPlayingBar({ 
  currentTrack, 
  onPlayPause, 
  onNext, 
  onPrevious, 
  onSeek 
}: NowPlayingBarProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [imageKey, setImageKey] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setIsVisible(!!currentTrack);
  }, [currentTrack]);

  useEffect(() => {
    // Force image re-render when track changes
    if (currentTrack) {
      setImageKey(prev => prev + 1);
    }
  }, [currentTrack?.id, currentTrack?.albumArtwork, currentTrack?.artwork]);

  if (!isVisible || !currentTrack) {
    return null;
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = currentTrack.duration > 0 ? (currentTrack.currentTime / currentTrack.duration) * 100 : 0;

  // Debug logging
  console.log('🎨 NowPlayingBar - currentTrack:', {
    title: currentTrack.title,
    artist: currentTrack.artist,
    albumArtwork: currentTrack.albumArtwork,
    artwork: currentTrack.artwork
  });

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-md border-t border-gray-700 z-50">
      <div className="flex items-center justify-between px-4 py-3 max-w-7xl mx-auto">
        {/* Track Artwork - Prominently displayed */}
        <div className="flex items-center space-x-4 flex-1 min-w-0">
          {/* Album Artwork - Larger and more prominent */}
          <div className="relative w-16 h-16 flex-shrink-0">
            {currentTrack.albumArtwork || currentTrack.artwork ? (
              <>
                <img
                  key={`${currentTrack.id}-${imageKey}`}
                  ref={imageRef}
                  src={currentTrack.albumArtwork || currentTrack.artwork}
                  alt={`${currentTrack.title} by ${currentTrack.artist}`}
                  className="w-full h-full object-cover rounded-lg shadow-lg"
                  onError={(e) => {
                    console.error('❌ Image failed to load:', currentTrack.albumArtwork || currentTrack.artwork);
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    target.nextElementSibling?.classList.remove('hidden');
                  }}
                  onLoad={() => {
                    console.log('✅ Image loaded successfully:', currentTrack.albumArtwork || currentTrack.artwork);
                  }}
                />
                {/* Fallback placeholder */}
                <div className="w-full h-full bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center hidden shadow-lg">
                  <div className="text-center">
                    <div className="text-2xl">🎵</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center shadow-lg">
                <div className="text-center">
                  <div className="text-2xl">🎵</div>
                </div>
              </div>
            )}
          </div>

          {/* Track Details */}
          <div className="flex-1 min-w-0">
            <h4 className="text-white font-medium truncate" title={currentTrack.title}>
              {currentTrack.title}
            </h4>
            <p className="text-gray-300 text-sm truncate" title={currentTrack.artist}>
              {currentTrack.artist}
            </p>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center space-x-4">
          {/* Previous Button */}
          <button
            onClick={onPrevious}
            className="text-gray-300 hover:text-white transition-colors p-2"
            title="Previous track"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Play/Pause Button */}
          <button
            onClick={onPlayPause}
            className="bg-white text-black rounded-full p-3 hover:bg-gray-200 transition-colors"
            title={currentTrack.isPlaying ? 'Pause' : 'Play'}
          >
            {currentTrack.isPlaying ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next Button */}
          <button
            onClick={onNext}
            className="text-gray-300 hover:text-white transition-colors p-2"
            title="Next track"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Lightning Boost Button */}
          <div className="ml-2">
            <BoostButton
              trackId={currentTrack.id}
              trackTitle={currentTrack.title}
              artistName={currentTrack.artist}
              className="text-xs px-2 py-1"
            />
          </div>
        </div>

        {/* Progress Bar and Time */}
        <div className="flex items-center space-x-3 flex-1 max-w-xs">
          <span className="text-gray-300 text-sm w-12 text-right">
            {formatTime(currentTrack.currentTime)}
          </span>
          <div className="flex-1 relative">
            <div className="w-full bg-gray-600 rounded-full h-1">
              <div
                className="bg-white h-1 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={currentTrack.duration}
              value={currentTrack.currentTime}
              onChange={(e) => onSeek?.(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="text-gray-300 text-sm w-12">
            {formatTime(currentTrack.duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
