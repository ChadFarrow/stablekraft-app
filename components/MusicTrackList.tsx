'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MusicTrack } from '@/lib/music-track-parser';
import MusicTrackCard from './MusicTrackCard';
import LoadingSpinner from './LoadingSpinner';
import { Search, Filter, ChevronDown, X } from 'lucide-react';

interface MusicTrackListProps {
  initialFeedUrls?: string[];
  onPlayTrack?: (track: MusicTrack) => void;
  selectable?: boolean;
  onToggleSelect?: (track: MusicTrack, selected: boolean) => void;
  selectedIds?: Set<string>;
}

type SortOption = 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc';
type FilterSource = 'all' | 'chapter' | 'value-split' | 'description' | 'external-feed';

export default function MusicTrackList({ initialFeedUrls = [], onPlayTrack, selectable = false, onToggleSelect, selectedIds }: MusicTrackListProps) {
  const router = useRouter();
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true); // Start with loading true to prevent hydration mismatch
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false); // Track if we're on client side
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date-desc');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [filterEpisode, setFilterEpisode] = useState<string>('all');
  const [filterFeed, setFilterFeed] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Default feed URLs if none provided
  const defaultFeedUrls = [
    'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
    'http://localhost:3000/001-to-060-lightning-thrashes-playlist.xml'
  ];

  const feedUrls = initialFeedUrls.length > 0 ? initialFeedUrls : defaultFeedUrls;

  // Load music tracks with fallback to local data
  const loadMusicTracks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const allTracks: MusicTrack[] = [];
      let successfulFeeds = 0;
      
      // Load tracks from each feed
      const loadPromises = feedUrls.map(async (feedUrl) => {
        try {
          console.log(`🔄 Loading tracks from: ${feedUrl}`);
          const response = await fetch(`/api/music-tracks?feedUrl=${encodeURIComponent(feedUrl)}`);
          
          if (!response.ok) {
            console.warn(`⚠️ Failed to load tracks from ${feedUrl} (${response.status})`);
            return { tracks: [], success: false, feedUrl };
          }
          
          const data = await response.json();
          
          if (data.success && data.data.tracks) {
            console.log(`✅ Loaded ${data.data.tracks.length} tracks from ${feedUrl}`);
            successfulFeeds++;
            return { tracks: data.data.tracks, success: true, feedUrl };
          }
          return { tracks: [], success: false, feedUrl };
        } catch (err) {
          console.warn(`❌ Error loading ${feedUrl}:`, err);
          return { tracks: [], success: false, feedUrl };
        }
      });

      // Wait for all feeds to load (or fail)
      const results = await Promise.all(loadPromises);
      
      // Flatten all tracks
      for (const result of results) {
        allTracks.push(...result.tracks);
      }
      
      // If no tracks loaded from external feeds, try local database
      if (allTracks.length === 0) {
        console.log('🔄 No tracks from external feeds, trying local database...');
        try {
          const localResponse = await fetch('/api/music-tracks/database');
          if (localResponse.ok) {
            const localData = await localResponse.json();
            if (localData.success && localData.data.tracks) {
              console.log(`✅ Loaded ${localData.data.tracks.length} tracks from local database`);
              setTracks(localData.data.tracks);
              setError(null);
              return;
            }
          }
        } catch (localErr) {
          console.warn('❌ Failed to load local database:', localErr);
        }
        
        throw new Error(`No tracks found. ${successfulFeeds}/${feedUrls.length} feeds loaded successfully.`);
      }
      
      setTracks(allTracks);
      if (successfulFeeds < feedUrls.length) {
        setError(`Partial success: ${successfulFeeds}/${feedUrls.length} feeds loaded. Some feeds may be unavailable.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load music tracks');
    } finally {
      setIsLoading(false);
    }
  }, [feedUrls]);

  useEffect(() => {
    // Set client flag and load tracks only on client side
    setIsClient(true);
    loadMusicTracks();
  }, []);

  // Get unique episodes and feeds for filters
  const uniqueEpisodes = useMemo(() => {
    const episodes = new Set(tracks.map(t => t.episodeTitle));
    return Array.from(episodes).sort();
  }, [tracks]);

  const uniqueFeeds = useMemo(() => {
    const feeds = new Set(tracks.map(t => t.feedUrl));
    return Array.from(feeds).sort();
  }, [tracks]);

  // Filter and sort tracks
  const filteredAndSortedTracks = useMemo(() => {
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

    // Apply feed filter
    if (filterFeed !== 'all') {
      filtered = filtered.filter(track => track.feedUrl === filterFeed);
    }

    // Sort tracks
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return new Date(b.episodeDate).getTime() - new Date(a.episodeDate).getTime();
        case 'date-asc':
          return new Date(a.episodeDate).getTime() - new Date(b.episodeDate).getTime();
        case 'title-asc':
          return a.title.localeCompare(b.title);
        case 'title-desc':
          return b.title.localeCompare(a.title);
        case 'artist-asc':
          return a.artist.localeCompare(b.artist);
        case 'artist-desc':
          return b.artist.localeCompare(a.artist);
        default:
          return 0;
      }
    });

    return sorted;
  }, [tracks, searchQuery, sortBy, filterSource, filterEpisode, filterFeed]);

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedTracks.length / itemsPerPage);
  const paginatedTracks = filteredAndSortedTracks.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterSource, filterEpisode, filterFeed, sortBy]);

  const handleViewTrackDetails = (track: MusicTrack) => {
    router.push(`/music-tracks/${track.id}`);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setFilterSource('all');
    setFilterEpisode('all');
    setFilterFeed('all');
    setSortBy('date-desc');
  };

  if (!isClient || isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
        <span className="ml-3 text-gray-400">Loading music tracks...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="max-w-md mx-auto">
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-red-400 mb-2 font-medium">⚠️ Loading Error</p>
            <p className="text-gray-400 text-sm">{error}</p>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={loadMusicTracks}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              🔄 Try Again
            </button>
            <button
              onClick={() => {
                // Force load from local database only
                const localFeedUrls: string[] = [];
                const originalUrls = feedUrls;
                feedUrls.splice(0, feedUrls.length, ...localFeedUrls);
                loadMusicTracks();
                // Restore original URLs after loading
                setTimeout(() => {
                  feedUrls.splice(0, feedUrls.length, ...originalUrls);
                }, 100);
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              📁 Use Local Data
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">Music Tracks</h2>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>{filteredAndSortedTracks.length} tracks</span>
          {filteredAndSortedTracks.length !== tracks.length && (
            <>
              <span>•</span>
              <span>{tracks.length} total</span>
            </>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tracks, artists, or episodes..."
            className="w-full pl-10 pr-4 py-3 rounded-lg bg-white/10 border border-white/20 focus:border-blue-500 focus:outline-none placeholder-gray-500"
          />
        </div>

        {/* Filter and Sort Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filters
            {(filterSource !== 'all' || filterEpisode !== 'all' || filterFeed !== 'all') && (
              <span className="px-2 py-0.5 text-xs bg-blue-500 rounded-full">
                {[filterSource !== 'all', filterEpisode !== 'all', filterFeed !== 'all'].filter(Boolean).length}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="px-4 py-2 rounded-lg bg-white/10 border border-white/20 focus:border-blue-500 focus:outline-none"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="title-asc">Title A-Z</option>
            <option value="title-desc">Title Z-A</option>
            <option value="artist-asc">Artist A-Z</option>
            <option value="artist-desc">Artist Z-A</option>
          </select>

          {(searchQuery || filterSource !== 'all' || filterEpisode !== 'all' || filterFeed !== 'all') && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
              Clear all
            </button>
          )}
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg bg-white/5 border border-white/10">
            <div>
              <label className="block text-sm font-medium mb-2">Source Type</label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as FilterSource)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Sources</option>
                <option value="chapter">Chapters</option>
                <option value="value-split">Value Splits</option>
                <option value="description">Description</option>
                <option value="external-feed">External Feed</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Episode</label>
              <select
                value={filterEpisode}
                onChange={(e) => setFilterEpisode(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Episodes</option>
                {uniqueEpisodes.map(episode => (
                  <option key={episode} value={episode}>
                    {episode}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Feed</label>
              <select
                value={filterFeed}
                onChange={(e) => setFilterFeed(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Feeds</option>
                {uniqueFeeds.map(feed => (
                  <option key={feed} value={feed}>
                    {new URL(feed).hostname}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Track List */}
      {paginatedTracks.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedTracks.map((track) => {
              const isSelected = selectedIds?.has(track.id) ?? false;
              return (
                <MusicTrackCard
                  key={track.id}
                  track={track}
                  onPlay={onPlayTrack}
                  onViewDetails={handleViewTrackDetails}
                  selected={isSelected}
                  actions={selectable && onToggleSelect ? (
                    <label className="inline-flex items-center gap-2 text-xs text-gray-300">
                      <input
                        type="checkbox"
                        className="accent-blue-500"
                        checked={isSelected}
                        onChange={(e) => onToggleSelect(track, e.target.checked)}
                      />
                      Add
                    </label>
                  ) : null}
                />
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              
              <div className="flex items-center gap-1">
                {[...Array(Math.min(5, totalPages))].map((_, i) => {
                  let pageNumber;
                  if (totalPages <= 5) {
                    pageNumber = i + 1;
                  } else if (currentPage <= 3) {
                    pageNumber = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNumber = totalPages - 4 + i;
                  } else {
                    pageNumber = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={i}
                      onClick={() => setCurrentPage(pageNumber)}
                      className={`px-3 py-1 rounded-lg transition-colors ${
                        currentPage === pageNumber
                          ? 'bg-blue-600 text-white'
                          : 'bg-white/10 hover:bg-white/20'
                      }`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <p>No tracks found matching your criteria.</p>
          {(searchQuery || filterSource !== 'all' || filterEpisode !== 'all' || filterFeed !== 'all') && (
            <button
              onClick={resetFilters}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}