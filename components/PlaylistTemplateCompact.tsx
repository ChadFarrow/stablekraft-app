'use client';

import { useState, useEffect, useMemo } from 'react';
import { Play, Pause, Search, ChevronLeft, Loader2, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useAudio } from '@/contexts/AudioContext';
import { logger } from '@/lib/logger';
import Link from 'next/link';
import type { Track, SortOption, FilterSource, ViewMode, CacheStatus, CachedData, PlaylistConfig, PlaylistStats } from '@/types/playlist';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { getAlbumArtworkUrl } from '@/lib/cdn-utils';
import AppLayout from '@/components/AppLayout';

interface PlaylistTemplateCompactProps {
  config: PlaylistConfig;
}

export default function PlaylistTemplateCompact({ config }: PlaylistTemplateCompactProps) {

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [stats, setStats] = useState<PlaylistStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>(null);
  const [playlistArtwork, setPlaylistArtwork] = useState<string | null>(null);
  const [playlistLink, setPlaylistLink] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Search and filtering
  const [searchQuery, setSearchQuery] = useState('');
  // Default to 'original' to preserve XML feed order for all playlists
  const [sortBy, setSortBy] = useState<SortOption>('original');
  
  // Client-side check
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Always call the hook, but only use it if enabled
  const audioContext = useAudio();
  const shouldUseAudioContext = config.useAudioContext;

  // Load cached data on component mount
  useEffect(() => {
    logger.info(`🚀 ${config.title} Playlist component mounted`);

    const loadCachedData = async () => {
      try {
        // Try IndexedDB first for large playlists, then localStorage
        let cached: string | null = null;
        let data: CachedData | null = null;
        
        try {
          const { storage } = await import('@/lib/indexed-db-storage');
          data = await storage.getItem<CachedData>(config.cacheKey);
        } catch (indexedDBError) {
          // Fallback to localStorage
          try {
            cached = localStorage.getItem(config.cacheKey);
            if (cached) {
              data = JSON.parse(cached);
            }
          } catch (localError) {
            console.warn(`Failed to load from localStorage:`, localError);
          }
        }
        
        if (data) {
          const now = Date.now();

          // Check if cache has resolved V4V data OR is a database playlist
          const hasResolvedData = data.tracks.some(track =>
            track.valueForValue?.resolved === true && (
              track.valueForValue?.resolvedAudioUrl || track.valueForValue?.resolvedArtist
            )
          );

          // For database playlists, we don't need V4V resolution
          const isDatabasePlaylist = config.apiEndpoint.includes('/api/playlist/');
          const cacheIsValid = hasResolvedData || isDatabasePlaylist;

          console.log(`🔍 Cache validation for ${config.title}:`, {
            hasResolvedData,
            isDatabasePlaylist,
            cacheIsValid,
            trackCount: data.tracks.length
          });

          // Check if cache is still valid AND (has resolved V4V data OR is database playlist)
          if (now - data.timestamp < config.cacheDuration && cacheIsValid) {
            logger.info('📦 Loading tracks from cache');
            console.log(`🔍 Cache data for ${config.title}:`, data.tracks.length, 'tracks');
            console.log(`🔍 First cached track:`, data.tracks[0]);
            setTracks(data.tracks);
            
            // Load artwork and link from cache if available
            if (data.artwork) {
              setPlaylistArtwork(data.artwork);
            }
            if (data.link) {
              setPlaylistLink(data.link);
            }
            
            setLoading(false);
            setCacheStatus('cached');
            return true; // Cache was used
          } else {
            if (!cacheIsValid) {
              logger.info('🔄 Cache invalid (missing V4V data for non-database playlist), will fetch fresh data');
            } else {
              logger.info('⏰ Cache expired, will fetch fresh data');
            }
            console.log(`🗑️ Removing cache for ${config.title}`);
            // Remove from both storage locations
            try {
              const { storage } = await import('@/lib/indexed-db-storage');
              await storage.removeItem(config.cacheKey);
            } catch {
              // Ignore errors
            }
            try {
              localStorage.removeItem(config.cacheKey);
            } catch {
              // Ignore errors
            }
          }
        }
        return false; // Cache was not used
      } catch (error) {
        logger.error('❌ Error loading cached data:', error);
        // Try to remove from both storage locations
        try {
          const { storage } = await import('@/lib/indexed-db-storage');
          await storage.removeItem(config.cacheKey);
        } catch {
          // Ignore errors
        }
        try {
          localStorage.removeItem(config.cacheKey);
        } catch {
          // Ignore errors
        }
        return false;
      }
    };

    loadCachedData().then((cacheUsed) => {
      if (!cacheUsed) {
        loadTracks();
      }
    }).catch((error) => {
      console.error('Error loading cached data:', error);
      loadTracks();
    });
  }, [config.cacheKey, config.cacheDuration, config.apiEndpoint]);

  // Load tracks from API
  const loadTracks = async () => {
    console.log(`🚨 loadTracks called for ${config.title}`);
    console.log(`🚨 API endpoint: ${config.apiEndpoint}`);
    try {
      setLoading(true);
      setError(null);
      logger.info(`🔄 Loading tracks for ${config.title}...`);

      console.log(`🚨 About to fetch: ${config.apiEndpoint}`);
      const response = await fetch(config.apiEndpoint);
      console.log(`🚨 Fetch completed, status: ${response.status}`);
      if (!response.ok) {
        throw new Error(`Failed to load tracks: ${response.status}`);
      }

      const data = await response.json();
      console.log(`🔍 Raw API data for ${config.title}:`, data);

      // Handle both album format and direct tracks format
      // Prioritize albums format to get artwork, but fall back to direct tracks if needed
      let tracksData = [];
      let artworkUrl = null;
      
      if (data.albums && data.albums[0] && data.albums[0].tracks) {
        // Album format (like /api/playlist/itdv, flowgnar)
        tracksData = data.albums[0].tracks;
        artworkUrl = data.albums[0].coverArt || data.albums[0].image || data.playlist?.artwork || data.data?.playlist?.image;
        console.log(`🔍 Album format: ${tracksData.length} tracks from album "${data.albums[0].title}"`);
        console.log(`🎨 Playlist artwork URL:`, artworkUrl);
      } else if (data.tracks) {
        // Direct tracks format (like /api/itdv-resolved-songs)
        tracksData = data.tracks;
        // Still try to extract artwork from albums or playlist data if available
        artworkUrl = data.albums?.[0]?.coverArt || data.albums?.[0]?.image || data.playlist?.artwork || data.data?.playlist?.image;
        console.log(`🔍 Direct tracks format: ${tracksData.length} tracks`);
        if (artworkUrl) {
          console.log(`🎨 Found artwork in direct tracks format:`, artworkUrl);
        }
      } else {
        console.log(`🚨 Unknown API format:`, Object.keys(data));
        tracksData = [];
      }

      // Store playlist artwork and link
      if (artworkUrl) {
        setPlaylistArtwork(artworkUrl);
      }
      
      // Store playlist link from API response
      if (data.albums && data.albums[0] && data.albums[0].link) {
        setPlaylistLink(data.albums[0].link);
      }

      logger.info(`✅ Loaded ${tracksData.length} tracks for ${config.title}`);
      console.log(`🔍 First track sample:`, tracksData[0]);
      setTracks(tracksData);
      setCacheStatus('fresh');

      // Check if this is a fast-loading playlist that needs full data
      if (data.albums && data.albums[0] && data.albums[0].isLoading && data.albums[0].fullDataUrl) {
        console.log(`🔄 Fast-loaded playlist detected, loading full data from ${data.albums[0].fullDataUrl}`);
        // Load full data in background after fast load
        setTimeout(async () => {
          try {
            const fullResponse = await fetch(data.albums[0].fullDataUrl);
            if (fullResponse.ok) {
              const fullData = await fullResponse.json();
              if (fullData.albums && fullData.albums[0] && fullData.albums[0].tracks) {
                console.log(`✅ Loaded full track data: ${fullData.albums[0].tracks.length} tracks`);
                setTracks(fullData.albums[0].tracks);
                
                // Update playlist link if available in full data
                if (fullData.albums[0].link) {
                  setPlaylistLink(fullData.albums[0].link);
                }
                
                // Cache the full data using IndexedDB for large playlists
                const fullCacheData: CachedData = {
                  tracks: fullData.albums[0].tracks,
                  timestamp: Date.now(),
                  feedUrl: config.feedUrl || '',
                  artwork: fullData.albums[0].coverArt || fullData.albums[0].image,
                  link: fullData.albums[0].link
                };
                
                // Use IndexedDB for large playlists to avoid quota issues
                try {
                  const { storage } = await import('@/lib/indexed-db-storage');
                  await storage.setItem(config.cacheKey, fullCacheData);
                  console.log(`✅ Cached full playlist data to IndexedDB`);
                } catch (error) {
                  console.error(`❌ Error caching playlist data:`, error);
                  // Continue without caching - better than crashing
                }
              }
            }
          } catch (error) {
            console.error('Failed to load full playlist data:', error);
          }
        }, 100); // Small delay to let fast UI load first
      } else {
        // Cache the data only if it's not a fast-loading placeholder
        const cacheData: CachedData = {
          tracks: tracksData,
          timestamp: Date.now(),
          feedUrl: config.feedUrl || '',
          artwork: artworkUrl,
          link: data.albums && data.albums[0] ? data.albums[0].link : null
        };
        
        // Use IndexedDB for large playlists (1000+ tracks) to avoid quota issues
        const useIndexedDB = tracksData.length > 1000;
        
        if (useIndexedDB) {
          try {
            const { storage } = await import('@/lib/indexed-db-storage');
            await storage.setItem(config.cacheKey, cacheData);
            console.log(`✅ Cached large playlist (${tracksData.length} tracks) to IndexedDB`);
          } catch (error) {
            console.error(`❌ Error caching large playlist to IndexedDB:`, error);
            // Fallback to localStorage for smaller data
            try {
              localStorage.setItem(config.cacheKey, JSON.stringify(cacheData));
            } catch (localError) {
              if (localError instanceof DOMException && localError.name === 'QuotaExceededError') {
                console.error(`❌ Storage quota exceeded. Unable to cache playlist.`);
                logger.error(`❌ Error loading ${config.title} Playlist tracks:`, localError);
              } else {
                throw localError;
              }
            }
          }
        } else {
          // Use localStorage for smaller playlists
          try {
            localStorage.setItem(config.cacheKey, JSON.stringify(cacheData));
          } catch (error) {
            if (error instanceof DOMException && error.name === 'QuotaExceededError') {
              console.warn(`⚠️ localStorage quota exceeded, trying IndexedDB...`);
              try {
                const { storage } = await import('@/lib/indexed-db-storage');
                await storage.setItem(config.cacheKey, cacheData);
                console.log(`✅ Fallback to IndexedDB successful`);
              } catch (indexedDBError) {
                console.error(`❌ Both storage methods failed:`, indexedDBError);
                logger.error(`❌ Error loading ${config.title} Playlist tracks:`, indexedDBError);
              }
            } else {
              throw error;
            }
          }
        }
      }

    } catch (error) {
      console.log(`🚨 Error in loadTracks for ${config.title}:`, error);
      
      // Handle network errors more gracefully
      let errorMessage = 'Failed to load tracks';
      if (error instanceof TypeError && error.message.includes('fetch')) {
        errorMessage = 'Network error: Unable to connect to the server. Please check your connection and try again.';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      logger.error(`❌ Error loading ${config.title} tracks:`, error);
      setError(errorMessage);
      
      // Try to use cached data as fallback if available
      try {
        let cachedData: CachedData | null = null;
        
        // Try IndexedDB first
        try {
          const { storage } = await import('@/lib/indexed-db-storage');
          cachedData = await storage.getItem<CachedData>(config.cacheKey);
        } catch {
          // Fallback to localStorage
          const cachedDataStr = localStorage.getItem(config.cacheKey);
          if (cachedDataStr) {
            cachedData = JSON.parse(cachedDataStr);
          }
        }
        
        if (cachedData) {
          const cacheAge = Date.now() - cachedData.timestamp;
          const maxCacheAge = config.cacheDuration || 3600000; // Default 1 hour
          
          // Use cached data even if it's old (better than nothing)
          if (cachedData.tracks && cachedData.tracks.length > 0) {
            console.log(`⚠️ Using cached data as fallback for ${config.title} (cache age: ${Math.floor(cacheAge / 1000)}s)`);
            setTracks(cachedData.tracks);
            if (cachedData.artwork) {
              setPlaylistArtwork(cachedData.artwork);
            }
            if (cachedData.link) {
              setPlaylistLink(cachedData.link);
            }
            setCacheStatus('stale');
            setError(null); // Clear error if we have cached data
            return; // Don't set loading to false here, let finally do it
          }
        }
      } catch (cacheError) {
        console.warn(`Failed to read cache for ${config.title}:`, cacheError);
      }
    } finally {
      console.log(`🚨 loadTracks finally block for ${config.title}`);
      setLoading(false);
    }
  };

  // Filter and sort tracks
  const filteredTracks = useMemo(() => {
    console.log(`🔍 Starting filter with ${tracks.length} tracks`);
    let filtered = tracks;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(track =>
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query) ||
        (track.episodeTitle || '').toLowerCase().includes(query)
      );
      console.log(`🔍 After search filter: ${filtered.length} tracks`);
    }

    // Log track sources before filtering
    if (filtered.length > 0) {
      const sources = [...new Set(filtered.map(t => t.source))];
      console.log(`🔍 Available track sources:`, sources);
      console.log(`🔍 Sample tracks:`, filtered.slice(0, 3).map(t => ({title: t.title, source: t.source})));
    }

    // TEMP: Disable source filtering to test
    console.log(`🔍 TEMP: Skipping source filter, keeping all ${filtered.length} tracks`);

    // Filter to only main tracks (chapters and value-splits)
    // const originalCount = filtered.length;
    // filtered = filtered.filter(track => track.source === 'chapter' || track.source === 'value-split');
    // console.log(`🔍 Source filter: ${originalCount} -> ${filtered.length} tracks (kept chapter/value-split)`);

    // if (filtered.length === 0 && originalCount > 0) {
    //   console.log(`🚨 All tracks filtered out! Available sources were:`, [...new Set(tracks.map(t => t.source))]);
    // }

    // Sort tracks (skip sorting if 'original' to preserve API order)
    if (sortBy !== 'original') {
      filtered.sort((a, b) => {
        switch (sortBy) {
          case 'episode-desc':
            return (b.episodeTitle || '').localeCompare(a.episodeTitle || '');
          case 'episode-asc':
            return (a.episodeTitle || '').localeCompare(b.episodeTitle || '');
          case 'title-asc':
            return a.title.localeCompare(b.title);
          case 'title-desc':
            return b.title.localeCompare(a.title);
          case 'artist-asc':
            return a.artist.localeCompare(b.artist);
          case 'artist-desc':
            return b.artist.localeCompare(a.artist);
          case 'time-asc':
            return a.startTime - b.startTime;
          default:
            return 0;
        }
      });
    }

    return filtered;
  }, [tracks, searchQuery, sortBy]);

  // Calculate stats
  const calculatedStats = useMemo(() => {
    const stats: PlaylistStats = {
      totalTracks: filteredTracks.length,
      totalDuration: filteredTracks.reduce((sum, track) => sum + track.duration, 0),
      resolvedTracks: filteredTracks.filter(track => track.valueForValue?.resolved).length,
      episodes: new Set(filteredTracks.map(track => track.episodeTitle)).size,
      sources: {}
    };

    filteredTracks.forEach(track => {
      stats.sources[track.source] = (stats.sources[track.source] || 0) + 1;
    });

    return stats;
  }, [filteredTracks]);

  useEffect(() => {
    setStats(calculatedStats);
  }, [calculatedStats]);

  // Audio player functions
  const handlePlay = async (track: Track) => {
    if (shouldUseAudioContext && audioContext) {
      // Use global audio context
      const trackData = {
        id: track.id,
        title: track.valueForValue?.resolvedTitle || track.title,
        artist: track.valueForValue?.resolvedArtist || track.artist,
        audioUrl: track.valueForValue?.resolvedAudioUrl || track.audioUrl,
        duration: (track.valueForValue?.resolvedDuration || track.duration).toString(),
        artwork: track.image || '/placeholder-album.jpg'
      };

      const albumData = {
        id: `${config.cacheKey}-playlist`,
        title: config.title,
        artist: 'Various Artists',
        year: new Date().getFullYear().toString(),
        coverArt: playlistArtwork || '/placeholder-album.jpg',
        description: config.description,
        releaseDate: new Date().toISOString(),
        tracks: filteredTracks.map(t => ({
          id: t.id,
          title: t.valueForValue?.resolvedTitle || t.title,
          artist: t.valueForValue?.resolvedArtist || t.artist,
          url: t.valueForValue?.resolvedAudioUrl || t.audioUrl,
          duration: (t.valueForValue?.resolvedDuration || t.duration).toString(),
          image: t.image,
          artwork: t.image
        }))
      };

      await audioContext.playAlbum(albumData, albumData.tracks.findIndex(t => t.id === track.id));
    } else {
      // Use local audio player
      if (audio && currentTrack === track.id) {
        if (audio.paused) {
          await audio.play();
        } else {
          audio.pause();
        }
        return;
      }

      if (audio) {
        audio.pause();
        audio.src = '';
      }

      const audioUrl = track.valueForValue?.resolvedAudioUrl || track.audioUrl;
      const newAudio = new Audio(audioUrl);

      setAudioLoading(track.id);
      setCurrentTrack(track.id);

      newAudio.addEventListener('loadstart', () => {
        logger.info(`🎵 Loading audio for: ${track.title}`);
      });

      newAudio.addEventListener('canplay', () => {
        setAudioLoading(null);
        logger.info(`✅ Audio ready for: ${track.title}`);
      });

      newAudio.addEventListener('error', (e) => {
        logger.error(`❌ Audio error for ${track.title}:`, e);
        setAudioLoading(null);
        setCurrentTrack(null);
      });

      setAudio(newAudio);

      try {
        await newAudio.play();
      } catch (error) {
        logger.error(`❌ Failed to play ${track.title}:`, error);
        setAudioLoading(null);
        setCurrentTrack(null);
      }
    }
  };

  const formatDuration = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) {
      return `${days}:${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Optimized background style calculation - memoized to prevent repeated logs
  // MUST be called before any early returns to follow React hooks rules
  const backgroundStyle = useMemo(() => {
    // Create a fixed background that overrides the global layout background
    const baseStyle = {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1  // Override global background (which is z-0)
    };

    // For backgrounds, use enhanced proxy for better quality and upscaling
    // This ensures high-resolution backgrounds even from low-res sources
    const highResBackgroundUrl = playlistArtwork && isClient
      ? (() => {
          // Use proxy with enhancement for external images, direct URL for internal
          if (playlistArtwork.includes('re.podtards.com') || playlistArtwork.startsWith('/')) {
            return getAlbumArtworkUrl(playlistArtwork, 'xl', false);
          }
          // For external images, use enhanced proxy
          return `/api/proxy-image?url=${encodeURIComponent(playlistArtwork)}&enhance=true&minWidth=1920&minHeight=1080`;
        })()
      : null;

    const style = highResBackgroundUrl ? {
      ...baseStyle,
      backgroundImage: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url('${highResBackgroundUrl}')`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
      // Add image rendering optimizations for better quality
      filter: 'blur(0px) contrast(1.05) brightness(0.95)',
      imageRendering: 'high-quality' as any,
      WebkitBackfaceVisibility: 'hidden' as any,
      transform: 'translateZ(0)' as any,
    } : {
      ...baseStyle,
      background: 'linear-gradient(to bottom right, rgb(17, 24, 39), rgb(31, 41, 55), rgb(17, 24, 39))'
    };

    return style;
  }, [playlistArtwork, isClient]);

  // Early returns AFTER all hooks
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-stablekraft-teal" />
          <p className="text-gray-300">Loading {config.title}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Playlist</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-stablekraft-teal text-white px-4 py-2 rounded-lg hover:bg-stablekraft-orange transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen text-white relative overflow-hidden">
      {/* Background layer - similar to album pages */}
      <div 
        className="fixed inset-0"
        style={backgroundStyle}
      />

      {/* Content overlay - positioned above background like album pages */}
      <div className="min-h-screen text-white relative z-10">
        {/* Back to Albums Link */}
        <div className="container mx-auto px-6 pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-gray-400 hover:text-stablekraft-teal transition-colors text-sm mb-4"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back to Albums</span>
          </Link>
        </div>

        {/* Album Header */}
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-start md:items-end gap-6 mb-8">
            {/* Album Art */}
            <div
              className="w-48 h-48 bg-gray-900/60 backdrop-blur-sm rounded-lg flex-shrink-0 overflow-hidden relative group cursor-pointer transform transition-transform hover:scale-105"
              onClick={() => {
                if (filteredTracks.length > 0) {
                  handlePlay(filteredTracks[0]);
                }
              }}
            >
              {playlistArtwork ? (
                <>
                  <img
                    src={playlistArtwork}
                    alt={config.title}
                    className="w-full h-full object-cover"
                  />
                  {/* Play Button Overlay */}
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-all duration-300">
                    <div className="w-24 h-24 bg-white hover:bg-white rounded-full flex items-center justify-center shadow-2xl transform group-hover:scale-110 transition-all duration-300 border-2 border-white/20">
                      <Play className="w-12 h-12 text-black ml-1" />
                    </div>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-32 h-32 bg-stablekraft-teal/20 rounded-lg flex items-center justify-center">
                    <Play className="w-12 h-12 text-stablekraft-teal" />
                  </div>
                </div>
              )}
            </div>

            {/* Album Info */}
            <div className="flex-1">
              <div className="flex items-start gap-4 mb-2">
                <h1 className="text-4xl font-bold flex-1">{config.title}</h1>
                {playlistLink && (
                  <a
                    href={playlistLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors duration-200 text-white/80 hover:text-white"
                    title="Visit playlist website"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span className="text-sm font-medium">Website</span>
                  </a>
                )}
              </div>
              <p className="text-white/80 mb-4">{config.description}</p>
              {stats && (
                <div className="flex flex-wrap gap-4 text-sm text-white/70">
                  <span>{new Date().getFullYear()}</span>
                  <span>•</span>
                  <span>{stats.totalTracks} tracks</span>
                  <span>•</span>
                  <span>{formatDuration(stats.totalDuration)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Search and Tracks Container */}
          <div className="bg-black/60 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50">
            {/* Search */}
            <div className="mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search tracks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-900/60 border border-gray-600/50 rounded-lg focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal text-white placeholder-white/60"
                />
              </div>
            </div>

            {/* Tracks Header */}
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                Tracks
                <span className="text-sm text-gray-200 bg-gray-800/60 px-2 py-1 rounded">
                  {filteredTracks.length}
                </span>
              </h2>
            </div>

            {/* Track List */}
            <div className="space-y-1">
            {filteredTracks.map((track, index) => {
              const isCurrentTrack = shouldUseAudioContext ?
                (audioContext?.currentPlayingAlbum?.id === `${config.cacheKey}-playlist` && audioContext?.currentTrackIndex === index) :
                currentTrack === track.id;
              const isLoading = audioLoading === track.id;

              return (
                <div
                  key={`${track.id}-${index}`}
                  className={`group flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 transition-colors ${
                    isCurrentTrack ? 'bg-stablekraft-teal/20' : ''
                  }`}
                >
                  {/* Track Artwork with Play Button Overlay */}
                  {track.image ? (
                    <div className="relative flex-shrink-0 w-10 h-10">
                      <img
                        src={track.image}
                        alt={track.title}
                        className="w-10 h-10 rounded object-cover"
                      />
                      {/* Play button overlay */}
                      <button
                        onClick={() => handlePlay(track)}
                        disabled={isLoading}
                        className={`absolute inset-0 flex items-center justify-center rounded bg-black/50 transition-opacity ${
                          isCurrentTrack ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 className="h-5 w-5 text-white animate-spin" />
                        ) : isCurrentTrack && (shouldUseAudioContext ? audioContext?.isPlaying : !audio?.paused) ? (
                          <Pause className="h-5 w-5 text-white" />
                        ) : (
                          <Play className="h-5 w-5 text-white" />
                        )}
                      </button>
                      {/* Rank badge for Top 100 */}
                      {track.rank && (
                        <div className={`absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow-md ${
                          track.rank === 1
                            ? 'bg-yellow-500 text-black'
                            : track.rank <= 3
                              ? 'bg-gray-300 text-black'
                              : track.rank <= 10
                                ? 'bg-amber-700 text-white'
                                : 'bg-gray-700 text-white'
                        }`}>
                          {track.rank}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Fallback: Track Number / Play Button when no image */
                    <div className="w-10 h-10 flex items-center justify-center">
                      <button
                        onClick={() => handlePlay(track)}
                        disabled={isLoading}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                          isCurrentTrack ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        } ${
                          isCurrentTrack
                            ? 'bg-stablekraft-teal text-white'
                            : 'bg-gray-700 hover:bg-gray-600 text-white'
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isCurrentTrack && (shouldUseAudioContext ? audioContext?.isPlaying : !audio?.paused) ? (
                          <Pause className="h-4 w-4" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                      </button>
                      <span className={`absolute text-sm text-gray-400 transition-opacity ${
                        isCurrentTrack ? 'opacity-0' : 'group-hover:opacity-0'
                      }`}>
                        {index + 1}
                      </span>
                    </div>
                  )}

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-sm font-medium truncate ${
                      isCurrentTrack ? 'text-stablekraft-teal' : 'text-white'
                    }`}>
                      {track.valueForValue?.resolvedTitle || track.title}
                    </h3>
                    <p className="text-xs text-white/70 truncate">
                      {track.valueForValue?.resolvedArtist || track.artist}
                    </p>
                  </div>

                  {/* Duration & V4V Badge */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {track.valueForValue?.resolved && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">
                        V4V
                      </span>
                    )}
                    <span className="text-xs text-white/70 tabular-nums">
                      {formatDuration(track.valueForValue?.resolvedDuration || track.duration)}
                    </span>
                  </div>

                  {/* Favorite Button */}
                  <div className="flex-shrink-0">
                    <FavoriteButton
                      trackId={track.itemGuid || track.id}
                      feedGuidForImport={track.feedGuid || track.valueForValue?.feedGuid}
                      size={18}
                      className="p-1"
                    />
                  </div>

                  {/* Boost Button - Far Right */}
                  <div className="flex-shrink-0">
                    <BoostButton
                      trackId={track.id}
                      feedId={track.valueForValue?.feedGuid || track.feedGuid}
                      trackTitle={track.valueForValue?.resolvedTitle || track.title}
                      artistName={track.valueForValue?.resolvedArtist || track.artist}
                      lightningAddress={track.v4vRecipient}
                      valueSplits={track.v4vValue?.recipients || track.v4vValue?.destinations
                        ? (track.v4vValue.recipients || track.v4vValue.destinations)
                            .filter((r: any) => !r.fee)
                            .map((r: any) => ({
                              name: r.name || track.artist,
                              address: r.address || '',
                              split: parseInt(r.split) || 100,
                              type: r.type === 'lnaddress' ? 'lnaddress' : 'node'
                            }))
                        : undefined}
                      episodeGuid={track.valueForValue?.itemGuid || track.itemGuid}
                      remoteFeedGuid={track.valueForValue?.feedGuid || track.feedGuid}
                      className="text-xs"
                    />
                  </div>
                </div>
              );
            })}
            </div>

            {filteredTracks.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-white mb-2">No tracks found</h3>
                <p className="text-gray-400">
                  {searchQuery ? 'Try adjusting your search query' : 'No tracks available in this playlist'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </AppLayout>
  );
}
