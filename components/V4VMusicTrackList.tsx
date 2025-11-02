'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ExtendedTrack } from '@/lib/track-adapter';
import V4VMusicTrackCard from './V4VMusicTrackCard';
import LoadingSpinner from './LoadingSpinner';
import { 
  Search, 
  Filter, 
  ChevronDown, 
  X, 
  Zap, 
  RefreshCw,
  Download,
  Database,
  TrendingUp,
  Clock,
  Calendar
} from 'lucide-react';

interface V4VMusicTrackListProps {
  initialFeedUrls?: string[];
  onPlayTrack?: (track: ExtendedTrack) => void;
  showDatabaseStats?: boolean;
  autoExtract?: boolean;
}

type SortOption = 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc' | 'v4v-first';
type FilterSource = 'all' | 'chapter' | 'value-split' | 'description' | 'external-feed' | 'v4v-data';

interface DatabaseStats {
  totalSegments: number;
  totalEpisodes: number;
  totalFeeds: number;
  totalExtractions: number;
  segmentsWithV4V: number;
  segmentsBySource: Record<string, number>;
  recentSegments: number;
}

export default function V4VMusicTrackList({ 
  initialFeedUrls = [], 
  onPlayTrack,
  showDatabaseStats = true,
  autoExtract = false
}: V4VMusicTrackListProps) {
  const router = useRouter();
  const [tracks, setTracks] = useState<ExtendedTrack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterEpisode, setFilterEpisode] = useState<string>('all');
  const [filterFeed, setFilterFeed] = useState<string>('all');
  const [filterV4V, setFilterV4V] = useState<boolean | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalTracks, setTotalTracks] = useState(0);
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const itemsPerPage = 20;

  // Default feed URLs if none provided
  const defaultFeedUrls = [
    'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
    // Add more V4V-enabled feeds here as they become available
  ];

  const feedUrls = initialFeedUrls.length > 0 ? initialFeedUrls : defaultFeedUrls;

  // Load music tracks from database
  const loadMusicTracks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Build query parameters
      const params = new URLSearchParams();
      params.append('page', currentPage.toString());
      params.append('pageSize', itemsPerPage.toString());
      
      if (searchQuery) params.append('title', searchQuery);
      if (filterSource !== 'all') params.append('source', filterSource);
      if (filterEpisode !== 'all') params.append('episodeId', filterEpisode);
      if (filterFeed !== 'all') params.append('feedId', filterFeed);
      if (filterV4V !== null) params.append('hasV4VData', filterV4V.toString());

      const response = await fetch(`/api/music-tracks/database?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to load tracks: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setTracks(data.data?.tracks || []);
        setTotalPages(data.data?.pagination?.totalPages || 1);
        setTotalTracks(data.data?.pagination?.total || 0);
        setDatabaseStats(data.data?.statistics || null);
      } else {
        throw new Error(data.error || 'Failed to load tracks');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load music tracks');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchQuery, filterSource, filterEpisode, filterFeed, filterV4V, itemsPerPage]);

  // Extract tracks from feeds and store in database
  const extractAndStoreTracks = useCallback(async () => {
    setIsExtracting(true);
    setError(null);
    
    try {
      const response = await fetch('/api/music-tracks/database', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'extractAndStore',
          data: { feedUrls }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to extract tracks: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.success) {
        console.log('✅ Successfully extracted and stored tracks:', data.summary);
        // Reload tracks after extraction
        await loadMusicTracks();
      } else {
        throw new Error(data.error || 'Failed to extract tracks');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract tracks');
    } finally {
      setIsExtracting(false);
    }
  }, [feedUrls, loadMusicTracks]);

  useEffect(() => {
    loadMusicTracks();
  }, [loadMusicTracks, currentPage, searchQuery, filterSource, filterEpisode, filterFeed, filterV4V]);

  // Auto-extract on mount if enabled
  useEffect(() => {
    if (autoExtract && tracks.length === 0) {
      extractAndStoreTracks();
    }
  }, [autoExtract, tracks.length, extractAndStoreTracks]);

  // Get unique episodes and feeds for filters
  const uniqueEpisodes = useMemo(() => {
    const episodes = new Set(tracks.filter(t => t && t.episodeTitle).map(t => t.episodeTitle));
    return Array.from(episodes).sort();
  }, [tracks]);

  const uniqueFeeds = useMemo(() => {
    const feeds = new Set(tracks.filter(t => t && t.feedId).map(t => t.feedId));
    return Array.from(feeds).sort();
  }, [tracks]);

  const handleViewTrackDetails = (track: ExtendedTrack) => {
    router.push(`/music-tracks/${track.id}`);
  };

  const handleFavorite = (track: ExtendedTrack) => {
    // TODO: Implement favorite functionality
    console.log('Favorite track:', track.id);
  };

  const handleShare = (track: ExtendedTrack) => {
    // TODO: Implement share functionality
    console.log('Share track:', track.id);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setFilterSource('all');
    setFilterEpisode('all');
    setFilterFeed('all');
    setFilterV4V(null);
    setCurrentPage(1);
  };

  const hasActiveFilters = searchQuery || filterSource !== 'all' || filterEpisode !== 'all' || 
                          filterFeed !== 'all' || filterV4V !== null;

  return (
    <div className="space-y-6">
      {/* Database Statistics */}
      {showDatabaseStats && databaseStats && (
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Database className="w-5 h-5" />
              Database Statistics
            </h3>
            <button
              onClick={loadMusicTracks}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Refresh stats"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{databaseStats.totalSegments}</div>
              <div className="text-xs text-gray-400">Total Segments</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{databaseStats.segmentsWithV4V}</div>
              <div className="text-xs text-gray-400">V4V Segments</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-400">{databaseStats.totalEpisodes}</div>
              <div className="text-xs text-gray-400">Episodes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-400">{databaseStats.totalFeeds}</div>
              <div className="text-xs text-gray-400">Feeds</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">{databaseStats.recentSegments}</div>
              <div className="text-xs text-gray-400">Recent (7d)</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400">{databaseStats.totalExtractions}</div>
              <div className="text-xs text-gray-400">Extractions</div>
            </div>
          </div>

          {/* Source breakdown */}
          <div className="mt-4 pt-4 border-t border-white/10">
            <h4 className="text-sm font-medium mb-2">Segments by Source</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(databaseStats.segmentsBySource).map(([source, count]) => (
                <div key={source} className="flex items-center gap-1 px-2 py-1 bg-white/10 rounded text-xs">
                  <span className="capitalize">{source}</span>
                  <span className="text-gray-400">({count})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filters
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-2 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={extractAndStoreTracks}
            disabled={isExtracting}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors"
          >
            {isExtracting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isExtracting ? 'Extracting...' : 'Extract & Store'}
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tracks..."
                  className="w-full pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Source Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">Source</label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Sources</option>
                <option value="chapter">Chapters</option>
                <option value="value-split">Value Splits</option>
                <option value="description">Description</option>
                <option value="external-feed">External Feed</option>
                <option value="v4v-data">V4V Data</option>
              </select>
            </div>

            {/* V4V Filter */}
            <div>
              <label className="block text-sm font-medium mb-2">V4V Status</label>
              <select
                value={filterV4V === null ? 'all' : filterV4V.toString()}
                onChange={(e) => {
                  const value = e.target.value;
                  setFilterV4V(value === 'all' ? null : value === 'true');
                }}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Tracks</option>
                <option value="true">V4V Only</option>
                <option value="false">Non-V4V Only</option>
              </select>
            </div>

            {/* Sort */}
            <div>
              <label className="block text-sm font-medium mb-2">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="date-desc">Newest First</option>
                <option value="date-asc">Oldest First</option>
                <option value="title-asc">Title A-Z</option>
                <option value="title-desc">Title Z-A</option>
                <option value="artist-asc">Artist A-Z</option>
                <option value="artist-desc">Artist Z-A</option>
                <option value="v4v-first">V4V First</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Results Summary */}
      <div className="flex items-center justify-between text-sm text-gray-400">
        <div>
          Showing {tracks.length} of {totalTracks} tracks
          {hasActiveFilters && ' (filtered)'}
        </div>
        <div className="flex items-center gap-4">
          {filterV4V === true && (
            <span className="flex items-center gap-1 text-green-400">
              <Zap className="w-4 h-4" />
              V4V Only
            </span>
          )}
          {databaseStats && databaseStats.segmentsWithV4V !== undefined && (
            <span className="flex items-center gap-1">
              <Database className="w-4 h-4" />
              {databaseStats.segmentsWithV4V} V4V segments
            </span>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <LoadingSpinner />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="text-red-300 font-medium">Error loading segments</div>
          <div className="text-red-400 text-sm mt-1">{error}</div>
          <button
            onClick={loadMusicTracks}
            className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Segments Grid */}
      {!isLoading && !error && (
        <>
          {tracks.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">No segments found</div>
              {hasActiveFilters ? (
                <button
                  onClick={resetFilters}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  Clear Filters
                </button>
              ) : (
                <button
                  onClick={extractAndStoreTracks}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  Extract Segments from Feeds
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tracks.filter(track => track && track.id).map((track) => (
                <V4VMusicTrackCard
                  key={track.id}
                  track={track}
                  onPlay={onPlayTrack}
                  onViewDetails={handleViewTrackDetails}
                  onFavorite={handleFavorite}
                  onShare={handleShare}
                  showV4VBadge={true}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:text-gray-500 rounded-lg transition-colors"
              >
                Previous
              </button>
              
              <span className="px-4 py-2 text-sm">
                Page {currentPage} of {totalPages}
              </span>
              
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:text-gray-500 rounded-lg transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
} 