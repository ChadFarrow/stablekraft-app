'use client';

import React, { createContext, useContext, useRef, useState, useEffect, useCallback, ReactNode } from 'react';
import { RSSAlbum } from '@/lib/rss-parser';
import { toast } from '@/components/Toast';
import Hls from 'hls.js';
import { monitoring } from '@/lib/monitoring';
import { storage } from '@/lib/indexed-db-storage';

interface AudioContextType {
  // Audio state
  currentPlayingAlbum: RSSAlbum | null;
  isPlaying: boolean;
  currentTrackIndex: number;
  currentTime: number;
  duration: number;
  
  // Media type state
  isVideoMode: boolean;
  
  // Shuffle state
  isShuffleMode: boolean;
  
  // UI state
  isFullscreenMode: boolean;
  setFullscreenMode: (fullscreen: boolean) => void;
  
  // Repeat mode
  repeatMode: 'none' | 'one' | 'all';
  setRepeatMode: (mode: 'none' | 'one' | 'all') => void;
  
  // Audio controls
  playAlbum: (album: RSSAlbum, trackIndex?: number) => Promise<boolean>;
  playTrack: (audioUrl: string, startTime?: number, endTime?: number) => Promise<boolean>;
  playShuffledTrack: (index: number) => Promise<boolean>;
  shuffleAllTracks: () => Promise<boolean>;
  toggleShuffle: () => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  playNextTrack: () => void;
  playPreviousTrack: () => void;
  stop: () => void;
  
  // Media element refs for direct access
  audioRef: React.RefObject<HTMLAudioElement>;
  videoRef: React.RefObject<HTMLVideoElement>;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
};

interface AudioProviderProps {
  children: ReactNode;
}

