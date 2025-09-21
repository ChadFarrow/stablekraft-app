import { useState, useRef, useCallback, useEffect } from 'react';
import { logger } from '@/lib/logger';

export interface AudioTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  duration?: number;
  artwork?: string;
}

export interface AudioPlayerState {
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
}

export interface AudioPlayerActions {
  play: (track?: AudioTrack) => Promise<void>;
  pause: () => void;
  stop: () => void;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  skipToNext: () => void;
  skipToPrevious: () => void;
}

interface UseAudioPlayerOptions {
  autoPlay?: boolean;
  volume?: number;
  onTrackEnd?: (track: AudioTrack) => void;
  onTrackChange?: (track: AudioTrack | null) => void;
  onError?: (error: string) => void;
}

/**
 * Custom hook for audio player functionality
 * Consolidates audio player logic used across multiple components
 */
export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const {
    autoPlay = false,
    volume: initialVolume = 1,
    onTrackEnd,
    onTrackChange,
    onError
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playlist, setPlaylist] = useState<AudioTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  const [state, setState] = useState<AudioPlayerState>({
    currentTrack: null,
    isPlaying: false,
    isLoading: false,
    volume: initialVolume,
    muted: false,
    currentTime: 0,
    duration: 0,
    error: null
  });

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = initialVolume;
    audioRef.current = audio;

    // Audio event listeners
    const handleLoadStart = () => {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      logger.debug('Audio loading started');
    };

    const handleCanPlay = () => {
      setState(prev => ({ ...prev, isLoading: false }));
      logger.debug('Audio can play');
    };

    const handlePlay = () => {
      setState(prev => ({ ...prev, isPlaying: true }));
      logger.debug('Audio playing');
    };

    const handlePause = () => {
      setState(prev => ({ ...prev, isPlaying: false }));
      logger.debug('Audio paused');
    };

    const handleTimeUpdate = () => {
      setState(prev => ({
        ...prev,
        currentTime: audio.currentTime,
        duration: audio.duration || 0
      }));
    };

    const handleEnded = () => {
      setState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));

      if (state.currentTrack) {
        onTrackEnd?.(state.currentTrack);
        logger.debug('Track ended:', state.currentTrack.title);
      }
    };

    const handleError = (e: Event) => {
      const errorMessage = `Audio error: ${audio.error?.message || 'Unknown error'}`;
      setState(prev => ({
        ...prev,
        isLoading: false,
        isPlaying: false,
        error: errorMessage
      }));

      onError?.(errorMessage);
      logger.error('Audio error:', audio.error);
    };

    const handleVolumeChange = () => {
      setState(prev => ({
        ...prev,
        volume: audio.volume,
        muted: audio.muted
      }));
    };

    // Attach event listeners
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('volumechange', handleVolumeChange);

    return () => {
      // Cleanup
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('volumechange', handleVolumeChange);

      audio.pause();
      audio.src = '';
    };
  }, [initialVolume, onTrackEnd, onError, state.currentTrack]);

  const play = useCallback(async (track?: AudioTrack) => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (track) {
        // New track
        if (track.id !== state.currentTrack?.id) {
          audio.src = track.audioUrl;
          setState(prev => ({
            ...prev,
            currentTrack: track,
            error: null,
            currentTime: 0
          }));
          onTrackChange?.(track);
          logger.info(`Loading new track: ${track.title}`);
        }

        if (autoPlay || state.currentTrack) {
          await audio.play();
        }
      } else if (state.currentTrack) {
        // Resume current track
        await audio.play();
      }
    } catch (error) {
      const errorMessage = `Failed to play audio: ${error}`;
      setState(prev => ({ ...prev, error: errorMessage, isLoading: false }));
      onError?.(errorMessage);
      logger.error('Play error:', error);
    }
  }, [state.currentTrack, autoPlay, onTrackChange, onError]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
      logger.debug('Audio paused');
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      setState(prev => ({
        ...prev,
        isPlaying: false,
        currentTime: 0
      }));
      logger.debug('Audio stopped');
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (audio && !isNaN(audio.duration)) {
      const clampedTime = Math.max(0, Math.min(time, audio.duration));
      audio.currentTime = clampedTime;
      setState(prev => ({ ...prev, currentTime: clampedTime }));
      logger.debug(`Seeking to: ${clampedTime}s`);
    }
  }, []);

  const setVolume = useCallback((volume: number) => {
    const audio = audioRef.current;
    if (audio) {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      audio.volume = clampedVolume;
      logger.debug(`Volume set to: ${clampedVolume}`);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.muted = !audio.muted;
      logger.debug(`Audio ${audio.muted ? 'muted' : 'unmuted'}`);
    }
  }, []);

  const loadPlaylist = useCallback((tracks: AudioTrack[], startIndex = 0) => {
    setPlaylist(tracks);
    setCurrentIndex(startIndex);

    if (tracks.length > 0 && startIndex >= 0 && startIndex < tracks.length) {
      play(tracks[startIndex]);
    }

    logger.info(`Playlist loaded: ${tracks.length} tracks`);
  }, [play]);

  const skipToNext = useCallback(() => {
    if (playlist.length > 0 && currentIndex < playlist.length - 1) {
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      play(playlist[nextIndex]);
      logger.debug(`Skipped to next track: ${playlist[nextIndex].title}`);
    }
  }, [playlist, currentIndex, play]);

  const skipToPrevious = useCallback(() => {
    if (playlist.length > 0 && currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      setCurrentIndex(prevIndex);
      play(playlist[prevIndex]);
      logger.debug(`Skipped to previous track: ${playlist[prevIndex].title}`);
    }
  }, [playlist, currentIndex, play]);

  return {
    // State
    ...state,
    playlist,
    currentIndex,
    hasNext: currentIndex < playlist.length - 1,
    hasPrevious: currentIndex > 0,

    // Actions
    play,
    pause,
    stop,
    togglePlayPause,
    seek,
    setVolume,
    toggleMute,
    skipToNext,
    skipToPrevious,
    loadPlaylist,

    // Utils
    formatTime: (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
  };
}