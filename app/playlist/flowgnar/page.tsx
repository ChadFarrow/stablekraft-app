'use client';

import { useEffect, useState } from 'react';
import PlaylistTemplate from '@/components/PlaylistTemplate';

interface Track {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  duration: number;
  image?: string;
}

interface Playlist {
  id: string;
  name: string;
  description: string;
  image?: string;
  tracks: Track[];
}

export default function FlowgnarPlaylistPage() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFlowgnarPlaylist();
  }, []);

  const loadFlowgnarPlaylist = async () => {
    try {
      setLoading(true);
      
      // Load Flowgnar playlist and tracks from dedicated API
      const response = await fetch('/api/playlist/flowgnar');
      if (!response.ok) throw new Error('Failed to load Flowgnar playlist');
      
      const data = await response.json();
      
      setPlaylist({
        id: data.data.playlist.id,
        name: data.data.playlist.name,
        description: data.data.playlist.description,
        image: data.data.playlist.image,
        tracks: []
      });
      
      setTracks(data.data.tracks);
      
    } catch (error) {
      console.error('Error loading Flowgnar playlist:', error);
      setError(error instanceof Error ? error.message : 'Failed to load playlist');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-xl">Loading Flowgnar Playlist...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Error Loading Playlist</h1>
          <p className="text-gray-300">{error}</p>
        </div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-yellow-400 mb-4">Playlist Not Found</h1>
          <p className="text-gray-300">The Flowgnar playlist could not be found.</p>
        </div>
      </div>
    );
  }

  const config = {
    cacheKey: 'flowgnar-playlist',
    cacheDuration: 5 * 60 * 1000, // 5 minutes
    apiEndpoint: '/api/playlist/flowgnar',
    title: playlist.name,
    description: playlist.description,
    coverArt: playlist.image || 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist-art.webp',
    color: 'teal',
    source: 'database',
    playlistId: playlist.id
  };

  return (
    <PlaylistTemplate
      config={config}
    />
  );
}