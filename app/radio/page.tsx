'use client';

import { useState, useCallback } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import RadioPlayer from '@/components/RadioPlayer';
import { Play } from 'lucide-react';

export default function RadioPage() {
  const {
    currentPlayingAlbum,
    shuffleAllTracks,
    isShuffleMode
  } = useAudio();

  const [isStarting, setIsStarting] = useState(false);

  // Retry shuffle if it fails (albums may not be loaded yet)
  const attemptShuffle = useCallback(async (): Promise<boolean> => {
    const success = await shuffleAllTracks();
    if (success) {
      return true;
    }
    return false;
  }, [shuffleAllTracks]);

  const handleStartRadio = async () => {
    setIsStarting(true);

    // Try immediately
    let success = await attemptShuffle();

    if (!success) {
      // Retry with increasing delays (albums may take 10+ seconds to load on cold start)
      const delays = [1000, 2000, 3000, 4000, 5000, 5000];
      for (let i = 0; i < delays.length && !success; i++) {
        await new Promise(resolve => setTimeout(resolve, delays[i]));
        success = await attemptShuffle();
      }
    }

    if (!success) {
      console.error('Failed to start radio shuffle after retries');
      setIsStarting(false);
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
