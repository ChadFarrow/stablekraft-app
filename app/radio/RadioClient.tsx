'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import RadioPlayer from '@/components/RadioPlayer';
import { Play } from 'lucide-react';
import { useDataSaver } from '@/hooks/useDataSaver';

export default function RadioClient() {
  const dataSaver = useDataSaver();
  const {
    currentPlayingAlbum,
    shuffleAllTracks,
    isShuffleMode,
    setInitialAlbums
  } = useAudio();

  const [isStarting, setIsStarting] = useState(false);

  // Load albums on mount rather than receiving them as a server prop. See the
  // note in page.tsx: as a prop this was multiple megabytes inlined into the
  // HTML document, which every visitor downloaded before the page could paint.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/albums-fast?limit=1000&offset=0&tier=all&filter=all');
        if (!res.ok) {
          console.warn(`Radio: albums API returned ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!cancelled && Array.isArray(data.albums) && data.albums.length > 0) {
          setInitialAlbums(data.albums);
        }
      } catch (error) {
        // Not fatal: handleStartRadio already retries when albums are not ready.
        console.warn('Radio: failed to load albums', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setInitialAlbums]);

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
          // 2.38 MB of decoration. The backgroundColor below is the whole
          // fallback, and it is already here.
          backgroundImage: dataSaver ? undefined : 'url(/stablekraft-radio-bg.png)',
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
          aria-label="Start radio"
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
