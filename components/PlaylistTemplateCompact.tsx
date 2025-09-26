'use client';

import { useState, useEffect, useMemo } from 'react';
import { Play, Pause, Search, ChevronLeft, Loader2, AlertCircle, Info } from 'lucide-react';
import { useAudio } from '@/contexts/AudioContext';
import { logger } from '@/lib/logger';
import Link from 'next/link';
import type { Track, SortOption, FilterSource, ViewMode, CacheStatus, CachedData, PlaylistConfig, PlaylistStats } from '@/types/playlist';

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

  // Search and filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('episode-desc');

  // Always call the hook, but only use it if enabled
  const audioContext = useAudio();
  const shouldUseAudioContext = config.useAudioContext;

  // Load cached data on component mount
  useEffect(() => {
    logger.info(`🚀 ${config.title} Playlist component mounted`);

    const loadCachedData = () => {
      try {
        const cached = localStorage.getItem(config.cacheKey);
        if (cached && cached !== null) {
          const data: CachedData = JSON.parse(cached as string);
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
            localStorage.removeItem(config.cacheKey);
          }
        }
        return false; // Cache was not used
      } catch (error) {
        logger.error('❌ Error loading cached data:', error);
        localStorage.removeItem(config.cacheKey);
        return false;
      }
    };

    const cacheUsed = loadCachedData();
    if (!cacheUsed) {
      loadTracks();
    }
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
      let tracksData = [];
      let artworkUrl = null;
      if (data.tracks) {
        // Direct tracks format (like /api/itdv-resolved-songs)
        tracksData = data.tracks;
        console.log(`🔍 Direct tracks format: ${tracksData.length} tracks`);
      } else if (data.albums && data.albums[0] && data.albums[0].tracks) {
        // Album format (like /api/playlist/itdv)
        tracksData = data.albums[0].tracks;
        artworkUrl = data.albums[0].coverArt || data.albums[0].image || data.playlist?.artwork;
        console.log(`🔍 Album format: ${tracksData.length} tracks from album "${data.albums[0].title}"`);
        console.log(`🎨 Playlist artwork URL:`, artworkUrl);
      } else {
        console.log(`🚨 Unknown API format:`, Object.keys(data));
        tracksData = [];
      }

      // Store playlist artwork
      if (artworkUrl) {
        setPlaylistArtwork(artworkUrl);
      }

      logger.info(`✅ Loaded ${tracksData.length} tracks for ${config.title}`);
      console.log(`🔍 First track sample:`, tracksData[0]);
      setTracks(tracksData);
      setCacheStatus('fresh');

      // Cache the data
      const cacheData: CachedData = {
        tracks: tracksData,
        timestamp: Date.now(),
        feedUrl: config.feedUrl || ''
      };
      localStorage.setItem(config.cacheKey, JSON.stringify(cacheData));

    } catch (error) {
      console.log(`🚨 Error in loadTracks for ${config.title}:`, error);
      logger.error(`❌ Error loading ${config.title} tracks:`, error);
      setError(error instanceof Error ? error.message : 'Failed to load tracks');
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

    // Sort tracks
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
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
    <div className="min-h-screen text-white relative overflow-hidden">
      {/* Background layer - similar to album pages */}
      <div 
        className="fixed inset-0"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0, 
          bottom: 0,
          zIndex: 1,
          ...(playlistArtwork ? {
            backgroundImage: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url('${playlistArtwork}')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed'
          } : {
            background: 'linear-gradient(to bottom right, rgb(17, 24, 39), rgb(31, 41, 55), rgb(17, 24, 39))'
          })
        }}
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
              className="w-48 h-48 bg-gray-800/50 rounded-lg flex-shrink-0 overflow-hidden relative group cursor-pointer transform transition-transform hover:scale-105"
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
              <h1 className="text-4xl font-bold mb-2">{config.title}</h1>
              <p className="text-gray-400 mb-4">{config.description}</p>
              {stats && (
                <div className="flex flex-wrap gap-4 text-sm text-gray-400">
                  <span>{new Date().getFullYear()}</span>
                  <span>•</span>
                  <span>{stats.totalTracks} tracks</span>
                  <span>•</span>
                  <span>{formatDuration(stats.totalDuration)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="mb-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search tracks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal text-white placeholder-gray-400"
              />
            </div>
          </div>

          {/* Tracks Header */}
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              Tracks
              <span className="text-sm text-gray-400 bg-gray-800/50 px-2 py-1 rounded">
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
                  className={`group flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors ${
                    isCurrentTrack ? 'bg-stablekraft-teal/10' : ''
                  }`}
                >
                  {/* Track Number / Play Button */}
                  <div className="w-8 flex items-center justify-center">
                    <button
                      onClick={() => handlePlay(track)}
                      disabled={isLoading}
                      className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100 ${
                        isCurrentTrack ? 'opacity-100' : ''
                      } ${
                        isCurrentTrack
                          ? 'bg-stablekraft-teal text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-white'
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
                    <span className={`text-sm text-gray-400 group-hover:opacity-0 transition-opacity ${
                      isCurrentTrack ? 'opacity-0' : ''
                    }`}>
                      {index + 1}
                    </span>
                  </div>

                  {/* Track Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className={`text-sm font-medium truncate ${
                          isCurrentTrack ? 'text-stablekraft-teal' : 'text-white'
                        }`}>
                          {track.valueForValue?.resolvedTitle || track.title}
                        </h3>
                        <p className="text-xs text-gray-400 truncate">
                          {track.valueForValue?.resolvedArtist || track.artist}
                        </p>
                      </div>

                      {/* Duration */}
                      <div className="flex items-center gap-2 ml-4">
                        {track.valueForValue?.resolved && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-400 border border-green-800">
                            V4V
                          </span>
                        )}
                        <span className="text-xs text-gray-400 tabular-nums">
                          {formatDuration(track.valueForValue?.resolvedDuration || track.duration)}
                        </span>
                      </div>
                    </div>
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
  );
}
