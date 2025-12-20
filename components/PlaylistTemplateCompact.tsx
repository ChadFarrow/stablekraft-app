'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Play, Pause, Search, ChevronLeft, Loader2, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useAudio } from '@/contexts/AudioContext';
import { logger } from '@/lib/logger';
import { getProxiedAudioUrl } from '@/lib/audio-url-utils';
import Link from 'next/link';
import type { Track, SortOption, FilterSource, ViewMode, CacheStatus, CachedData, PlaylistConfig, PlaylistStats, Episode, EpisodeViewMode } from '@/types/playlist';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { Share2, List, Layers } from 'lucide-react';
import EpisodeSection from '@/components/EpisodeSection';
import { toast } from '@/components/Toast';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumSlug } from '@/lib/url-utils';
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

  // Episode grouping
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [hasEpisodeMarkers, setHasEpisodeMarkers] = useState(false);
  const [episodeViewMode, setEpisodeViewMode] = useState<EpisodeViewMode>('grouped');
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());

  // Pagination for large playlists
  const TRACKS_PER_PAGE = 50;
  const [displayedCount, setDisplayedCount] = useState(TRACKS_PER_PAGE);
  
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
          const cacheAge = now - data.timestamp;
          
          // Simplified cache validation - check timestamp, track count, and episode integrity
          // If cache claims to have episodes but they're missing/empty, it's stale
          const hasValidEpisodes = !data.hasEpisodeMarkers ||
            (data.episodes && Array.isArray(data.episodes) && data.episodes.length > 0);
          const isCacheValid = cacheAge < config.cacheDuration &&
            data.tracks && data.tracks.length > 0 && hasValidEpisodes;

          console.log(`🔍 Cache validation for ${config.title}:`, {
            cacheAge: Math.round(cacheAge / 1000) + 's',
            maxAge: Math.round(config.cacheDuration / 1000) + 's',
            trackCount: data.tracks.length,
            hasEpisodeMarkers: data.hasEpisodeMarkers,
            episodeCount: data.episodes?.length || 0,
            hasValidEpisodes,
            isValid: isCacheValid
          });

          if (isCacheValid) {
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

            // Load episode data from cache if available
            if (data.hasEpisodeMarkers && data.episodes && Array.isArray(data.episodes)) {
              // Validate episodes have required structure
              const validEpisodes = data.episodes.filter((e: Episode) =>
                e && e.id && Array.isArray(e.tracks)
              );
              if (validEpisodes.length > 0) {
                setHasEpisodeMarkers(true);
                setEpisodes(validEpisodes);
                console.log(`📺 Loaded ${validEpisodes.length} episodes from cache`);
                // Expand all episodes by default
                setExpandedEpisodes(new Set(validEpisodes.map((e: Episode) => e.id)));
              }
            }

            setLoading(false);
            setCacheStatus('cached');
            return true; // Cache was used
          } else {
            // Cache is expired or invalid, but don't immediately delete it
            // Keep it as a fallback and only delete after successful fresh fetch
            logger.info(`⏰ Cache expired for ${config.title}, will fetch fresh data but keep cache as fallback`);
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

        // Extract episode grouping data if available
        if (data.albums[0].hasEpisodeMarkers && data.albums[0].episodes && Array.isArray(data.albums[0].episodes)) {
          // Validate episodes have required structure
          const validEpisodes = data.albums[0].episodes.filter((e: Episode) =>
            e && e.id && Array.isArray(e.tracks)
          );
          if (validEpisodes.length > 0) {
            setHasEpisodeMarkers(true);
            setEpisodes(validEpisodes);
            console.log(`📺 Found ${validEpisodes.length} episodes in playlist`);
            // Expand all episodes by default
            setExpandedEpisodes(new Set(validEpisodes.map((e: Episode) => e.id)));
          }
        }
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

                // Extract episode grouping data if available in full data
                if (fullData.albums[0].hasEpisodeMarkers && fullData.albums[0].episodes && Array.isArray(fullData.albums[0].episodes)) {
                  // Validate episodes have required structure
                  const validEpisodes = fullData.albums[0].episodes.filter((e: Episode) =>
                    e && e.id && Array.isArray(e.tracks)
                  );
                  if (validEpisodes.length > 0) {
                    setHasEpisodeMarkers(true);
                    setEpisodes(validEpisodes);
                    console.log(`📺 Found ${validEpisodes.length} episodes in full playlist data`);
                    // Expand all episodes by default
                    setExpandedEpisodes(new Set(validEpisodes.map((e: Episode) => e.id)));
                  }
                }

                // Update playlist link if available in full data
                if (fullData.albums[0].link) {
                  setPlaylistLink(fullData.albums[0].link);
                }
                
                // Cache the full data using IndexedDB for large playlists
                const fullCacheData: CachedData = {
                  tracks: fullData.albums[0].tracks,
                  episodes: fullData.albums[0].episodes,
                  hasEpisodeMarkers: fullData.albums[0].hasEpisodeMarkers,
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
              // This is expected behavior - fallback to IndexedDB is working correctly
              // Only log in debug mode to reduce console noise
              if (process.env.NODE_ENV === 'development') {
                console.log(`ℹ️ localStorage quota exceeded, using IndexedDB fallback (expected behavior)`);
              }
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

  // Reset pagination when search changes
  useEffect(() => {
    setDisplayedCount(TRACKS_PER_PAGE);
  }, [searchQuery]);

  // Paginated tracks for display
  const displayedTracks = useMemo(() => {
    return filteredTracks.slice(0, displayedCount);
  }, [filteredTracks, displayedCount]);

  const hasMoreTracks = displayedCount < filteredTracks.length;
  const [loadingMore, setLoadingMore] = useState(false);

  // Episode toggle functions
  const toggleEpisode = useCallback((episodeId: string) => {
    setExpandedEpisodes(prev => {
      const next = new Set(prev);
      if (next.has(episodeId)) {
        next.delete(episodeId);
      } else {
        next.add(episodeId);
      }
      return next;
    });
  }, []);

  const expandAllEpisodes = useCallback(() => {
    setExpandedEpisodes(new Set(episodes.map(e => e.id)));
  }, [episodes]);

  const collapseAllEpisodes = useCallback(() => {
    setExpandedEpisodes(new Set());
  }, []);

  // Filtered episodes (for grouped view with search)
  const filteredEpisodes = useMemo(() => {
    if (!hasEpisodeMarkers || !episodes || episodes.length === 0) return [];

    return episodes
      .filter(episode => episode && Array.isArray(episode.tracks)) // Filter out malformed episodes
      .map(episode => {
        // Filter tracks within the episode based on search query
        const matchingTracks = (episode.tracks ?? []).filter(track => {
          if (!track) return false; // Skip undefined/null tracks
          if (!searchQuery) return true;
          const query = searchQuery.toLowerCase();
          return (
            track.title?.toLowerCase().includes(query) ||
            track.artist?.toLowerCase().includes(query) ||
            track.episodeTitle?.toLowerCase().includes(query)
          );
        });

        return {
          ...episode,
          tracks: matchingTracks,
          trackCount: matchingTracks.length
        };
      }); // Keep all episodes, including those with no tracks
  }, [episodes, hasEpisodeMarkers, searchQuery]);

  const loadMoreTracks = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setDisplayedCount(prev => Math.min(prev + TRACKS_PER_PAGE, filteredTracks.length));
    // Small delay to prevent rapid-fire loading
    setTimeout(() => setLoadingMore(false), 100);
  }, [filteredTracks.length, loadingMore]);

  // Infinite scroll - load more when sentinel comes into view
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMoreTracks || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          loadMoreTracks();
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMoreTracks, loadingMore]);

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
          artwork: t.image,
          // Preserve metadata for share links
          feedTitle: t.feedTitle,
          albumTitle: t.albumTitle
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

      const rawAudioUrl = track.valueForValue?.resolvedAudioUrl || track.audioUrl;
      const audioUrl = getProxiedAudioUrl(rawAudioUrl);
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
          if (playlistArtwork.includes('stablekraft.app') || playlistArtwork.startsWith('/')) {
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

        {/* Main Content - Two Column Layout */}
        <div className="container mx-auto px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Left Column - Playlist Info (2/5 width) */}
            <div className="flex flex-col gap-6 lg:col-span-2 lg:sticky lg:top-24 lg:self-start">
              {/* Artwork - responsive sizing like album page */}
              <div
                className="relative mx-auto lg:mx-0 w-[280px] h-[280px] lg:w-full lg:h-auto lg:aspect-square lg:max-w-[400px] bg-gray-900/60 backdrop-blur-sm rounded-lg overflow-hidden group cursor-pointer"
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
                      <div className="w-16 h-16 lg:w-20 lg:h-20 bg-white/95 hover:bg-white rounded-full flex items-center justify-center shadow-2xl transform group-hover:scale-110 transition-all duration-300">
                        <Play className="w-8 h-8 lg:w-10 lg:h-10 text-black ml-1" />
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

              {/* Info Card with glass background */}
              <div className="bg-black/50 backdrop-blur-sm rounded-lg p-6 lg:max-w-[400px]">
                {/* Title & Description */}
                <div className="text-center lg:text-left">
                  <h1 className="text-3xl md:text-4xl font-bold mb-2">
                    {config.title.includes('Top 100') ? (
                      <>
                        Top{' '}
                        <span className="relative inline-block mx-2">
                          <span className="line-through opacity-50">100</span>
                          <span
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-500 font-black -rotate-12 text-[2.5rem] md:text-[3rem]"
                            style={{
                              textShadow: '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 10px rgba(239, 68, 68, 0.7), 0 0 20px rgba(239, 68, 68, 0.5)',
                              WebkitTextStroke: '2px black'
                            }}
                          >
                            {tracks.length}
                          </span>
                        </span>
                        {' '}V4V Music
                      </>
                    ) : (
                      config.title
                    )}
                  </h1>
                  <p className="text-gray-300">{config.description}</p>
                </div>

                {/* Stats Row */}
                {stats && (
                  <div className="flex items-center justify-center lg:justify-start gap-4 text-sm text-gray-400 mt-4">
                    <span>{new Date().getFullYear()}</span>
                    <span>•</span>
                    <span>{stats.totalTracks} tracks</span>
                    <span>•</span>
                    <span>{formatDuration(stats.totalDuration)}</span>
                  </div>
                )}

                {/* Website Link */}
                {playlistLink && (
                  <div className="flex justify-center lg:justify-start mt-4">
                    <a
                      href={playlistLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors duration-200 text-white/80 hover:text-white"
                      title="Visit playlist website"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span className="text-sm font-medium">Website</span>
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Track List (3/5 width) */}
            <div className="lg:col-span-3">
              <div className="bg-black/40 backdrop-blur-sm rounded-lg p-4 md:p-6 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                {/* Search */}
                <div className="mb-4">
                  <div className="relative">
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
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold text-white">Tracks</h2>
                    <span className="text-sm text-gray-400">
                      {filteredTracks.length}
                    </span>
                  </div>

                  {/* Episode View Toggle */}
                  {hasEpisodeMarkers && episodes.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEpisodeViewMode('grouped')}
                        className={`p-1.5 rounded transition-colors ${
                          episodeViewMode === 'grouped'
                            ? 'bg-[#00ffd5] text-black'
                            : 'bg-white/10 text-gray-400 hover:bg-white/20'
                        }`}
                        title="Group by Episode"
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEpisodeViewMode('flat')}
                        className={`p-1.5 rounded transition-colors ${
                          episodeViewMode === 'flat'
                            ? 'bg-[#00ffd5] text-black'
                            : 'bg-white/10 text-gray-400 hover:bg-white/20'
                        }`}
                        title="All Tracks"
                      >
                        <List className="w-4 h-4" />
                      </button>
                      {episodeViewMode === 'grouped' && (
                        <>
                          <span className="text-gray-600 mx-1">|</span>
                          <button
                            onClick={expandAllEpisodes}
                            className="text-xs px-2 py-1 bg-white/20 hover:bg-white/30 text-white rounded transition-colors"
                          >
                            Expand All
                          </button>
                          <button
                            onClick={collapseAllEpisodes}
                            className="text-xs px-2 py-1 bg-white/20 hover:bg-white/30 text-white rounded transition-colors"
                          >
                            Collapse All
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Track List */}
                <div className="space-y-1">
                  {/* Grouped View with Episodes */}
                  {hasEpisodeMarkers && episodeViewMode === 'grouped' && filteredEpisodes.length > 0 ? (
                    <div className="space-y-2">
                      {filteredEpisodes.map((episode) => (
                        <EpisodeSection
                          key={episode.id}
                          episode={episode}
                          isExpanded={expandedEpisodes.has(episode.id)}
                          onToggle={() => toggleEpisode(episode.id)}
                          onPlayTrack={handlePlay}
                          currentTrackId={currentTrack || undefined}
                          isPlaying={shouldUseAudioContext ? audioContext?.isPlaying : !audio?.paused}
                          renderTrack={(track, trackIndex) => {
                            // Skip undefined tracks
                            if (!track || !track.id) return null;

                            // For grouped view, use track ID comparison
                            const isCurrentTrack = currentTrack === track.id;
                            const isLoading = audioLoading === track.id;

                            return (
                              <div
                                key={`${track.id}-${trackIndex}`}
                                className={`group flex flex-col gap-2 p-2 rounded-lg hover:bg-white/10 transition-colors ${
                                  isCurrentTrack ? 'bg-stablekraft-teal/20' : ''
                                }`}
                              >
                                {/* Row 1: Artwork + Track Info */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  {/* Track Artwork with Play Button Overlay */}
                                  {track.image ? (
                                    <div className="relative flex-shrink-0 w-10 h-10">
                                      <img
                                        src={getAlbumArtworkUrl(track.image, 'thumbnail', false)}
                                        alt={track.title}
                                        className="w-10 h-10 rounded object-cover"
                                        onError={(e) => {
                                          const target = e.target as HTMLImageElement;
                                          target.src = getPlaceholderImageUrl('thumbnail');
                                        }}
                                      />
                                      <button
                                        onClick={() => handlePlay(track)}
                                        disabled={isLoading}
                                        className={`absolute inset-0 flex items-center justify-center rounded bg-black/50 transition-opacity ${
                                          isCurrentTrack ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                        }`}
                                      >
                                        {isLoading ? (
                                          <Loader2 className="h-4 w-4 text-white animate-spin" />
                                        ) : isCurrentTrack && (shouldUseAudioContext ? audioContext?.isPlaying : !audio?.paused) ? (
                                          <Pause className="h-4 w-4 text-white" />
                                        ) : (
                                          <Play className="h-4 w-4 text-white" />
                                        )}
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="w-10 h-10 flex items-center justify-center">
                                      <button
                                        onClick={() => handlePlay(track)}
                                        disabled={isLoading}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center ${
                                          isCurrentTrack ? 'bg-stablekraft-teal text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
                                        }`}
                                      >
                                        {isLoading ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : isCurrentTrack && (shouldUseAudioContext ? audioContext?.isPlaying : !audio?.paused) ? (
                                          <Pause className="h-3 w-3" />
                                        ) : (
                                          <Play className="h-3 w-3" />
                                        )}
                                      </button>
                                    </div>
                                  )}

                                  {/* Track Info */}
                                  <div className="flex-1 min-w-0">
                                    <h3 className={`text-sm font-medium line-clamp-2 ${
                                      isCurrentTrack ? 'text-stablekraft-teal' : 'text-white'
                                    }`}>
                                      {track.valueForValue?.resolvedTitle || track.title}
                                    </h3>
                                    <p className="text-xs text-white/70 truncate">
                                      {track.valueForValue?.resolvedArtist || track.artist}
                                    </p>
                                  </div>
                                </div>

                                {/* Row 2: Duration & Action Buttons */}
                                <div className="flex items-center justify-end gap-2">
                                  {/* Duration */}
                                  <span className="text-xs text-white font-medium bg-black/40 px-1.5 py-0.5 rounded tabular-nums flex-shrink-0">
                                    {formatDuration(track.valueForValue?.resolvedDuration || track.duration)}
                                  </span>

                                  {/* Share Button */}
                                  {(track.albumTitle || track.feedTitle) && (
                                    <button
                                      className="flex-shrink-0 p-1.5 bg-black/40 hover:bg-purple-500/50 text-white rounded transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const albumTitle = track.albumTitle || track.feedTitle || '';
                                        const albumSlug = generateAlbumSlug(albumTitle);
                                        const albumUrl = `${window.location.origin}/album/${albumSlug}`;
                                        navigator.clipboard.writeText(albumUrl).then(() => {
                                          toast.success('Link copied!');
                                        }).catch(() => {
                                          toast.error('Failed to copy link');
                                        });
                                      }}
                                      title="Copy album link"
                                    >
                                      <Share2 className="w-4 h-4" />
                                    </button>
                                  )}

                                  {/* Favorite Button */}
                                  <div className="flex-shrink-0 bg-black/40 rounded">
                                    <FavoriteButton
                                      trackId={track.itemGuid || track.id}
                                      feedGuidForImport={track.feedGuid || track.valueForValue?.feedGuid}
                                      size={16}
                                      className="p-1.5"
                                    />
                                  </div>

                                  {/* Boost Button */}
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
                              </div>
                            );
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    /* Flat View - Original Track List */
                    <>
            {displayedTracks.map((track, index) => {
              const isCurrentTrack = shouldUseAudioContext ?
                (audioContext?.currentPlayingAlbum?.id === `${config.cacheKey}-playlist` && audioContext?.currentTrackIndex === index) :
                currentTrack === track.id;
              const isLoading = audioLoading === track.id;

              return (
                <div
                  key={`${track.id}-${index}`}
                  className={`group flex flex-col lg:flex-row lg:items-center gap-2 p-2 rounded-lg hover:bg-white/10 transition-colors ${
                    isCurrentTrack ? 'bg-stablekraft-teal/20' : ''
                  }`}
                >
                  {/* Row 1: Artwork + Track Info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Track Artwork with Play Button Overlay */}
                    {track.image ? (
                      <div className="relative flex-shrink-0 w-12 h-12">
                        <img
                          src={getAlbumArtworkUrl(track.image, 'thumbnail', false)}
                          alt={track.title}
                          className="w-12 h-12 rounded object-cover"
                          onError={(e) => {
                            // Fallback to placeholder if image fails to load
                            const target = e.target as HTMLImageElement;
                            target.src = getPlaceholderImageUrl('thumbnail');
                          }}
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
                      <div className="w-12 h-12 flex items-center justify-center">
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
                      <h3 className={`text-sm font-medium line-clamp-2 lg:line-clamp-1 lg:truncate ${
                        isCurrentTrack ? 'text-stablekraft-teal' : 'text-white'
                      }`}>
                        {track.valueForValue?.resolvedTitle || track.title}
                      </h3>
                      <p className="text-xs text-white/70 truncate">
                        {track.valueForValue?.resolvedArtist || track.artist}
                      </p>
                    </div>
                  </div>

                  {/* Row 2: Duration & Action Buttons - inline on desktop */}
                  <div className="flex items-center justify-end gap-2 lg:flex-shrink-0">
                    {/* Duration & V4V Badge */}
                    <div className="flex items-center gap-2">
                      {track.valueForValue?.resolved && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">
                          V4V
                        </span>
                      )}
                      <span className="text-xs text-white/70 tabular-nums">
                        {formatDuration(track.valueForValue?.resolvedDuration || track.duration)}
                      </span>
                    </div>

                    {/* Share Button - copies link to track's album page */}
                    {(track.albumTitle || track.feedTitle) && (
                      <button
                        className="flex-shrink-0 p-1 text-white/70 hover:text-purple-400 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          const albumTitle = track.albumTitle || track.feedTitle || '';
                          const albumSlug = generateAlbumSlug(albumTitle);
                          const albumUrl = `${window.location.origin}/album/${albumSlug}`;
                          navigator.clipboard.writeText(albumUrl).then(() => {
                            toast.success('Link copied!');
                          }).catch(() => {
                            toast.error('Failed to copy link');
                          });
                        }}
                        title="Copy album link"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                    )}

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
                </div>
              );
                })}
                    </>
                  )}
                </div>

                {/* Infinite scroll sentinel */}
                {hasMoreTracks && (
                  <div ref={loadMoreRef} className="py-6 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-stablekraft-teal" />
                    <p className="text-xs text-gray-500 mt-2">
                      Loading more... ({displayedCount} of {filteredTracks.length})
                    </p>
                  </div>
                )}

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
      </div>
    </div>
    </AppLayout>
  );
}
