'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { useAudio } from '@/contexts/AudioContext';
import { getSessionId } from '@/lib/session-utils';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl, generateAlbumSlug } from '@/lib/url-utils';
import { RSSAlbum } from '@/lib/rss-parser';
import LoadingSpinner from '@/components/LoadingSpinner';
import AlbumCard from '@/components/AlbumCard';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { Heart, Music, Disc, Users, Play } from 'lucide-react';
import { toast } from '@/components/Toast';

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
  const { playAlbum: globalPlayAlbum, playTrack, setFullscreenMode } = useAudio();
  const [activeTab, setActiveTab] = useState<'albums' | 'tracks' | 'publishers'>('albums');
  const [favoriteAlbums, setFavoriteAlbums] = useState<FavoriteAlbum[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [favoritePublishers, setFavoritePublishers] = useState<FavoriteAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackSortBy, setTrackSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc'>('date-desc');

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
        const allAlbums = albumsData.data || [];
        // Separate publishers from regular albums
        // Publishers have type === 'publisher', everything else is an album
        const albums = allAlbums.filter((album: any) => album.type !== 'publisher');
        const publishers = allAlbums.filter((album: any) => album.type === 'publisher');
        
        // Sort albums by artist, then by title
        albums.sort((a: any, b: any) => {
          const artistA = (a.artist || 'Unknown Artist').toLowerCase();
          const artistB = (b.artist || 'Unknown Artist').toLowerCase();
          
          // First sort by artist
          if (artistA !== artistB) {
            return artistA.localeCompare(artistB);
          }
          
          // If same artist, sort by title
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();
          return titleA.localeCompare(titleB);
        });
        
        setFavoriteAlbums(albums);
        setFavoritePublishers(publishers);
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

  const handlePlayAlbum = async (album: any, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      console.log('🎵 Attempting to play album from favorites:', album.title, album.id, 'feedId:', album.feedId);
      
      // If we have original album data with tracks, try using that first
      if (album.originalAlbum && album.originalAlbum.Track && album.originalAlbum.Track.length > 0) {
        const tracks = album.originalAlbum.Track.filter((track: any) => track.audioUrl);
        if (tracks.length > 0) {
          console.log('✅ Using tracks from original album data');
          const rssAlbum: RSSAlbum = {
            id: album.originalAlbum.id,
            title: album.originalAlbum.title,
            artist: album.originalAlbum.artist || 'Unknown Artist',
            description: album.originalAlbum.description || '',
            coverArt: album.originalAlbum.image || '',
            releaseDate: album.originalAlbum.favoritedAt,
            tracks: tracks.map((track: any, index: number) => ({
              title: track.title,
              duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
              url: track.audioUrl || '',
              trackNumber: index + 1,
              subtitle: track.subtitle || '',
              summary: track.description || track.summary || '',
              image: track.image || album.originalAlbum.image || '',
              explicit: track.explicit || false,
              keywords: track.keywords || [],
              v4vRecipient: track.v4vRecipient,
              v4vValue: track.v4vValue,
              guid: track.guid,
              id: track.id,
              startTime: track.startTime,
              endTime: track.endTime
            })),
            link: '',
            feedUrl: ''
          };
          
          console.log('🎵 Attempting to play RSSAlbum from original data:', rssAlbum.title, 'with', rssAlbum.tracks.length, 'tracks');
          const success = await globalPlayAlbum(rssAlbum, 0);
          if (success) {
            console.log('✅ Successfully started playback');
            // Open the fullscreen Now Playing screen
            setFullscreenMode(true);
            return;
          }
        }
      }
      
      // Try multiple methods to fetch album data
      let albumData: any = null;
      let response: Response | null = null;
      
      // Method 1: Try by slug (most common)
      const slug = generateAlbumSlug(album.title);
      console.log('🔍 Trying to fetch by slug:', slug);
      response = await fetch(`/api/albums/${encodeURIComponent(slug)}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.album && data.album.tracks && data.album.tracks.length > 0) {
          albumData = data.album;
          console.log('✅ Found album by slug');
        }
      }
      
      // Method 2: If slug failed and we have an ID, try by ID
      if (!albumData && album.id) {
        console.log('🔍 Trying to fetch by ID:', album.id);
        response = await fetch(`/api/albums/${encodeURIComponent(album.id)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.album && data.album.tracks && data.album.tracks.length > 0) {
            albumData = data.album;
            console.log('✅ Found album by ID');
          }
        }
      }
      
      // Method 3: If we have feedId, try using that
      if (!albumData && album.feedId) {
        console.log('🔍 Trying to fetch by feedId:', album.feedId);
        // Try to get album from feed
        const feedResponse = await fetch(`/api/feeds/${album.feedId}`);
        if (feedResponse.ok) {
          const feedData = await feedResponse.json();
          if (feedData.feed) {
            // Construct album from feed data
            const feed = feedData.feed;
            if (feed.Track && feed.Track.length > 0) {
              albumData = {
                id: feed.id,
                title: feed.title,
                artist: feed.artist || 'Unknown Artist',
                description: feed.description || '',
                coverArt: feed.image || '',
                releaseDate: feed.lastFetched || feed.createdAt,
                tracks: feed.Track.map((track: any, index: number) => ({
                  title: track.title,
                  duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
                  url: track.audioUrl || track.url || '',
                  trackNumber: index + 1,
                  subtitle: track.subtitle || '',
                  summary: track.description || track.summary || '',
                  image: track.image || feed.image || '',
                  explicit: track.explicit || false,
                  keywords: track.keywords || [],
                  v4vRecipient: track.v4vRecipient,
                  v4vValue: track.v4vValue,
                  guid: track.guid,
                  id: track.id,
                  startTime: track.startTime,
                  endTime: track.endTime
                })),
                link: feed.originalUrl || '',
                feedUrl: feed.originalUrl || ''
              };
              console.log('✅ Constructed album from feed data');
            }
          }
        }
      }
      
      if (!albumData) {
        console.error('❌ Could not fetch album data by any method');
        toast.error('Could not load album data. Please try again.');
        return;
      }
      
      // Filter tracks to only those with valid URLs
      const playableTracks = albumData.tracks.filter((track: any) => track.url && track.url.trim() !== '');
      
      if (playableTracks.length === 0) {
        console.error('❌ No playable tracks found in album');
        toast.error('No playable tracks found in this album');
        return;
      }

      // Convert to RSSAlbum format
      const rssAlbum: RSSAlbum = {
        id: albumData.id || album.id,
        title: albumData.title || album.title,
        artist: albumData.artist || album.artist || 'Unknown Artist',
        description: albumData.description || album.description || '',
        coverArt: albumData.coverArt || albumData.image || album.image || '',
        releaseDate: albumData.releaseDate || album.favoritedAt,
        tracks: playableTracks.map((track: any) => ({
          title: track.title,
          duration: track.duration || '0:00',
          url: track.url || track.audioUrl || '',
          trackNumber: track.trackNumber || 0,
          subtitle: track.subtitle || '',
          summary: track.summary || '',
          image: track.image || albumData.coverArt || '',
          explicit: track.explicit || false,
          keywords: track.keywords || [],
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          guid: track.guid,
          id: track.id,
          startTime: track.startTime,
          endTime: track.endTime
        })),
        link: albumData.link || albumData.feedUrl || '',
        feedUrl: albumData.feedUrl || albumData.link || ''
      };

      console.log('🎵 Attempting to play RSSAlbum:', rssAlbum.title, 'with', rssAlbum.tracks.length, 'tracks');
      const success = await globalPlayAlbum(rssAlbum, 0);
      if (success) {
        console.log('✅ Successfully started playback');
        // Open the fullscreen Now Playing screen
        setFullscreenMode(true);
      } else {
        console.error('❌ Failed to start playback');
        toast.error('Unable to play audio - please try again');
      }
    } catch (err) {
      console.error('❌ Error playing album:', err);
      toast.error(`Failed to load album data: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Sort tracks based on selected sort option
  const sortedTracks = useMemo(() => {
    const tracks = [...favoriteTracks];
    
    switch (trackSortBy) {
      case 'date-desc':
        // Most recently favorited first (default from API)
        return tracks.sort((a, b) => {
          const dateA = new Date(a.favoritedAt).getTime();
          const dateB = new Date(b.favoritedAt).getTime();
          return dateB - dateA;
        });
      
      case 'date-asc':
        // Oldest favorites first
        return tracks.sort((a, b) => {
          const dateA = new Date(a.favoritedAt).getTime();
          const dateB = new Date(b.favoritedAt).getTime();
          return dateA - dateB;
        });
      
      case 'title-asc':
        // Title A-Z
        return tracks.sort((a, b) => {
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();
          return titleA.localeCompare(titleB);
        });
      
      case 'title-desc':
        // Title Z-A
        return tracks.sort((a, b) => {
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();
          return titleB.localeCompare(titleA);
        });
      
      case 'artist-asc':
        // Artist A-Z, then by title
        return tracks.sort((a, b) => {
          const artistA = (a.artist || a.Feed?.artist || 'Unknown Artist').toLowerCase();
          const artistB = (b.artist || b.Feed?.artist || 'Unknown Artist').toLowerCase();
          if (artistA !== artistB) {
            return artistA.localeCompare(artistB);
          }
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();
          return titleA.localeCompare(titleB);
        });
      
      case 'artist-desc':
        // Artist Z-A, then by title
        return tracks.sort((a, b) => {
          const artistA = (a.artist || a.Feed?.artist || 'Unknown Artist').toLowerCase();
          const artistB = (b.artist || b.Feed?.artist || 'Unknown Artist').toLowerCase();
          if (artistA !== artistB) {
            return artistB.localeCompare(artistA);
          }
          const titleA = (a.title || '').toLowerCase();
          const titleB = (b.title || '').toLowerCase();
          return titleA.localeCompare(titleB);
        });
      
      default:
        return tracks;
    }
  }, [favoriteTracks, trackSortBy]);

  const handlePlayTrack = async (track: FavoriteTrack) => {
    if (!track.audioUrl) {
      toast.error('No audio URL available for this track');
      return;
    }

    try {
      const success = await playTrack(track.audioUrl);
      if (success) {
        // Playback started successfully
      } else {
        toast.error('Unable to play audio - please try again');
      }
    } catch (err) {
      console.error('Error playing track:', err);
      toast.error('Failed to play track');
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-x-hidden">
      <div className="container mx-auto px-4 py-8 pb-24 sm:pb-8">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold mb-2 flex items-center gap-2 sm:gap-3">
            <Heart className="w-6 h-6 sm:w-10 sm:h-10 text-red-500 fill-red-500" />
            My Favorites
          </h1>
          <p className="text-sm sm:text-base text-gray-400">Your favorite tracks, albums, and publishers</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 sm:gap-4 mb-8 border-b border-gray-700 overflow-x-auto scrollbar-hide -mx-4 px-4">
          <button
            onClick={() => setActiveTab('albums')}
            className={`px-3 sm:px-4 py-2 font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${
              activeTab === 'albums'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Disc className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base">Albums</span>
            <span className="text-xs sm:text-sm text-gray-500">({favoriteAlbums.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('publishers')}
            className={`px-3 sm:px-4 py-2 font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${
              activeTab === 'publishers'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base">Publishers</span>
            <span className="text-xs sm:text-sm text-gray-500">({favoritePublishers.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('tracks')}
            className={`px-3 sm:px-4 py-2 font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${
              activeTab === 'tracks'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Music className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base">Tracks</span>
            <span className="text-xs sm:text-sm text-gray-500">({favoriteTracks.length})</span>
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
                    feedId: album.id, // Use album.id as feedId for lookup
                    type: album.type,
                    // Store original album data for better lookup
                    originalAlbum: album
                  };

                  return (
                    <AlbumCard
                      key={album.id}
                      album={albumForCard}
                      onPlay={handlePlayAlbum}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Publishers Tab */}
        {activeTab === 'publishers' && (
          <div>
            {favoritePublishers.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h2 className="text-2xl font-bold mb-2">No Favorite Publishers</h2>
                <p className="text-gray-400 mb-4">Start favoriting publishers to see them here!</p>
                <Link
                  href="/"
                  className="inline-block px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
                >
                  Browse Publishers
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {favoritePublishers.map((publisher) => {
                  const publisherForCard = {
                    id: publisher.id,
                    title: publisher.title,
                    artist: publisher.artist || publisher.title || 'Unknown Publisher',
                    description: publisher.description || '',
                    coverArt: publisher.image || '',
                    releaseDate: publisher.favoritedAt,
                    tracks: (publisher.Track || []).map(track => ({
                      title: track.title,
                      artist: track.artist || undefined,
                      duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
                      url: '',
                      id: track.id
                    })),
                    feedId: publisher.id,
                    type: publisher.type,
                    isPublisherCard: true,
                    albumCount: (publisher as any).itemCount || (publisher.Track?.length || 0)
                  };

                  return (
                    <AlbumCard
                      key={publisher.id}
                      album={publisherForCard}
                      onPlay={handlePlayAlbum}
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
              <>
                {/* Sort Selector */}
                <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
                  <label htmlFor="track-sort" className="text-xs sm:text-sm text-gray-400">
                    Sort by:
                  </label>
                  <select
                    id="track-sort"
                    value={trackSortBy}
                    onChange={(e) => setTrackSortBy(e.target.value as typeof trackSortBy)}
                    className="px-3 sm:px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal transition-all"
                  >
                    <option value="date-desc">Date Favorited (Newest)</option>
                    <option value="date-asc">Date Favorited (Oldest)</option>
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="artist-asc">Artist (A-Z)</option>
                    <option value="artist-desc">Artist (Z-A)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  {sortedTracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all border border-white/10"
                  >
                    <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto flex-shrink-0">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg overflow-hidden flex-shrink-0">
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

                      <div className="flex-1 min-w-0 sm:flex-none sm:flex-1">
                        <h3 className="font-semibold text-base sm:text-lg truncate">{track.title}</h3>
                        <p className="text-gray-400 text-xs sm:text-sm truncate">
                          {track.artist || track.Feed?.artist || 'Unknown Artist'}
                        </p>
                        {track.album && (
                          <p className="text-gray-500 text-xs truncate">from {track.album}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-between sm:justify-end flex-shrink-0">
                      {track.duration && (
                        <span className="text-gray-400 text-xs sm:text-sm">
                          {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePlayTrack(track);
                          }}
                          className="px-2.5 sm:px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-white text-xs sm:text-sm font-medium transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={!track.audioUrl}
                          title={track.audioUrl ? 'Play track' : 'No audio available'}
                        >
                          <Play className="w-3 h-3 sm:w-4 sm:h-4" />
                          <span className="hidden sm:inline">Play</span>
                        </button>
                        <FavoriteButton
                          trackId={track.id}
                          onToggle={handleFavoriteToggle}
                          isFavorite={true}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