export const AudioProvider: React.FC<AudioProviderProps> = ({ children }) => {
  const [currentPlayingAlbum, setCurrentPlayingAlbum] = useState<RSSAlbum | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [albums, setAlbums] = useState<RSSAlbum[]>([]);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  
  // Video mode state
  const [isVideoMode, setIsVideoMode] = useState(false);
  
  // Shuffle state
  const [isShuffleMode, setIsShuffleMode] = useState(false);
  const [shuffledPlaylist, setShuffledPlaylist] = useState<Array<{
    album: RSSAlbum;
    trackIndex: number;
    track: any;
  }>>([]);
  const [currentShuffleIndex, setCurrentShuffleIndex] = useState(0);
  
  // UI state
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'none' | 'one' | 'all'>('none');
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const albumsLoadedRef = useRef(false);
  const isRetryingRef = useRef(false);
  const playNextTrackRef = useRef<() => Promise<void>>();
  const playPreviousTrackRef = useRef<() => Promise<void>>();

  // AudioContext state version - increment when structure changes to invalidate old cache
  const AUDIO_STATE_VERSION = 2; // v2 includes V4V fields in tracks

  // Load state from IndexedDB on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      storage.getItem('audioPlayerState').then((savedState) => {
        if (savedState) {
          try {
            const state = typeof savedState === 'string' ? JSON.parse(savedState) : savedState;

            // Check cache version - invalidate if version mismatch
            if (state.version !== AUDIO_STATE_VERSION) {
              console.log(`🔄 AudioContext cache version mismatch (${state.version} !== ${AUDIO_STATE_VERSION}), clearing old cache`);
              storage.removeItem('audioPlayerState');
              return;
            }

            // Restore shuffle state
            if (state.isShuffleMode !== undefined) {
              setIsShuffleMode(state.isShuffleMode);
            }
            if (state.currentShuffleIndex !== undefined) {
              setCurrentShuffleIndex(state.currentShuffleIndex);
            }

            // Restore track index and timing info
            setCurrentTrackIndex(state.currentTrackIndex || 0);
            setCurrentTime(state.currentTime || 0);
            setDuration(state.duration || 0);

            // Note: isPlaying is not restored to prevent autoplay issues
            // Note: currentPlayingAlbum will be restored when needed by playNextTrack

            if (process.env.NODE_ENV === 'development') {
              console.log('🔄 Restored audio state from IndexedDB:', {
                version: state.version,
                trackIndex: state.currentTrackIndex,
                shuffleMode: state.isShuffleMode,
                hasAlbumData: !!state.currentPlayingAlbum
              });
            }
          } catch (error) {
            console.warn('Failed to restore audio state:', error);
          }
        }
      }).catch((error) => {
        console.error('IndexedDB getItem error:', error);
      });
    }
  }, []);

  // Add user interaction handler to enable audio playback
  useEffect(() => {
    // Check if we're on mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      console.log('📱 Mobile device detected - audio will play on first track click');
    }

    // No need for generic interaction handlers - playAlbum will handle it
    return () => {};
  }, []); // Run only once on mount

  // Initialize Media Session API early for iOS 26 lockscreen controls
  useEffect(() => {
    if ('mediaSession' in navigator && navigator.mediaSession) {
      try {
        // Register action handlers immediately on mount (before any playback)
        // This is required for iOS 26 PWA mode to recognize media capabilities
        // Using refs to ensure we always call the latest versions of the functions
        navigator.mediaSession.setActionHandler('play', () => {
          console.log('📱 Media session: Play from early init');
          resume();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          console.log('📱 Media session: Pause from early init');
          pause();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          console.log('📱 Media session: Previous track from early init');
          if (playPreviousTrackRef.current) {
            playPreviousTrackRef.current();
          }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          console.log('📱 Media session: Next track from early init');
          if (playNextTrackRef.current) {
            playNextTrackRef.current();
          }
        });

        // Set initial playback state to 'none' - will be updated when playback starts
        navigator.mediaSession.playbackState = 'none';

        console.log('📱 Media Session initialized on mount for iOS 26');
      } catch (error) {
        console.warn('Failed to initialize Media Session early:', error);
      }
    }
  }, []); // Run only once on mount

  // Save state to IndexedDB when it changes - with debouncing
  useEffect(() => {
    if (typeof window !== 'undefined' && currentPlayingAlbum) {
      const timeoutId = setTimeout(async () => {
        const state = {
          version: AUDIO_STATE_VERSION, // Include version for cache invalidation
          currentPlayingAlbum: {
            title: currentPlayingAlbum.title,
            artist: currentPlayingAlbum.artist,
            coverArt: currentPlayingAlbum.coverArt,
            feedId: currentPlayingAlbum.feedId,
            feedUrl: currentPlayingAlbum.feedUrl,
            feedGuid: currentPlayingAlbum.feedGuid,
            tracks: currentPlayingAlbum.tracks?.map(track => ({
              title: track.title,
              audioUrl: track.url,
              startTime: track.startTime,
              endTime: track.endTime,
              // Include V4V fields for Lightning payments
              v4vRecipient: track.v4vRecipient,
              v4vValue: track.v4vValue,
              guid: track.guid,
              image: track.image
            }))
          },
          currentTrackIndex,
          currentTime,
          duration,
          isShuffleMode,
          shuffledPlaylist: shuffledPlaylist.map(item => ({
            albumTitle: item.album.title,
            trackIndex: item.trackIndex,
            trackTitle: item.track.title
          })),
          currentShuffleIndex,
          timestamp: Date.now()
        };
        await storage.setItem('audioPlayerState', state);
      }, 100); // Debounce to prevent excessive writes

      return () => clearTimeout(timeoutId);
    }
  }, [currentPlayingAlbum, currentTrackIndex, currentTime, duration, isShuffleMode, shuffledPlaylist, currentShuffleIndex]);

  // Load albums data for playback - only once
  useEffect(() => {
    const loadAlbums = async () => {
      // Prevent multiple loads
      if (albumsLoadedRef.current) {
        return;
      }
      
      albumsLoadedRef.current = true;
      
      try {
        const response = await fetch('/api/albums', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          }
        });
        
        if (response.ok) {
          // Check if response is valid JSON
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.warn('⚠️ Albums API returned non-JSON response:', contentType);
            return;
          }
          
          const data = await response.json();
          if (data && Array.isArray(data.albums)) {
            setAlbums(data.albums);
            // Only log in development mode
            if (process.env.NODE_ENV === 'development') {
              console.log(`✅ Loaded ${data.albums.length} albums for audio context`);

              // Debug: Check if Delta OG album has V4V data
              const deltaOGAlbum = data.albums.find((album: any) => album.title?.includes('Aged Friends'));
              if (deltaOGAlbum) {
                const deltaOGTrack = deltaOGAlbum.tracks?.[0];
                console.log('🔍 AudioContext Delta OG track debug:', {
                  albumTitle: deltaOGAlbum.title,
                  trackTitle: deltaOGTrack?.title,
                  trackKeys: deltaOGTrack ? Object.keys(deltaOGTrack) : [],
                  hasV4vRecipient: !!deltaOGTrack?.v4vRecipient,
                  hasV4vValue: !!deltaOGTrack?.v4vValue,
                  v4vRecipient: deltaOGTrack?.v4vRecipient,
                  v4vValue: deltaOGTrack?.v4vValue
                });
              }
            }
          } else {
            console.warn('⚠️ Albums API returned invalid data structure:', data);
          }
        } else {
          console.warn(`⚠️ Albums API returned ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        console.warn('Failed to load albums for audio context:', error);
        // Don't throw - allow the app to continue without albums
      }
    };
    
    loadAlbums();
  }, []); // Run only once on mount

  // Helper function to detect if URL is a video
  const isVideoUrl = (url: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.m3u8', '.m4v', '.mov', '.avi', '.mkv'];
    const urlLower = url.toLowerCase();
    return videoExtensions.some(ext => urlLower.includes(ext));
  };

  // Helper function to detect if URL is an HLS stream
  const isHlsUrl = (url: string): boolean => {
    return Boolean(url && typeof url === 'string' && url.toLowerCase().includes('.m3u8'));
  };

  // Helper function to get URLs to try for audio/video playback
  const getAudioUrlsToTry = (originalUrl: string): string[] => {
    const urlsToTry = [];
    
    if (!originalUrl || typeof originalUrl !== 'string') {
      console.warn('⚠️ Invalid audio URL provided:', originalUrl);
      return [];
    }
    
    try {
      const url = new URL(originalUrl);
      const isExternal = url.hostname !== window.location.hostname;
      const isHls = isHlsUrl(originalUrl);
      
      // Special handling for HLS streams
      if (isHls) {
        // For HLS streams, try video proxy first, then audio proxy, then direct
        urlsToTry.push(`/api/proxy-video?url=${encodeURIComponent(originalUrl)}`);
        urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(originalUrl)}`);
        urlsToTry.push(originalUrl);
        return urlsToTry;
      }
      
      // Special handling for op3.dev analytics URLs - extract direct URL
      if (originalUrl.includes('op3.dev/e,') && originalUrl.includes('/https://')) {
        const directUrl = originalUrl.split('/https://')[1];
        if (directUrl) {
          const fullDirectUrl = `https://${directUrl}`;
          console.log('🔗 Extracted direct URL from op3.dev:', fullDirectUrl);
          // Try direct URL first for better reliability
          urlsToTry.push(fullDirectUrl);
          // Then try proxy with direct URL
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(fullDirectUrl)}`);
          // Fallback to original op3 URL with proxy
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(originalUrl)}`);
          // Last resort: original op3 URL direct
          urlsToTry.push(originalUrl);
        } else {
          // If extraction fails, use normal logic
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(originalUrl)}`);
          urlsToTry.push(originalUrl);
        }
      } else if (isExternal) {
        // Check if URL is from a known CORS-problematic domain
        const corsProblematicDomains = [
          'cloudfront.net',
          'amazonaws.com',
          'wavlake.com',
          'buzzsprout.com',
          'anchor.fm',
          'libsyn.com'
        ];
        
        const isDomainProblematic = corsProblematicDomains.some(domain => 
          url.hostname.includes(domain)
        );
        
        if (isDomainProblematic) {
          // For known CORS-problematic domains, use proxy first and skip direct URL
          console.log(`🚫 Known CORS-problematic domain detected (${url.hostname}), using proxy only`);
          monitoring.info('audio-playback', `CORS-problematic domain detected: ${url.hostname}`, { originalUrl });
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(originalUrl)}`);
        } else {
          // For other external URLs, try proxy first then direct as fallback
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(originalUrl)}`);
          urlsToTry.push(originalUrl);
        }
      } else {
        // For local URLs, try direct first
        urlsToTry.push(originalUrl);
      }
    } catch (urlError) {
      console.warn('⚠️ Could not parse audio URL, using as-is:', originalUrl);
      urlsToTry.push(originalUrl);
    }
    
    return urlsToTry;
  };

  // Helper function to attempt HLS playback
  const attemptHlsPlayback = async (hlsUrl: string, context = 'HLS playback'): Promise<boolean> => {
    const videoElement = videoRef.current;
    
    if (!videoElement) {
      console.error('❌ Video element reference is null for HLS playback');
      return false;
    }

    // Get URLs to try including proxied versions
    const urlsToTry = getAudioUrlsToTry(hlsUrl);
    console.log(`🔄 ${context}: Trying ${urlsToTry.length} HLS URLs`);

    for (let i = 0; i < urlsToTry.length; i++) {
      const currentUrl = urlsToTry[i];
      console.log(`🔄 ${context} attempt ${i + 1}/${urlsToTry.length}: ${typeof currentUrl === 'string' && currentUrl.includes('proxy-audio') ? 'Proxied HLS URL' : 'Direct HLS URL'}`);

      try {
        // Clean up any existing HLS instance
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        if (Hls.isSupported()) {
          // Use hls.js for browsers that support it
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            xhrSetup: function(xhr, url) {
              // Add any necessary headers for CORS
              xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
            }
          });
          
          hlsRef.current = hls;
          
          // Clear any existing src to avoid conflicts
          videoElement.src = '';
          videoElement.load();
          
          // Set up event listeners
          const manifestParsed = new Promise<boolean>((resolve) => {
            let hasResolved = false;
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('✅ HLS manifest parsed successfully');
              // Don't try to play immediately, wait for video to be ready
            });
            
            hls.on(Hls.Events.LEVEL_LOADED, () => {
              console.log('✅ HLS level loaded, attempting playback');
              if (!hasResolved) {
                videoElement.play().then(() => {
                  console.log(`✅ ${context} started successfully`);
                  hasResolved = true;
                  resolve(true);
                }).catch(error => {
                  console.error('❌ HLS playback failed:', error);
                  if (!hasResolved) {
                    hasResolved = true;
                    resolve(false);
                  }
                });
              }
            });
            
            hls.on(Hls.Events.ERROR, (event, data) => {
              console.error('❌ HLS error:', data);
              if (data.fatal) {
                console.error('❌ Fatal HLS error, trying next URL');
                hls.destroy();
                hlsRef.current = null;
                if (!hasResolved) {
                  hasResolved = true;
                  resolve(false);
                }
              }
            });
            
            // Timeout after 20 seconds
            setTimeout(() => {
              console.warn(`⏰ ${context} timed out for URL ${i + 1}`);
              if (!hasResolved) {
                hasResolved = true;
                resolve(false);
              }
            }, 20000);
          });
          
          // Load the HLS stream
          hls.loadSource(currentUrl);
          hls.attachMedia(videoElement);
          
          // Wait for manifest to be parsed and playback to start
          const success = await manifestParsed;
          if (success) {
            return true;
          }
          
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS support
          console.log('🍎 Using Safari native HLS support');
          videoElement.src = currentUrl;
          videoElement.load();
          
          const playPromise = videoElement.play();
          if (playPromise !== undefined) {
            await playPromise;
            console.log(`✅ ${context} started successfully with Safari native HLS`);
            return true;
          }
        } else {
          console.error('❌ HLS not supported in this browser');
          toast.error('Video streaming not supported in this browser', 5000);
          return false;
        }
        
      } catch (error) {
        console.error(`❌ ${context} attempt ${i + 1} failed:`, error);
        
        // Clean up on error
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        
        // Add a small delay before trying the next URL
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.error(`❌ All ${urlsToTry.length} HLS URLs failed for ${context}`);
    return false;
  };

  // Helper function to attempt media playback with fallback URLs
  const attemptAudioPlayback = async (originalUrl: string, context = 'playback'): Promise<boolean> => {
    console.log('🎵 Attempting audio playback:', { originalUrl, context });
    const isVideo = isVideoUrl(originalUrl);
    const isHls = isHlsUrl(originalUrl);
    const mediaElement = isVideo ? videoRef.current : audioRef.current;
    
    if (!mediaElement) {
      console.error(`❌ ${isVideo ? 'Video' : 'Audio'} element reference is null`);
      return false;
    }
    
    // Update video mode state
    setIsVideoMode(isVideo);
    
    if (isVideo) {
      console.log('🎬 Video URL detected, switching to video mode:', originalUrl);
    }
    
    if (isHls) {
      console.log('📺 HLS stream detected, using hls.js:', originalUrl);
      return attemptHlsPlayback(originalUrl, context);
    }
    
    const urlsToTry = getAudioUrlsToTry(originalUrl);
    
    // Set retry flag to prevent error handler interference
    isRetryingRef.current = true;
    
    for (let i = 0; i < urlsToTry.length; i++) {
      const audioUrl = urlsToTry[i];
      console.log(`🔄 ${context} attempt ${i + 1}/${urlsToTry.length}: ${typeof audioUrl === 'string' && audioUrl.includes('proxy-audio') ? 'Proxied URL' : 'Direct URL'}`);
      
      try {
        // Clean up any existing HLS instance when switching to regular media
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Check if media element is still valid
      const currentMediaElement = isVideo ? videoRef.current : audioRef.current;
      if (!currentMediaElement) {
        console.error(`❌ ${isVideo ? 'Video' : 'Audio'} element became null during playback attempt`);
        return false;
      }
      
      // Clear any previous error state before setting new source
      currentMediaElement.pause();
      currentMediaElement.removeAttribute('src');
      currentMediaElement.load();
      
      // Set new source and load
      currentMediaElement.src = audioUrl;
      currentMediaElement.load();
        
        // Set volume for audio, videos typically control their own volume
        if (!isVideo) {
          (currentMediaElement as HTMLAudioElement).volume = 0.8;
        }
        
        // Wait a bit for the media to load before attempting to play
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Ensure media is not muted for playback
        currentMediaElement.muted = false;
        if (!isVideo) {
          (currentMediaElement as HTMLAudioElement).volume = 0.8;
        }
        
        const playPromise = currentMediaElement.play();
        if (playPromise !== undefined) {
          await playPromise;
          const isProxied = typeof audioUrl === 'string' && audioUrl.includes('proxy-audio');
          console.log(`✅ ${context} started successfully with ${isProxied ? 'proxied' : 'direct'} URL (${isVideo ? 'VIDEO' : 'AUDIO'} mode)`);
          
          // Monitor successful playback
          monitoring.info('audio-playback', `Playback success on attempt ${i + 1}`, {
            context,
            method: isProxied ? 'proxy' : 'direct',
            mode: isVideo ? 'video' : 'audio',
            url: originalUrl
          });
          
          // Clear retry flag on success
          isRetryingRef.current = false;
          return true;
        }
      } catch (attemptError) {
        console.warn(`⚠️ ${context} attempt ${i + 1} failed:`, attemptError);
        
        // Monitor failed attempts
        const isProxied = typeof audioUrl === 'string' && audioUrl.includes('proxy-audio');
        const errorMessage = attemptError instanceof Error ? attemptError.message : String(attemptError);
        
        monitoring.warn('audio-playback', `Playback failed on attempt ${i + 1}`, {
          context,
          method: isProxied ? 'proxy' : 'direct',
          error: errorMessage,
          url: originalUrl
        });
        
        // Handle specific error types
        if (attemptError instanceof DOMException) {
          if (attemptError.name === 'NotAllowedError') {
            console.log('🚫 Autoplay blocked - this should not happen on user click');
            // If we get NotAllowedError on a user click, something is wrong
            // Don't show a generic message, return false to let playAlbum handle it
            return false;
          } else if (attemptError.name === 'NotSupportedError') {
            console.log('🚫 Audio format not supported');
            continue; // Try next URL
          } else if (attemptError.name === 'AbortError') {
            console.log('🚫 Audio request aborted - trying next URL');
            continue; // Try next URL
          } else if (typeof attemptError.message === 'string' && (attemptError.message.includes('CORS') || attemptError.message.includes('cross-origin'))) {
            console.log('🚫 CORS error - trying next URL');
            continue; // Try next URL
          }
        }
        
        // Add a small delay before trying the next URL
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Clear retry flag
    isRetryingRef.current = false;
    
    return false; // All attempts failed
  };

  // Media event listeners
  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;

    const handlePlay = () => {
      setIsPlaying(true);
      // Update media session playback state immediately for iOS
      if ('mediaSession' in navigator && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }
    };

    const handlePause = () => {
      setIsPlaying(false);
      // Update media session playback state immediately for iOS
      if ('mediaSession' in navigator && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'paused';
      }
    };

    const handleEnded = async () => {
      if (process.env.NODE_ENV === 'development') {
        console.log('🎵 Track ended, attempting to play next track');
      }

      try {
        // Immediately trigger next track without delay for better mobile performance
        // Use the ref to get the latest playNextTrack function
        if (playNextTrackRef.current) {
          // Call playNextTrack synchronously to avoid mobile browser throttling
          playNextTrackRef.current();
        } else {
          console.warn('⚠️ playNextTrackRef.current is null');
        }
      } catch (error) {
        console.error('❌ Error in auto-play:', error);
        // Don't let errors in auto-play crash the application
        setIsPlaying(false);
      }
    };

    const handleTimeUpdate = () => {
      const currentElement = isVideoMode ? video : audio;
      setCurrentTime(currentElement.currentTime);

      // Update position state for iOS lockscreen controls
      if ('mediaSession' in navigator && navigator.mediaSession && isPlaying) {
        if (currentElement.duration && !isNaN(currentElement.duration)) {
          try {
            navigator.mediaSession.setPositionState({
              duration: currentElement.duration,
              playbackRate: currentElement.playbackRate || 1.0,
              position: currentElement.currentTime
            });
          } catch (error) {
            // Ignore errors - some browsers don't support this
          }
        }
      }

      // Check if current track has end time and we've reached it
      if (currentPlayingAlbum && currentPlayingAlbum.tracks[currentTrackIndex]) {
        const track = currentPlayingAlbum.tracks[currentTrackIndex];
        if (track.endTime && typeof track.endTime === 'number') {
          if (currentElement.currentTime >= track.endTime) {
            console.log(`🎵 Reached end time: ${track.endTime}s for track: ${track.title}`);
            // Trigger the ended event to play next track
            currentElement.dispatchEvent(new Event('ended'));
          }
        }

        // Preload next track when we're close to the end (last 5 seconds)
        // This helps mobile devices prepare for smooth transitions
        const timeRemaining = (track.endTime || currentElement.duration) - currentElement.currentTime;
        if (timeRemaining > 0 && timeRemaining <= 5 && !currentElement.paused) {
          // Get next track info
          let nextTrack = null;
          if (isShuffleMode && shuffledPlaylist.length > 0) {
            const nextShuffleIndex = currentShuffleIndex + 1;
            if (nextShuffleIndex < shuffledPlaylist.length) {
              nextTrack = shuffledPlaylist[nextShuffleIndex]?.track;
            } else if (shuffledPlaylist.length > 0) {
              nextTrack = shuffledPlaylist[0]?.track;
            }
          } else if (currentTrackIndex + 1 < currentPlayingAlbum.tracks.length) {
            nextTrack = currentPlayingAlbum.tracks[currentTrackIndex + 1];
          } else if (repeatMode === 'all' && currentPlayingAlbum.tracks.length > 0) {
            nextTrack = currentPlayingAlbum.tracks[0];
          }

          // Preload next track to ensure smooth mobile playback
          if (nextTrack && nextTrack.url) {
            const nextElement = isVideoUrl(nextTrack.url) ? videoRef.current : audioRef.current;
            if (nextElement && nextElement !== currentElement) {
              // Only preload if not already loaded
              if (!nextElement.src || nextElement.src !== nextTrack.url) {
                console.log('🔄 Preloading next track for smooth transition:', nextTrack.title);
                nextElement.src = nextTrack.url;
                nextElement.preload = 'auto';
                nextElement.load();
              }
            }
          }
        }
      }
    };

    const handleLoadedMetadata = () => {
      const currentElement = isVideoMode ? video : audio;
      setDuration(currentElement.duration);

      // Re-update media session with duration info for iOS
      if (currentPlayingAlbum && currentPlayingAlbum.tracks[currentTrackIndex]) {
        const track = currentPlayingAlbum.tracks[currentTrackIndex];
        updateMediaSession(currentPlayingAlbum, track);

        // Check if current track has time segment information and seek to start time
        if (track.startTime && typeof track.startTime === 'number') {
          // Validate start time against duration
          if (track.startTime < currentElement.duration) {
            console.log(`🎵 Seeking to start time: ${track.startTime}s for track: ${track.title}`);
            currentElement.currentTime = track.startTime;
          } else {
            console.warn(`⚠️ Start time ${track.startTime}s is beyond track duration ${currentElement.duration}s for track: ${track.title}`);
          }
        }
      }
    };

    const handleError = (event: Event) => {
      const mediaError = (event.target as HTMLMediaElement)?.error;
      console.error(`🚫 ${isVideoMode ? 'Video' : 'Audio'} error:`, mediaError);
      
      // Don't interfere if we're in the middle of retrying
      if (isRetryingRef.current) {
        console.log('🔄 Error during retry process - letting retry logic handle it');
        return;
      }
      
      setIsPlaying(false);
      
      // Don't clear the source immediately - let the retry logic in attemptAudioPlayback handle it
      // Only log the error for debugging
      if (mediaError?.code === 4) {
        console.log('🔄 Media not suitable error - retry logic will handle this');
      } else if (mediaError?.code === 3) {
        console.log('🔄 Decode error - retry logic will handle this');
      } else if (mediaError?.code === 2) {
        console.log('🔄 Network error - retry logic will handle this');
      } else if (mediaError?.code === 1) {
        console.log('🔄 Aborted error - retry logic will handle this');
      }
    };

    // Add event listeners to both audio and video elements
    const elements = [audio, video];
    elements.forEach(element => {
      element.addEventListener('play', handlePlay);
      element.addEventListener('pause', handlePause);
      element.addEventListener('ended', handleEnded);
      element.addEventListener('timeupdate', handleTimeUpdate);
      element.addEventListener('loadedmetadata', handleLoadedMetadata);
      element.addEventListener('error', handleError);
    });

    // Cleanup
    return () => {
      elements.forEach(element => {
        element.removeEventListener('play', handlePlay);
        element.removeEventListener('pause', handlePause);
        element.removeEventListener('ended', handleEnded);
        element.removeEventListener('timeupdate', handleTimeUpdate);
        element.removeEventListener('loadedmetadata', handleLoadedMetadata);
        element.removeEventListener('error', handleError);
      });
      
      // Clean up HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isVideoMode, currentPlayingAlbum, currentTrackIndex, isShuffleMode, shuffledPlaylist, currentShuffleIndex, repeatMode]); // Add necessary dependencies for preloading logic

  // Helper function to proxy external image URLs for media session
  const getProxiedMediaImageUrl = (imageUrl: string): string => {
    if (!imageUrl) return '/stablekraft-rocket.png';

    // If it's already a local/proxied URL, return as-is
    if (imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')) {
      return imageUrl;
    }

    // Proxy external URLs to avoid CORS issues
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  };

  // Helper function to update media session metadata
  const updateMediaSession = (album: RSSAlbum, track: any) => {
    if ('mediaSession' in navigator && navigator.mediaSession) {
      try {
        // Ensure we have valid artwork URL - prefer track image, then album cover
        let originalArtworkUrl = track.image || album.coverArt || '/stablekraft-rocket.png';

        // Proxy external URLs to avoid CORS issues
        let artworkUrl = getProxiedMediaImageUrl(originalArtworkUrl);

        // If the URL is relative, make it absolute
        if (artworkUrl.startsWith('/')) {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://music.podtards.com';
          artworkUrl = `${baseUrl}${artworkUrl}`;
        }
        
        // Create artwork array with various sizes
        const artworkSizes = ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512'];
        const artwork = artworkSizes.map(size => ({
          src: artworkUrl,
          sizes: size,
          type: 'image/jpeg'
        }));
        
        // Also add a catch-all for any size
        artwork.push({
          src: artworkUrl,
          sizes: 'any',
          type: 'image/jpeg'
        });
        
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || 'Unknown Track',
          artist: album.artist || 'Unknown Artist',
          album: album.title || 'Unknown Album',
          artwork: artwork
        });

        // Set up media session action handlers - only track navigation, no seek
        navigator.mediaSession.setActionHandler('play', () => {
          console.log('📱 Media session: Play button pressed');
          // Show visual feedback
          if (typeof window !== 'undefined') {
            const msg = document.createElement('div');
            msg.innerHTML = '▶️ Play pressed';
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:green;color:white;padding:10px;border-radius:5px;z-index:9999;';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 2000);
          }
          resume();
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          console.log('📱 Media session: Pause button pressed');
          // Show visual feedback
          if (typeof window !== 'undefined') {
            const msg = document.createElement('div');
            msg.innerHTML = '⏸️ Pause pressed';
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:orange;color:white;padding:10px;border-radius:5px;z-index:9999;';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 2000);
          }
          pause();
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          console.log('📱 Media session: Previous track button pressed');
          // Show visual feedback
          if (typeof window !== 'undefined') {
            const msg = document.createElement('div');
            msg.innerHTML = '⏮️ Previous track pressed';
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:blue;color:white;padding:10px;border-radius:5px;z-index:9999;';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 2000);
          }
          if (playPreviousTrackRef.current) {
            playPreviousTrackRef.current();
          }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          console.log('📱 Media session: Next track button pressed');
          // Show visual feedback
          if (typeof window !== 'undefined') {
            const msg = document.createElement('div');
            msg.innerHTML = '⏭️ Next track pressed';
            msg.style.cssText = 'position:fixed;top:20px;right:20px;background:purple;color:white;padding:10px;border-radius:5px;z-index:9999;';
            document.body.appendChild(msg);
            setTimeout(() => msg.remove(), 2000);
          }
          if (playNextTrackRef.current) {
            playNextTrackRef.current();
          }
        });
        
        // Explicitly disable seek handlers to show track navigation buttons instead
        try {
          navigator.mediaSession.setActionHandler('seekbackward', null);
          navigator.mediaSession.setActionHandler('seekforward', null);
        } catch (e) {
          // Some browsers might not support these, ignore errors
        }

        // Set position state (required for iOS lockscreen controls)
        const currentElement = isVideoMode ? videoRef.current : audioRef.current;
        if (currentElement && currentElement.duration && !isNaN(currentElement.duration)) {
          try {
            navigator.mediaSession.setPositionState({
              duration: currentElement.duration,
              playbackRate: currentElement.playbackRate || 1.0,
              position: currentElement.currentTime || 0
            });
          } catch (error) {
            console.warn('Failed to set position state:', error);
          }
        }

        // Note: playbackState is now managed by handlePlay/handlePause event handlers
        // to avoid race conditions with state updates
        
        console.log('📱 Media session metadata updated:', {
          title: track.title,
          artist: album.artist,
          album: album.title,
          originalArtwork: originalArtworkUrl,
          proxiedArtwork: artworkUrl,
          playbackState: navigator.mediaSession.playbackState
        });
      } catch (error) {
        console.warn('Failed to update media session:', error);
      }
    }
  };

  // Play album function
  const playAlbum = async (album: RSSAlbum, trackIndex: number = 0): Promise<boolean> => {
    if (!album.tracks || album.tracks.length === 0) {
      console.error('❌ No tracks found in album');
      return false;
    }

    const track = album.tracks[trackIndex];
    if (!track || !track.url) {
      console.error('❌ No valid track found at index', trackIndex);
      return false;
    }

    // Since playAlbum is called from user clicks, we can safely set hasUserInteracted
    if (!hasUserInteracted) {
      console.log('🎵 First user interaction detected - enabling audio');
      setHasUserInteracted(true);
    }

    // Try to play the track immediately
    const success = await attemptAudioPlayback(track.url, 'Album playback');
    if (success) {
      setCurrentPlayingAlbum(album);
      setCurrentTrackIndex(trackIndex);

      // Update media session for lockscreen display
      updateMediaSession(album, track);

      // When manually playing an album/track, always exit shuffle mode
      // This ensures shuffle is turned off when you play something specific
      setIsShuffleMode(false);
      setShuffledPlaylist([]);
      setCurrentShuffleIndex(0);

      console.log('✅ Playback started successfully');
      return true;
    } else {
      // Only show retry message if it's a browser autoplay restriction
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        console.log('📱 Mobile playback failed - may need another tap');
        toast.info('Tap the play button once more to enable audio', 3000);
      }
      return false;
    }
  };

  // Play shuffled track function
  const playShuffledTrack = async (index: number): Promise<boolean> => {
    if (!shuffledPlaylist[index]) {
      console.error('❌ Invalid shuffle track index:', index, 'playlist length:', shuffledPlaylist.length);
      return false;
    }

    const trackData = shuffledPlaylist[index];
    const track = trackData.track;
    const album = trackData.album;

    if (!track || !track.url) {
      console.error('❌ No valid track found in shuffled playlist');
      return false;
    }

    const success = await attemptAudioPlayback(track.url, 'Shuffled track playback');
    if (success) {
      setCurrentPlayingAlbum(album);
      setCurrentTrackIndex(trackData.trackIndex);
      setCurrentShuffleIndex(index);
      setHasUserInteracted(true);
      
      // Update media session for lockscreen display
      updateMediaSession(album, track);
    }
    return success;
  };

  // Shuffle all tracks function
  const shuffleAllTracks = async (): Promise<boolean> => {
    if (albums.length === 0) {
      console.warn('No albums available for shuffle');
      return false;
    }

    // Create a flat array of all tracks with their album info
    const allTracks: Array<{
      album: RSSAlbum;
      trackIndex: number;
      track: any;
    }> = [];

    albums.forEach(album => {
      if (album.tracks && album.tracks.length > 0) {
        album.tracks.forEach((track, trackIndex) => {
          allTracks.push({
            album,
            trackIndex,
            track
          });
        });
      }
    });

    if (allTracks.length === 0) {
      console.warn('No tracks available for shuffle');
      return false;
    }

    // Shuffle the tracks array
    const shuffledTracks = [...allTracks];
    for (let i = shuffledTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
    }

    // Set up shuffle state
    setShuffledPlaylist(shuffledTracks);
    setCurrentShuffleIndex(0);
    setIsShuffleMode(true);

    // Play the first track in the shuffled playlist
    const firstTrack = shuffledTracks[0];
    console.log('🎲 Starting shuffle with:', firstTrack.track.title, 'from', firstTrack.album.title);

    // Play the first track directly using the local shuffledTracks array to avoid race condition
    const track = firstTrack.track;
    const album = firstTrack.album;

    if (!track || !track.url) {
      console.error('❌ No valid track found in shuffled playlist');
      return false;
    }

    const success = await attemptAudioPlayback(track.url, 'Shuffled track playback');
    if (success) {
      setCurrentPlayingAlbum(album);
      setCurrentTrackIndex(firstTrack.trackIndex);
      setCurrentShuffleIndex(0);
      setHasUserInteracted(true);
    }
    return success;
  };

  // Pause function
  const pause = () => {
    const currentElement = isVideoMode ? videoRef.current : audioRef.current;
    if (currentElement) {
      currentElement.pause();
      // Update media session playback state
      if ('mediaSession' in navigator && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'paused';
      }
    }
  };

  // Resume function
  const resume = () => {
    const currentElement = isVideoMode ? videoRef.current : audioRef.current;
    if (currentElement) {
      currentElement.play();
      // Update media session playback state
      if ('mediaSession' in navigator && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }
    }
  };

  // Seek function
  const seek = (time: number) => {
    const currentElement = isVideoMode ? videoRef.current : audioRef.current;
    if (currentElement && duration) {
      // Validate time value
      const validTime = Math.max(0, Math.min(time, duration));
      
      // Check if the time is reasonable (not too large)
      if (time > duration * 2) {
        console.warn(`⚠️ Seek time ${time}s is much larger than duration ${duration}s, clamping to duration`);
      }
      
      currentElement.currentTime = validTime;
      setCurrentTime(currentElement.currentTime);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🎵 Seeking to time: ${validTime}s (requested: ${time}s, duration: ${duration}s)`);
      }
    } else {
      console.warn('⚠️ Cannot seek: no media element or duration not available');
    }
  };

  // Play next track - moved before useEffect hooks that depend on it
  const playNextTrack = useCallback(async () => {
    // Add state validation and recovery logic
    if (!currentPlayingAlbum || !currentPlayingAlbum.tracks || currentPlayingAlbum.tracks.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ Cannot play next track: missing album or tracks');
        console.log('🔍 Current state:', {
          hasAlbum: !!currentPlayingAlbum,
          hasTracks: !!(currentPlayingAlbum?.tracks),
          trackCount: currentPlayingAlbum?.tracks?.length || 0,
          currentIndex: currentTrackIndex
        });
      }
      
      // Try to recover from IndexedDB if available
      if (typeof window !== 'undefined') {
        try {
          const savedState = await storage.getItem('audioPlayerState');
          if (savedState) {
            const parsedState = typeof savedState === 'string' ? JSON.parse(savedState) : savedState;
            if (parsedState.currentPlayingAlbum && parsedState.currentPlayingAlbum.tracks) {
              console.log('🔄 Attempting to recover from saved state');
              setCurrentPlayingAlbum(parsedState.currentPlayingAlbum);
              setCurrentTrackIndex(parsedState.currentTrackIndex || 0);
              // Retry after state recovery
              setTimeout(() => playNextTrack(), 100);
              return;
            }
          }
        } catch (error) {
          console.error('❌ Error recovering from IndexedDB:', error);
        }
      }
      
      return;
    }

    if (isShuffleMode && shuffledPlaylist.length > 0) {
      // In shuffle mode, play next track from shuffled playlist
      const nextShuffleIndex = currentShuffleIndex + 1;
      
      if (nextShuffleIndex < shuffledPlaylist.length) {
        // Play next track in shuffled playlist
        const nextTrack = shuffledPlaylist[nextShuffleIndex];
        console.log('🎲 Playing next shuffled track:', nextTrack.track.title, 'from', nextTrack.album.title);
        await playShuffledTrack(nextShuffleIndex);
      } else {
        // End of shuffled playlist - loop back to the first track
        console.log('🔁 End of shuffled playlist reached, looping back to first track');
        await playShuffledTrack(0);
      }
      return;
    }

    // Normal mode - play next track in current album
    
    // Handle repeat one mode
    if (repeatMode === 'one') {
      // Replay the same track
      if (process.env.NODE_ENV === 'development') {
        console.log('🔂 Repeat one: replaying current track');
      }
      await playAlbum(currentPlayingAlbum, currentTrackIndex);
      return;
    }
    
    const nextIndex = currentTrackIndex + 1;

    if (nextIndex < currentPlayingAlbum.tracks.length) {
      // Play next track in the album
      if (process.env.NODE_ENV === 'development') {
        console.log('🎵 Auto-playing next track:', currentPlayingAlbum.tracks[nextIndex].title);
      }
      await playAlbum(currentPlayingAlbum, nextIndex);
    } else {
      // End of album reached
      if (repeatMode === 'all') {
        // Loop back to the first track
        if (process.env.NODE_ENV === 'development') {
          console.log('🔁 Repeat all: looping back to first track');
        }
        await playAlbum(currentPlayingAlbum, 0);
      } else {
        // repeatMode === 'none' - stop playback
        if (process.env.NODE_ENV === 'development') {
          console.log('⏹️ End of album reached, stopping playback');
        }
        setIsPlaying(false);
        // Optionally reset to first track but don't play
        setCurrentTrackIndex(0);
      }
    }
  }, [currentPlayingAlbum, currentTrackIndex, isShuffleMode, shuffledPlaylist, currentShuffleIndex, playShuffledTrack, playAlbum, repeatMode]);

  // Update the ref whenever playNextTrack changes
  useEffect(() => {
    playNextTrackRef.current = playNextTrack;
  }, [playNextTrack]);

  // Play previous track
  const playPreviousTrack = async () => {
    if (isShuffleMode && shuffledPlaylist.length > 0) {
      // In shuffle mode, play previous track from shuffled playlist
      const prevShuffleIndex = currentShuffleIndex - 1;
      
      if (prevShuffleIndex >= 0) {
        // Play previous track in shuffled playlist
        const prevTrack = shuffledPlaylist[prevShuffleIndex];
        console.log('🎲 Playing previous shuffled track:', prevTrack.track.title, 'from', prevTrack.album.title);
        await playShuffledTrack(prevShuffleIndex);
      } else {
        // Go to the last track in shuffled playlist
        const lastIndex = shuffledPlaylist.length - 1;
        const lastTrack = shuffledPlaylist[lastIndex];
        console.log('🎲 Playing last shuffled track:', lastTrack.track.title, 'from', lastTrack.album.title);
        await playShuffledTrack(lastIndex);
      }
      return;
    }

    // Normal mode - play previous track in current album
    if (!currentPlayingAlbum || !currentPlayingAlbum.tracks) return;

    const prevIndex = currentTrackIndex - 1;
    if (prevIndex >= 0) {
      console.log('🎵 Playing previous track:', currentPlayingAlbum.tracks[prevIndex].title);
      await playAlbum(currentPlayingAlbum, prevIndex);
    }
  };

  // Update the ref whenever playPreviousTrack changes
  useEffect(() => {
    playPreviousTrackRef.current = playPreviousTrack;
  }, [playPreviousTrack]);

  // Play individual track function
  const playTrack = async (audioUrl: string, startTime: number = 0, endTime?: number): Promise<boolean> => {
    console.log('🎵 Playing individual track:', { audioUrl, startTime, endTime });
    
    // Stop any current playback
    stop();
    
    // Set user interaction flag
    setHasUserInteracted(true);
    
    // Create a single-track "album" to enable repeat functionality
    const singleTrackAlbum: RSSAlbum = {
      title: 'Single Track',
      artist: 'Unknown Artist',
      description: '',
      coverArt: null,
      releaseDate: new Date().toISOString(),
      tracks: [{
        title: 'Track',
        url: audioUrl,
        startTime,
        endTime,
        duration: '0' // Will be updated when metadata loads
      }]
    };
    
    // Set the album context so repeat works
    setCurrentPlayingAlbum(singleTrackAlbum);
    setCurrentTrackIndex(0);
    
    // Attempt to play the track
    const success = await attemptAudioPlayback(audioUrl, 'individual track');
    
    if (success && startTime > 0) {
      // Seek to start time after a short delay to ensure media is loaded
      setTimeout(() => {
        console.log('🎵 Seeking to start time:', startTime);
        seek(startTime);
      }, 500);
    }
    
    console.log('🎵 Track playback result:', success);
    return success;
  };

  // Stop function
  const stop = () => {
    // Stop both audio and video elements
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    
    // Clean up HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    
    setIsPlaying(false);
    setCurrentPlayingAlbum(null);
    setCurrentTrackIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setIsVideoMode(false);
    
    // Clear shuffle state
    setIsShuffleMode(false);
    setShuffledPlaylist([]);
    setCurrentShuffleIndex(0);

    // Clear IndexedDB
    if (typeof window !== 'undefined') {
      storage.removeItem('audioPlayerState');
    }
  };

  // Toggle shuffle mode
  const toggleShuffle = () => {
    setIsShuffleMode(prev => !prev);
    if (process.env.NODE_ENV === 'development') {
      console.log('🎲 Shuffle mode toggled:', !isShuffleMode);
    }
  };

  const value: AudioContextType = {
    currentPlayingAlbum,
    isPlaying,
    currentTrackIndex,
    currentTime,
    duration,
    isVideoMode,
    isShuffleMode,
    isFullscreenMode,
    setFullscreenMode: setIsFullscreenMode,
    repeatMode,
    setRepeatMode,
    playAlbum,
    playTrack,
    playShuffledTrack,
    shuffleAllTracks,
    toggleShuffle,
    pause,
    resume,
    seek,
    playNextTrack,
    playPreviousTrack,
    stop,
    audioRef,
    videoRef
  };

  return (
    <AudioContext.Provider value={value}>
      {children}
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        autoPlay={false}
        controls={true}
        muted={false}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '1px',
          height: '1px',
          opacity: 0,
          zIndex: -1,
          pointerEvents: 'none'
        }}
      />
      {/* Hidden video element */}
      <video
        ref={videoRef}
        preload="metadata"
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        autoPlay={false}
        controls={true}
        muted={false}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '1px',
          height: '1px',
          opacity: 0,
          zIndex: -1,
          pointerEvents: 'none'
        }}
      />
    </AudioContext.Provider>
  );
}; 