'use client';

import { useState, useEffect, useMemo } from 'react';
import { Play, Pause, Music, Search, Filter, ChevronDown, X, Loader2, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useAudio } from '@/contexts/AudioContext';
import { logger } from '@/lib/logger';
import { getProxiedAudioUrl } from '@/lib/audio-url-utils';
import type { Track, SortOption, FilterSource, ViewMode, CacheStatus, CachedData, PlaylistConfig, PlaylistStats } from '@/types/playlist';
import { BoostButton } from '@/components/Lightning/BoostButton';

interface PlaylistTemplateProps {
  config: PlaylistConfig;
}

export default function PlaylistTemplate({ config }: PlaylistTemplateProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [stats, setStats] = useState<PlaylistStats | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [error, setError] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>(null);
  const [playQueue, setPlayQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [continuousPlay, setContinuousPlay] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Search and filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('episode-desc');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterEpisode, setFilterEpisode] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Always call the hook, but only use it if enabled
  const audioContext = useAudio();
  const shouldUseAudioContext = config.useAudioContext;

  // Load cached data on component mount
  useEffect(() => {
    logger.info(`🚀 ${config.title} Playlist component mounted`);

    const loadCachedData = () => {
      try {
        const cached = localStorage.getItem(config.cacheKey);
        if (cached) {
          const data: CachedData = JSON.parse(cached);
          const now = Date.now();

          // Check if cache has resolved V4V data
          const hasResolvedData = data.tracks.some(track =>
            track.valueForValue?.resolved === true && (
              track.valueForValue?.resolvedAudioUrl || track.valueForValue?.resolvedArtist
            )
          );

          // Check if cache is still valid AND has resolved V4V data
          if (now - data.timestamp < config.cacheDuration && hasResolvedData) {
            logger.info('📦 Loading tracks from cache with resolved V4V data');
            setTracks(data.tracks);
            setLoading(false);
            setCacheStatus('cached');
            return true; // Cache was used
          } else {
            if (!hasResolvedData) {
              logger.info('🔄 Cache missing V4V resolved data, will fetch fresh data');
            } else {
              logger.info('⏰ Cache expired, will fetch fresh data');
            }
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
    try {
      setLoading(true);
      setError(null);
      logger.info(`🔄 Loading tracks for ${config.title}...`);

      const response = await fetch(config.apiEndpoint);
      if (!response.ok) {
        throw new Error(`Failed to load tracks: ${response.status}`);
      }

      const data = await response.json();
      const tracksData = data.tracks || [];

      logger.info(`✅ Loaded ${tracksData.length} tracks for ${config.title}`);
      setTracks(tracksData);
      setCacheStatus('fresh');

      // Cache the data
      const cacheData: CachedData = {
        tracks: tracksData,
        timestamp: Date.now(),
        feedUrl: config.feedUrl || ''
      };
      localStorage.setItem(config.cacheKey, JSON.stringify(cacheData));

      setLastUpdated(new Date().toLocaleString());
    } catch (error) {
      logger.error(`❌ Error loading ${config.title} tracks:`, error);
      setError(error instanceof Error ? error.message : 'Failed to load tracks');
    } finally {
      setLoading(false);
    }
  };

  // Get unique episodes for filtering
  const episodes = useMemo(() => {
    const episodeSet = new Set(tracks.map(track => track.episodeTitle));
    return Array.from(episodeSet).sort();
  }, [tracks]);

  // Filter and sort tracks
  const filteredTracks = useMemo(() => {
    let filtered = tracks;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(track =>
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query) ||
        track.episodeTitle.toLowerCase().includes(query)
      );
    }

    // Apply source filter
    if (filterSource !== 'all') {
      filtered = filtered.filter(track => track.source === filterSource);
    }

    // Apply episode filter
    if (filterEpisode !== 'all') {
      filtered = filtered.filter(track => track.episodeTitle === filterEpisode);
    }

    // Apply view mode filter
    if (viewMode === 'main') {
      filtered = filtered.filter(track => track.source === 'chapter' || track.source === 'value-split');
    }

    // Sort tracks
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'episode-desc':
          return b.episodeTitle.localeCompare(a.episodeTitle);
        case 'episode-asc':
          return a.episodeTitle.localeCompare(b.episodeTitle);
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
  }, [tracks, searchQuery, filterSource, filterEpisode, viewMode, sortBy]);

  // Calculate stats
  const calculatedStats = useMemo(() => {
    const stats: PlaylistStats = {
      totalTracks: tracks.length,
      totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
      resolvedTracks: tracks.filter(track => track.valueForValue?.resolved).length,
      episodes: new Set(tracks.map(track => track.episodeTitle)).size,
      sources: {}
    };

    tracks.forEach(track => {
      stats.sources[track.source] = (stats.sources[track.source] || 0) + 1;
    });

    return stats;
  }, [tracks]);

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
        duration: track.valueForValue?.resolvedDuration || track.duration,
        artwork: track.image || '/placeholder-album.jpg'
      };

      const albumData = {
        id: `${config.cacheKey}-playlist`,
        title: config.title,
        artist: 'Various Artists',
        year: new Date().getFullYear().toString(),
        coverArt: '/placeholder-album.jpg',
        description: config.description,
        releaseDate: new Date().toISOString(),
        tracks: filteredTracks.map(t => ({
          id: t.id,
          title: t.valueForValue?.resolvedTitle || t.title,
          artist: t.valueForValue?.resolvedArtist || t.artist,
          audioUrl: t.valueForValue?.resolvedAudioUrl || t.audioUrl,
          duration: formatDuration(t.valueForValue?.resolvedDuration || t.duration),
          artwork: t.image || '/placeholder-album.jpg'
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

      newAudio.addEventListener('ended', () => {
        if (continuousPlay) {
          playNext();
        } else {
          setCurrentTrack(null);
        }
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

  const playNext = () => {
    const currentIndex = filteredTracks.findIndex(track => track.id === currentTrack);
    if (currentIndex < filteredTracks.length - 1) {
      const nextTrack = filteredTracks[currentIndex + 1];
      handlePlay(nextTrack);
    }
  };

  const playPrevious = () => {
    const currentIndex = filteredTracks.findIndex(track => track.id === currentTrack);
    if (currentIndex > 0) {
      const prevTrack = filteredTracks[currentIndex - 1];
      handlePlay(prevTrack);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getSourceColor = (source: string): string => {
    switch (source) {
      case 'chapter': return 'bg-blue-100 text-blue-800';
      case 'value-split': return 'bg-green-100 text-green-800';
      case 'description': return 'bg-yellow-100 text-yellow-800';
      case 'external-feed': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-600" />
          <p className="text-gray-600">Loading {config.title} playlist...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Playlist</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Music className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{config.title}</h1>
                <p className="text-sm text-gray-500">{config.description}</p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {cacheStatus && (
                <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                  cacheStatus === 'cached' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                }`}>
                  {cacheStatus === 'cached' ? '📦 Cached' : '🔄 Fresh'}
                </div>
              )}

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setViewMode(viewMode === 'main' ? 'complete' : 'main')}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    viewMode === 'main'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {viewMode === 'main' ? 'Main Tracks' : 'All Tracks'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{filteredTracks.length}</p>
                <p className="text-sm text-gray-500">Tracks</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.episodes}</p>
                <p className="text-sm text-gray-500">Episodes</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{formatDuration(stats.totalDuration)}</p>
                <p className="text-sm text-gray-500">Total Duration</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-gray-900">{stats.resolvedTracks}</p>
                <p className="text-sm text-gray-500">V4V Resolved</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            {/* Search */}
            <div className="relative flex-1 max-w-lg">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search tracks, artists, or episodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Sort */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sort by</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="episode-desc">Episode (Newest)</option>
                    <option value="episode-asc">Episode (Oldest)</option>
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="artist-asc">Artist (A-Z)</option>
                    <option value="artist-desc">Artist (Z-A)</option>
                    <option value="time-asc">Time in Episode</option>
                  </select>
                </div>

                {/* Source Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="all">All Sources</option>
                    <option value="chapter">Chapters</option>
                    <option value="value-split">Value Splits</option>
                    <option value="description">Descriptions</option>
                    <option value="external-feed">External Feeds</option>
                  </select>
                </div>

                {/* Episode Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Episode</label>
                  <select
                    value={filterEpisode}
                    onChange={(e) => setFilterEpisode(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  >
                    <option value="all">All Episodes</option>
                    {episodes.map((episode) => (
                      <option key={episode} value={episode}>{episode}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Clear Filters */}
              {(searchQuery || filterSource !== 'all' || filterEpisode !== 'all' || sortBy !== 'episode-desc') && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilterSource('all');
                      setFilterEpisode('all');
                      setSortBy('episode-desc');
                    }}
                    className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    <X className="h-4 w-4" />
                    <span>Clear all filters</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Track List */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-lg shadow">
          <div className="divide-y divide-gray-200">
            {filteredTracks.map((track, index) => {
              const isCurrentTrack = shouldUseAudioContext ?
                (audioContext?.currentPlayingAlbum?.id === `${config.cacheKey}-playlist` && audioContext?.currentTrackIndex === index) :
                currentTrack === track.id;
              const isLoading = audioLoading === track.id;

              return (
                <div
                  key={track.id}
                  className={`p-4 hover:bg-gray-50 transition-colors ${
                    isCurrentTrack ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center space-x-4">
                    {/* Play Button */}
                    <button
                      onClick={() => handlePlay(track)}
                      disabled={isLoading}
                      className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                        isCurrentTrack
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
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

                    {/* Track Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-900 truncate">
                            {track.valueForValue?.resolvedTitle || track.title}
                          </h3>
                          <p className="text-sm text-gray-500 truncate">
                            {track.valueForValue?.resolvedArtist || track.artist}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {track.episodeTitle}
                          </p>
                        </div>

                        <div className="flex items-center space-x-2 ml-4">
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
                          {/* Source Badge */}
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getSourceColor(track.source)}`}>
                            {track.source}
                          </span>

                          {/* V4V Badge */}
                          {track.valueForValue?.resolved && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              V4V
                            </span>
                          )}

                          {/* Duration */}
                          <span className="text-xs text-gray-500">
                            {formatDuration(track.valueForValue?.resolvedDuration || track.duration)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredTracks.length === 0 && (
            <div className="p-8 text-center">
              <Music className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No tracks found</h3>
              <p className="text-gray-500">
                {searchQuery || filterSource !== 'all' || filterEpisode !== 'all'
                  ? 'Try adjusting your search or filters'
                  : 'No tracks available in this playlist'
                }
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer Info */}
      {lastUpdated && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center text-sm text-gray-500">
            Last updated: {lastUpdated}
          </div>
        </div>
      )}
    </div>
  );
}