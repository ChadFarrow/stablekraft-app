'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import RadioPlayer from '@/components/RadioPlayer';
import { Play } from 'lucide-react';

interface RadioClientProps {
  initialAlbums: any[];
}

export default function RadioClient({ initialAlbums }: RadioClientProps) {
  const {
    currentPlayingAlbum,
    shuffleAllTracks,
    isShuffleMode,
    setInitialAlbums
  } = useAudio();

  const [isStarting, setIsStarting] = useState(false);

  // Pre-load albums from server-side fetch immediately on mount
  useEffect(() => {
    if (initialAlbums && initialAlbums.length > 0) {
      setInitialAlbums(initialAlbums);
    }
  }, [initialAlbums, setInitialAlbums]);

  const handleStartRadio = async () => {
    setIsStarting(true);

    // Try immediately - albums should already be loaded from server
    // shuffleAllTracks() clears any existing state before creating a fresh shuffle
    const success = await shuffleAllTracks();

    if (!success) {
      // Fallback retry in case albums weren't ready
      const delays = [500, 1000, 1500];
      let retrySuccess = false;
      for (let i = 0; i < delays.length && !retrySuccess; i++) {
        await new Promise(resolve => setTimeout(resolve, delays[i]));
        retrySuccess = await shuffleAllTracks();
      }

      if (!retrySuccess) {
        console.error('Failed to start radio shuffle');
        setIsStarting(false);
      }
    }
    // If successful, isShuffleMode will become true and we'll render RadioPlayer
  };

  // Show player once shuffle is active and we have a track
  if (currentPlayingAlbum && isShuffleMode) {
    return <RadioPlayer />;
  }

  // Show start screen
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden">
      {/* Full background image */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'url(/stablekraft-radio-bg.png)',
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundColor: '#1A2433'
        }}
      />
      {/* Dark overlay for better text readability */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Content - centered in the middle of the screen */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-8">
        {/* Play Button - pill shape matching logo colors */}
        <button
          onClick={handleStartRadio}
          disabled={isStarting}
          className="group flex items-center gap-3 px-8 py-4 md:px-10 md:py-5 rounded-full transition-all duration-300 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          style={{
            backgroundColor: '#C9A66B',
            boxShadow: '0 8px 32px rgba(201, 166, 107, 0.4)'
          }}
        >
          {isStarting ? (
            <div
              className="w-8 h-8 border-4 rounded-full animate-spin"
              style={{ borderColor: 'rgba(26, 36, 51, 0.3)', borderTopColor: '#1A2433' }}
            />
          ) : (
            <Play
              className="w-8 h-8"
              style={{ color: '#1A2433' }}
              fill="#1A2433"
            />
          )}
          <span className="text-lg md:text-xl font-semibold" style={{ color: '#1A2433' }}>
            {isStarting ? 'Loading...' : 'Play'}
          </span>
        </button>
      </div>
    </div>
  );
}
