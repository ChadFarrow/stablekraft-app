'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { getSessionId } from '@/lib/session-utils';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl } from '@/lib/url-utils';
import LoadingSpinner from '@/components/LoadingSpinner';
import AlbumCard from '@/components/AlbumCard';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { Heart, Music, Disc } from 'lucide-react';

interface FavoriteTrack {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  image: string | null;
  audioUrl: string;
  duration: number | null;
  favoritedAt: string;
  Feed?: {
    title: string;
    artist: string | null;
    image: string | null;
    id: string;
  };
}

interface FavoriteAlbum {
  id: string;
  title: string;
  description: string | null;
  artist: string | null;
  image: string | null;
  type: string;
  favoritedAt: string;
  Track?: Array<{
    id: string;
    title: string;
    artist: string | null;
    duration: number | null;
    image: string | null;
  }>;
}

export default function FavoritesPage() {
  const { sessionId, isLoading: sessionLoading } = useSession();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();
  const [activeTab, setActiveTab] = useState<'albums' | 'tracks'>('albums');
  const [favoriteAlbums, setFavoriteAlbums] = useState<FavoriteAlbum[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionLoading || nostrLoading) return;

    // If Nostr authenticated, use user ID; otherwise use session ID
    if (isNostrAuthenticated && nostrUser) {
      loadFavorites(null, nostrUser.id);
    } else {
      const currentSessionId = sessionId || getSessionId();
      if (!currentSessionId) {
        setLoading(false);
        return;
      }
      loadFavorites(currentSessionId, null);
    }
  }, [sessionId, sessionLoading, isNostrAuthenticated, nostrUser, nostrLoading]);

  const loadFavorites = async (sessionId: string | null, userId: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = {};
      if (userId) {
        headers['x-nostr-user-id'] = userId;
      } else if (sessionId) {
        headers['x-session-id'] = sessionId;
      } else {
        setLoading(false);
        return;
      }

      const [albumsResponse, tracksResponse] = await Promise.all([
        fetch('/api/favorites/albums', {
          headers
        }),
        fetch('/api/favorites/tracks', {
          headers
        })
      ]);

      if (!albumsResponse.ok || !tracksResponse.ok) {
        throw new Error('Failed to load favorites');
      }

      const albumsData = await albumsResponse.json();
      const tracksData = await tracksResponse.json();

      if (albumsData.success) {
        setFavoriteAlbums(albumsData.data || []);
      }

      if (tracksData.success) {
        setFavoriteTracks(tracksData.data || []);
      }
    } catch (err) {
      console.error('Error loading favorites:', err);
      setError(err instanceof Error ? err.message : 'Failed to load favorites');
    } finally {
      setLoading(false);
    }
  };

  const handleFavoriteToggle = () => {
    // Reload favorites when a favorite is toggled
    if (isNostrAuthenticated && nostrUser) {
      loadFavorites(null, nostrUser.id);
    } else {
      const currentSessionId = sessionId || getSessionId();
      if (currentSessionId) {
        loadFavorites(currentSessionId, null);
      }
    }
  };

  if (sessionLoading || nostrLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <LoadingSpinner size="large" text="Loading favorites..." />
      </div>
    );
  }

  // Check if we have either a session or Nostr user
  const hasSession = sessionId || getSessionId();
  const hasUser = isNostrAuthenticated && nostrUser;

  if (!hasSession && !hasUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="text-center">
          <Heart className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h1 className="text-2xl font-bold mb-2">No Session Found</h1>
          <p className="text-gray-400 mb-4">Unable to load favorites. Please sign in or refresh the page.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
            <Heart className="w-10 h-10 text-red-500 fill-red-500" />
            My Favorites
          </h1>
          <p className="text-gray-400">Your favorite tracks and albums</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('albums')}
            className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'albums'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Disc className="w-5 h-5" />
            Albums ({favoriteAlbums.length})
          </button>
          <button
            onClick={() => setActiveTab('tracks')}
            className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'tracks'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Music className="w-5 h-5" />
            Tracks ({favoriteTracks.length})
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* Albums Tab */}
        {activeTab === 'albums' && (
          <div>
            {favoriteAlbums.length === 0 ? (
              <div className="text-center py-12">
                <Disc className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h2 className="text-2xl font-bold mb-2">No Favorite Albums</h2>
                <p className="text-gray-400 mb-4">Start favoriting albums to see them here!</p>
                <Link
                  href="/"
                  className="inline-block px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
                >
                  Browse Albums
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {favoriteAlbums.map((album) => {
                  const albumForCard = {
                    id: album.id,
                    title: album.title,
                    artist: album.artist || 'Unknown Artist',
                    description: album.description || '',
                    coverArt: album.image || '',
                    releaseDate: album.favoritedAt,
                    tracks: (album.Track || []).map(track => ({
                      title: track.title,
                      artist: track.artist || undefined,
                      duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
                      url: '',
                      id: track.id
                    })),
                    feedId: album.id,
                    type: album.type
                  };

                  return (
                    <AlbumCard
                      key={album.id}
                      album={albumForCard}
                      onPlay={async () => {}}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tracks Tab */}
        {activeTab === 'tracks' && (
          <div>
            {favoriteTracks.length === 0 ? (
              <div className="text-center py-12">
                <Music className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h2 className="text-2xl font-bold mb-2">No Favorite Tracks</h2>
                <p className="text-gray-400 mb-4">Start favoriting tracks to see them here!</p>
                <Link
                  href="/"
                  className="inline-block px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
                >
                  Browse Tracks
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {favoriteTracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all border border-white/10"
                  >
                    <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                      <Image
                        src={getAlbumArtworkUrl(track.image || track.Feed?.image || '', 'thumbnail')}
                        alt={track.title}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = getPlaceholderImageUrl('thumbnail');
                        }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate">{track.title}</h3>
                      <p className="text-gray-400 text-sm truncate">
                        {track.artist || track.Feed?.artist || 'Unknown Artist'}
                      </p>
                      {track.album && (
                        <p className="text-gray-500 text-xs truncate">from {track.album}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      {track.duration && (
                        <span className="text-gray-400 text-sm">
                          {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                        </span>
                      )}
                      <FavoriteButton
                        trackId={track.id}
                        onToggle={handleFavoriteToggle}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

