'use client';

import React, { useState, useEffect } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import type { V4VValue } from '@/lib/v4v-utils';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Search,
  Music,
  Zap,
  Filter,
  X
} from 'lucide-react';

interface Track {
  id: string;
  title: string;
  subtitle?: string;
  artist?: string;
  album?: string;
  audioUrl: string;
  duration?: number;
  image?: string;
  explicit: boolean;
  v4vValue?: V4VValue | null;
  feed?: {
    title: string;
    artist?: string;
    type: string;
  };
}

interface SearchFilters {
  type?: string;
  artist?: string;
  album?: string;
  hasV4V?: boolean;
  explicit?: boolean;
}

export default function DatabaseMusicPlayer() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const { 
    playTrack, 
    pause, 
    resume, 
    isPlaying, 
    currentTime, 
    duration,
    seek
  } = useAudio();

  // Fetch tracks from database
  const fetchTracks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50'
      });
      
      if (searchQuery) params.append('search', searchQuery);
      if (filters.type) params.append('type', filters.type);
      if (filters.artist) params.append('artist', filters.artist);
      if (filters.album) params.append('album', filters.album);
      if (filters.hasV4V) params.append('hasV4V', 'true');
      if (filters.explicit !== undefined) params.append('explicit', filters.explicit.toString());
      
      const response = await fetch(`/api/tracks?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setTracks(data.tracks || []);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch (error) {
      console.error('Error fetching tracks:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracks();
  }, [page, searchQuery, filters]);

  // Handle track play
  const handlePlayTrack = async (track: Track) => {
    if (currentTrack?.id === track.id && isPlaying) {
      pause();
    } else if (currentTrack?.id === track.id && !isPlaying) {
      resume();
    } else {
      setCurrentTrack(track);
      const success = await playTrack(track.audioUrl);
      if (!success) {
        console.error('Failed to play track');
      }
    }
  };

  // Handle search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchTracks();
  };

  // Format duration
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Get unique artists and albums for filters
  const [uniqueArtists, setUniqueArtists] = useState<string[]>([]);
  const [uniqueAlbums, setUniqueAlbums] = useState<string[]>([]);
  
  useEffect(() => {
    // Fetch unique values for filters
    const fetchFilterOptions = async () => {
      try {
        const response = await fetch('/api/tracks/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '', pagination: { page: 1, limit: 0 } })
        });
        const data = await response.json();
        if (data.facets) {
          setUniqueArtists(data.facets.artists?.map((a: { value: string }) => a.value) || []);
          setUniqueAlbums(data.facets.albums?.map((a: { value: string }) => a.value) || []);
        }
      } catch (error) {
        console.error('Error fetching filter options:', error);
      }
    };
    fetchFilterOptions();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Music Library</h1>
        <p className="text-gray-400">Stream from your database-driven collection</p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for tracks, artists, or albums..."
            className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
          />
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
          >
            <Filter className="w-5 h-5" />
          </button>
        </div>
      </form>

      {/* Filters */}
      {showFilters && (
        <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Filters</h3>
            <button
              onClick={() => {
                setFilters({});
                setShowFilters(false);
              }}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Type</label>
              <select
                value={filters.type || ''}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded focus:outline-none focus:border-green-400"
              >
                <option value="">All</option>
                <option value="music">Music</option>
                <option value="podcast">Podcast</option>
                <option value="v4v">V4V Enabled</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Artist</label>
              <select
                value={filters.artist || ''}
                onChange={(e) => setFilters({ ...filters, artist: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded focus:outline-none focus:border-green-400"
              >
                <option value="">All Artists</option>
                {uniqueArtists.map(artist => (
                  <option key={artist} value={artist}>{artist}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Album</label>
              <select
                value={filters.album || ''}
                onChange={(e) => setFilters({ ...filters, album: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded focus:outline-none focus:border-green-400"
              >
                <option value="">All Albums</option>
                {uniqueAlbums.map(album => (
                  <option key={album} value={album}>{album}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Options</label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.hasV4V || false}
                    onChange={(e) => setFilters({ ...filters, hasV4V: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm">V4V Only</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.explicit === false}
                    onChange={(e) => setFilters({ ...filters, explicit: e.target.checked ? false : undefined })}
                    className="mr-2"
                  />
                  <span className="text-sm">Hide Explicit</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Current Playing Track */}
      {currentTrack && (
        <div className="mb-6 p-4 bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-white/10 rounded-lg">
          <div className="flex items-center gap-4">
            {currentTrack.image && (
              <img 
                src={currentTrack.image} 
                alt={currentTrack.title}
                className="w-20 h-20 rounded-lg object-cover"
              />
            )}
            <div className="flex-1">
              <h3 className="text-lg font-semibold">{currentTrack.title}</h3>
              <p className="text-gray-400">
                {currentTrack.artist || currentTrack.feed?.artist || 'Unknown Artist'}
              </p>
              {currentTrack.album && (
                <p className="text-sm text-gray-500">{currentTrack.album}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePlayTrack(currentTrack)}
                className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
              >
                {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{formatDuration(currentTime)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
            <div 
              className="h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer"
              onClick={(e) => {
                if (duration) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percentage = x / rect.width;
                  seek(percentage * duration);
                }
              }}
            >
              <div 
                className="h-full bg-gradient-to-r from-green-400 to-blue-400"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Track List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
          <p className="mt-4 text-gray-400">Loading tracks...</p>
        </div>
      ) : tracks.length === 0 ? (
        <div className="text-center py-12">
          <Music className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-400">No tracks found</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {tracks.map((track) => (
              <div
                key={track.id}
                className={`p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors cursor-pointer ${
                  currentTrack?.id === track.id ? 'ring-2 ring-green-400' : ''
                }`}
                onClick={() => handlePlayTrack(track)}
              >
                <div className="flex items-center gap-4">
                  {track.image ? (
                    <img 
                      src={track.image} 
                      alt={track.title}
                      className="w-12 h-12 rounded object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-white/10 rounded flex items-center justify-center">
                      <Music className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium truncate">{track.title}</h4>
                      {track.explicit && (
                        <span className="px-1 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">E</span>
                      )}
                      {track.v4vValue && (
                        <Zap className="w-4 h-4 text-yellow-400" />
                      )}
                    </div>
                    <p className="text-sm text-gray-400 truncate">
                      {track.artist || track.feed?.artist || 'Unknown Artist'}
                      {track.album && ` • ${track.album}`}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-400">
                      {formatDuration(track.duration)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayTrack(track);
                      }}
                      className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                    >
                      {currentTrack?.id === track.id && isPlaying ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
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