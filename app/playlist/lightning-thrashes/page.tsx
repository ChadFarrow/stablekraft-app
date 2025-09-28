'use client';

import { useState, useEffect } from 'react';
import { Play, Pause, Music, Search, Filter, ChevronDown, X, Loader2, AlertCircle, Info, ExternalLink } from 'lucide-react';

interface Track {
  id: string;
  title: string;
  artist: string;
  episodeTitle: string;
  audioUrl: string;
  startTime: number;
  endTime: number;
  duration: number;
  source: string;
  image?: string;
  feedGuid?: string;
  itemGuid?: string;
  resolved?: boolean;
  loading?: boolean;
}

interface PlaylistData {
  title: string;
  description: string;
  author: string;
  image: string;
  tracks: Track[];
  guid: string;
  medium: string;
}

export default function LightningThrashesPlaylistPage() {
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadPlaylist();
  }, []);

  const loadPlaylist = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Parse the Lightning Thrashes playlist XML
      const response = await fetch('/001-to-060-lightning-thrashes-playlist.xml');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      
      // Extract channel info
      const channel = xmlDoc.querySelector('channel');
      if (!channel) {
        throw new Error('Invalid playlist format');
      }
      
      const title = channel.querySelector('title')?.textContent || 'Lightning Thrashes Playlist';
      const description = channel.querySelector('description')?.textContent || '';
      const author = channel.querySelector('author')?.textContent || 'Kolomona Myer AKA Sir Libre';
      const image = channel.querySelector('image url')?.textContent || '';
      const guid = channel.querySelector('podcast\\:guid')?.textContent || '';
      const medium = channel.querySelector('podcast\\:medium')?.textContent || 'musicL';
      
      // Extract remote items (tracks)
      const remoteItems = Array.from(channel.querySelectorAll('podcast\\:remoteItem'));
      
      const tracks: Track[] = remoteItems.map((item, index) => {
        const feedGuid = item.getAttribute('feedGuid') || '';
        const itemGuid = item.getAttribute('itemGuid') || '';
        
        return {
          id: `${feedGuid}-${itemGuid}`,
          title: `Track ${index + 1}`, // We don't have individual track titles in remoteItem
          artist: 'Various Artists',
          episodeTitle: 'Lightning Thrashes',
          audioUrl: '', // remoteItem doesn't contain direct audio URLs
          startTime: 0,
          endTime: 180, // Default 3 minutes
          duration: 180,
          source: 'remote-item',
          feedGuid,
          itemGuid,
          resolved: false
        };
      });
      
      setPlaylist({
        title,
        description,
        author,
        image,
        tracks,
        guid,
        medium
      });
      
      setLoading(false);
    } catch (error) {
      console.error('Failed to load playlist:', error);
      setError(error instanceof Error ? error.message : 'Failed to load playlist');
      setLoading(false);
    }
  };

  const filteredTracks = playlist?.tracks.filter(track => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      track.title.toLowerCase().includes(query) ||
      track.artist.toLowerCase().includes(query) ||
      track.feedGuid?.toLowerCase().includes(query) ||
      track.itemGuid?.toLowerCase().includes(query)
    );
  }) || [];

  const playTrack = async (track: Track) => {
    // For now, just show track details since remoteItems don't have direct audio URLs
    setSelectedTrack(track);
  };

  const stopTrack = () => {
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setCurrentTrack(null);
    setAudio(null);
    setAudioLoading(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-green-400 mx-auto mb-4 animate-spin" />
              <p className="text-xl">Loading Lightning Thrashes playlist...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-red-300 font-semibold mb-1">Error Loading Playlist</p>
                <p className="text-gray-300">{error}</p>
                <button 
                  onClick={loadPlaylist}
                  className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center">
            <p className="text-xl">No playlist data found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <div className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">{playlist.title}</h1>
              <p className="text-gray-400 mb-2">{playlist.description}</p>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-400">by {playlist.author}</span>
                <span className="text-gray-500">•</span>
                <span className="text-gray-400">Podcasting 2.0 {playlist.medium} playlist</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={stopTrack}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm"
              >
                Stop All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-gray-800/30 border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-green-400">{playlist.tracks.length}</div>
              <div className="text-gray-400">Remote Items</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">{new Set(playlist.tracks.map(t => t.feedGuid)).size}</div>
              <div className="text-gray-400">Unique Feeds</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-purple-400">{playlist.medium}</div>
              <div className="text-gray-400">Playlist Type</div>
            </div>
          </div>
        </div>
      </div>

      {/* Info Panel */}
      <div className="bg-blue-900/20 border-b border-blue-500/20">
        <div className="max-w-6xl mx-auto px-8 py-4">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-blue-300 font-semibold mb-1">About Remote Items</p>
              <p className="text-gray-300">
                This playlist contains {playlist.tracks.length} remote music references from various podcasts. 
                Each item references external music feeds using Podcasting 2.0 remote item tags. 
                To play these tracks, you would need access to the referenced podcast feeds.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="max-w-6xl mx-auto px-8 py-6">
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by track, feed GUID, or item GUID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Track List Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Remote Items</h2>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>{filteredTracks.length} of {playlist.tracks.length} items</span>
          </div>
        </div>

        {/* Track List */}
        <div className="space-y-2">
          {filteredTracks.map((track, index) => (
            <div
              key={track.id}
              className="flex items-center gap-4 p-3 rounded-lg bg-gray-700/50 hover:bg-gray-700 transition-colors"
            >
              <button 
                className="flex-shrink-0 w-10 h-10 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center transition-colors"
                onClick={() => playTrack(track)}
              >
                <Info className="w-4 h-4" />
              </button>

              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => playTrack(track)}>
                <div className="font-medium truncate">{track.title}</div>
                <div className="text-sm text-gray-400 truncate">
                  Feed: {track.feedGuid}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  Item: {track.itemGuid}
                </div>
              </div>

              <div className="flex-shrink-0">
                <span className="px-2 py-1 rounded text-xs bg-purple-600/20 text-purple-400">
                  remote-item
                </span>
              </div>

              <button
                onClick={() => setSelectedTrack(track)}
                className="flex-shrink-0 p-1 text-gray-400 hover:text-white"
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {filteredTracks.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Music className="w-12 h-12 mx-auto mb-4" />
            <p>No items match your search</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm"
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>

      {/* Track Details Modal */}
      {selectedTrack && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Remote Item Details</h3>
              <button
                onClick={() => setSelectedTrack(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-400">Title</label>
                <p className="font-medium">{selectedTrack.title}</p>
              </div>
              
              <div>
                <label className="text-sm text-gray-400">Feed GUID</label>
                <p className="font-mono text-sm break-all">{selectedTrack.feedGuid}</p>
              </div>
              
              <div>
                <label className="text-sm text-gray-400">Item GUID</label>
                <p className="font-mono text-sm break-all">{selectedTrack.itemGuid}</p>
              </div>
              
              <div>
                <label className="text-sm text-gray-400">Type</label>
                <span className="px-2 py-1 rounded text-xs bg-purple-600/20 text-purple-400">
                  {selectedTrack.source}
                </span>
              </div>
              
              <div className="text-xs text-gray-400 mt-4">
                <p>This is a Podcasting 2.0 remote item reference. To play this track, you would need to resolve the feedGuid and itemGuid to find the actual audio content.</p>
              </div>
              
              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => setSelectedTrack(null)}
                  className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}