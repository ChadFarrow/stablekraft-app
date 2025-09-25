'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

interface PlaylistItem {
  id: string;
  title: string;
  description: string;
  trackCount: number;
  episodes: string;
  href: string;
  type: 'web' | 'rss';
  color: string;
  medium?: 'musicL' | 'podcast';
}

// Static playlists - RSS feeds that are musicL compliant
const staticPlaylists: PlaylistItem[] = [
  {
    id: 'upbeats',
    title: 'Upbeats Playlist',
    description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
    trackCount: 495,
    episodes: '554 remote items',
    href: '/playlist/upbeats',
    type: 'rss',
    color: 'bg-green-600',
    medium: 'musicL'
  },
  {
    id: 'b4ts',
    title: 'Behind the Sch3m3s Music Playlist',
    description: 'Curated playlist from Behind the Sch3m3s podcast featuring Value4Value independent artists',
    trackCount: 565,
    episodes: '565 remote items',
    href: '/playlist/b4ts',
    type: 'rss',
    color: 'bg-orange-600',
    medium: 'musicL'
  },
  {
    id: 'itdv-rss',
    title: 'ITDV RSS Feed',
    description: 'Podcasting 2.0 compliant RSS feed for music discovery',
    trackCount: 200,
    episodes: 'Episodes 31-56',
    href: '/playlist/itdv-rss',
    type: 'rss',
    color: 'bg-blue-600',
    medium: 'musicL'
  },
  {
    id: 'hgh',
    title: 'Homegrown Hits Music Playlist',
    description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
    trackCount: 841,
    episodes: '841 remote items',
    href: '/playlist/hgh',
    type: 'rss',
    color: 'bg-purple-600',
    medium: 'musicL'
  }
];

function PlaylistContent() {
  const [playlists, setPlaylists] = useState<PlaylistItem[]>(staticPlaylists);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/playlists');
      if (!response.ok) throw new Error('Failed to load playlists');
      
      const data = await response.json();
      
      // Transform database playlists to display format
      const dbPlaylists: PlaylistItem[] = data.data.map((playlist: any) => ({
        id: playlist.id,
        title: playlist.name,
        description: playlist.description,
        trackCount: playlist.trackCount || 0,
        episodes: 'Podcasting 2.0 musicL',
        href: `/playlist/${playlist.id}`,
        type: 'web' as const,
        color: getColorForPlaylist(playlist.id),
        medium: 'musicL' as const
      }));
      
      // Combine database playlists with static RSS feeds
      setPlaylists([...dbPlaylists, ...staticPlaylists]);
    } catch (error) {
      console.error('Error loading playlists:', error);
      // Fallback to static playlists
      setPlaylists(staticPlaylists);
    } finally {
      setIsLoading(false);
    }
  };

  const getColorForPlaylist = (id: string): string => {
    const colors = {
      'itdv': 'bg-blue-600',
      'hgh': 'bg-purple-600',
      'lightning-thrashes': 'bg-red-600',
      'top100-music': 'bg-yellow-600',
      'upbeats': 'bg-green-600'
    };
    return colors[id as keyof typeof colors] || 'bg-gray-600';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-xl">Loading playlists...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Music Playlists</h1>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Discover and enjoy music from various podcasts and creators. 
            Choose between web players and RSS feeds for your preferred listening experience.
          </p>
        </div>

        {/* Playlist Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="bg-gray-800 rounded-lg p-6 hover:bg-gray-700 transition-colors border border-gray-700"
            >
              {/* Type Badge */}
              <div className="flex justify-between items-start mb-4">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  playlist.type === 'rss' 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {playlist.type === 'rss' ? '📡 RSS Feed' : '🌐 Web Player'}
                  {playlist.medium === 'musicL' && ' 🎵'}
                </span>
                <div className={`w-3 h-3 rounded-full ${playlist.color}`}></div>
              </div>

              {/* Title and Description */}
              <h3 className="text-xl font-bold mb-2">{playlist.title}</h3>
              <p className="text-gray-300 text-sm mb-4">{playlist.description}</p>

              {/* Stats */}
              <div className="flex justify-between text-sm text-gray-400 mb-6">
                <span>{playlist.trackCount} tracks</span>
                <span>{playlist.episodes}</span>
              </div>

              {/* Action Button */}
              <Link
                href={playlist.href}
                className={`block w-full text-center py-3 px-4 rounded-lg font-medium transition-colors ${
                  playlist.type === 'rss'
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {playlist.type === 'rss' ? '📥 Get RSS Feed' : '🎵 Open Player'}
              </Link>
            </div>
          ))}
        </div>

        {/* Podcasting 2.0 musicL Information */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-2xl font-bold mb-4">About Podcasting 2.0 musicL Playlists</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-gray-300 mb-2">What is musicL?</h3>
              <p className="text-sm text-gray-400 mb-4">
                musicL is a Podcasting 2.0 specification for music playlists. These playlists are 
                compatible with Podcasting 2.0 apps and support Value4Value payments for artists.
              </p>
              <h3 className="font-semibold text-gray-300 mb-2">Compatible Apps:</h3>
              <ul className="text-sm text-gray-400 space-y-1">
                <li>• Fountain</li>
                <li>• Podverse</li>
                <li>• Breez</li>
                <li>• Any Podcasting 2.0 app</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-300 mb-2">musicL Features:</h3>
              <ul className="text-sm text-gray-400 space-y-1">
                <li>• Podcasting 2.0 compliant</li>
                <li>• Value4Value (V4V) support</li>
                <li>• Cross-feed references</li>
                <li>• Music track metadata</li>
                <li>• Direct artist payments</li>
                <li>• Offline listening</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Quick Actions</h2>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/playlist/upbeats"
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🎵 Open Upbeats Player
            </Link>
            <Link
              href="/playlist/b4ts"
              className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🎵 Open B4TS Player
            </Link>
            <a
              href="/api/playlist/itdv-rss"
              download="ITDV-playlist.xml"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              📥 Download ITDV RSS
            </a>
            <Link
              href="/playlist/itdv"
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🎵 Open ITDV Player
            </Link>
            <Link
              href="/playlist/hgh"
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🎵 Open HGH Player
            </Link>
            <Link
              href="/playlist/maker"
              className="bg-pink-600 hover:bg-pink-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              🛠️ Open Playlist Maker
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlaylistIndexPage() {
  return <PlaylistContent />;
} 