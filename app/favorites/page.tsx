'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
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
import { BoostButton } from '@/components/Lightning/BoostButton';
import { Heart, Music, Disc, Users, Play, ArrowLeft, Shuffle, ListMusic } from 'lucide-react';
import { toast } from '@/components/Toast';
import AppLayout from '@/components/AppLayout';

interface FavoriteTrack {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  image: string | null;
  audioUrl: string;
  duration: number | null;
  favoritedAt: string;
  v4vValue?: any;
  v4vRecipient?: string | null;
  guid?: string | null;
  Feed?: {
    title: string;
    artist: string | null;
    image: string | null;
    id: string;
    v4vValue?: any;
    v4vRecipient?: string | null;
    originalUrl?: string | null;
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
  v4vValue?: any;
  v4vRecipient?: string | null;
  originalUrl?: string | null;
  Track?: Array<{
    id: string;
    title: string;
    artist: string | null;
    duration: number | null;
    image: string | null;
  }>;
}

export default function FavoritesPage() {
  const router = useRouter();
  const { sessionId, isLoading: sessionLoading } = useSession();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();
  const { playAlbum: globalPlayAlbum, setFullscreenMode, toggleShuffle, isShuffleMode } = useAudio();
  const [activeTab, setActiveTab] = useState<'albums' | 'tracks' | 'publishers' | 'playlists'>('albums');
  const [favoriteAlbums, setFavoriteAlbums] = useState<FavoriteAlbum[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [favoritePublishers, setFavoritePublishers] = useState<FavoriteAlbum[]>([]);
  const [favoritePlaylists, setFavoritePlaylists] = useState<FavoriteAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackSortBy, setTrackSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc'>('date-desc');
  const [albumSortBy, setAlbumSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc'>('artist-asc');
  const [publisherSortBy, setPublisherSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc'>('title-asc');
  const [playlistSortBy, setPlaylistSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc'>('title-asc');

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
        // Separate publishers, playlists, and regular albums
        const playlistTitles = ['hgh', 'mmm', 'sas', 'iam', 'itdv', 'mmt', 'b4ts', 'upbeats', 'flowgnar'];

        const isPlaylist = (album: any) => {
          if (album.type === 'playlist') return true;
          const titleLower = (album.title || '').toLowerCase();
          if (titleLower.includes('playlist')) return true;
          if (playlistTitles.some(p => titleLower === p || titleLower.startsWith(`${p}-`) || titleLower.startsWith(`${p} `))) return true;
          return false;
        };

        // Fallback playlist images when not in database (playlists are hardcoded, not in Feed table)
        const playlistImageFallbacks: Record<string, string> = {
          'hgh': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-playlist-art.webp',
          'mmm': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-playlist-art.webp',
          'sas': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-playlist-art%20.webp',
          'iam': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.webp',
          'itdv': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.webp',
          'mmt': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-playlist-art.webp',
          'b4ts': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-playlist-art.webp',
          'upbeats': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/UpBEATs-music-playlist.webp',
          'flowgnar': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-playlist-art.webp'
        };

        const getPlaylistImageFallback = (album: any) => {
          if (album.image) return album.image; // Use database image if available
          const titleLower = (album.title || '').toLowerCase();
          for (const [name, url] of Object.entries(playlistImageFallbacks)) {
            if (titleLower.includes(name)) {
              return url;
            }
          }
          return null;
        };

        const albums = allAlbums.filter((album: any) =>
          album.type !== 'publisher' && !isPlaylist(album)
        );
        const publishers = allAlbums.filter((album: any) => album.type === 'publisher');
        const playlists = allAlbums.filter((album: any) => isPlaylist(album)).map((album: any) => ({
          ...album,
          image: getPlaylistImageFallback(album)
        }));

        setFavoriteAlbums(albums);
        setFavoritePublishers(publishers);
        setFavoritePlaylists(playlists);
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

  // Sort albums based on selected sort option
  const sortedAlbums = useMemo(() => {
    const albums = [...favoriteAlbums];

    switch (albumSortBy) {
      case 'date-desc':
        return albums.sort((a, b) => new Date(b.favoritedAt).getTime() - new Date(a.favoritedAt).getTime());
      case 'date-asc':
        return albums.sort((a, b) => new Date(a.favoritedAt).getTime() - new Date(b.favoritedAt).getTime());
      case 'title-asc':
        return albums.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
      case 'title-desc':
        return albums.sort((a, b) => (b.title || '').toLowerCase().localeCompare((a.title || '').toLowerCase()));
      case 'artist-asc':
        return albums.sort((a, b) => {
          const artistA = (a.artist || 'Unknown Artist').toLowerCase();
          const artistB = (b.artist || 'Unknown Artist').toLowerCase();
          if (artistA !== artistB) return artistA.localeCompare(artistB);
          return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
        });
      case 'artist-desc':
        return albums.sort((a, b) => {
          const artistA = (a.artist || 'Unknown Artist').toLowerCase();
          const artistB = (b.artist || 'Unknown Artist').toLowerCase();
          if (artistA !== artistB) return artistB.localeCompare(artistA);
          return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase());
        });
      default:
        return albums;
    }
  }, [favoriteAlbums, albumSortBy]);

  // Sort publishers based on selected sort option
  const sortedPublishers = useMemo(() => {
    const publishers = [...favoritePublishers];

    switch (publisherSortBy) {
      case 'date-desc':
        return publishers.sort((a, b) => new Date(b.favoritedAt).getTime() - new Date(a.favoritedAt).getTime());
      case 'date-asc':
        return publishers.sort((a, b) => new Date(a.favoritedAt).getTime() - new Date(b.favoritedAt).getTime());
      case 'title-asc':
        return publishers.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
      case 'title-desc':
        return publishers.sort((a, b) => (b.title || '').toLowerCase().localeCompare((a.title || '').toLowerCase()));
      default:
        return publishers;
    }
  }, [favoritePublishers, publisherSortBy]);

  // Sort playlists based on selected sort option
  const sortedPlaylists = useMemo(() => {
    const playlists = [...favoritePlaylists];

    switch (playlistSortBy) {
      case 'date-desc':
        return playlists.sort((a, b) => new Date(b.favoritedAt).getTime() - new Date(a.favoritedAt).getTime());
      case 'date-asc':
        return playlists.sort((a, b) => new Date(a.favoritedAt).getTime() - new Date(b.favoritedAt).getTime());
      case 'title-asc':
        return playlists.sort((a, b) => (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase()));
      case 'title-desc':
        return playlists.sort((a, b) => (b.title || '').toLowerCase().localeCompare((a.title || '').toLowerCase()));
      default:
        return playlists;
    }
  }, [favoritePlaylists, playlistSortBy]);

  const handleShufflePlay = async () => {
    if (favoriteTracks.length === 0) {
      toast.error('No tracks to shuffle');
      return;
    }

    // Shuffle the tracks array
    const shuffled = [...favoriteTracks].sort(() => Math.random() - 0.5);

    // Create a playlist album from all shuffled tracks
    const shuffleAlbum: RSSAlbum = {
      id: 'favorites-shuffle',
      title: 'Favorite Tracks (Shuffled)',
      artist: 'Various Artists',
      description: 'Your favorite tracks shuffled',
      coverArt: shuffled[0]?.image || shuffled[0]?.Feed?.image || '',
      releaseDate: new Date().toISOString(),
      tracks: shuffled
        .filter(track => track.audioUrl)
        .map((track, index) => ({
          title: track.title,
          url: track.audioUrl,
          duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
          image: track.image || track.Feed?.image || '',
          id: track.id,
          trackNumber: index + 1,
          artist: track.artist || track.Feed?.artist || undefined,
        })),
      link: '',
      feedUrl: ''
    };

    if (shuffleAlbum.tracks.length === 0) {
      toast.error('No playable tracks found');
      return;
    }

    const success = await globalPlayAlbum(shuffleAlbum, 0);
    if (success) {
      setFullscreenMode(true);
    } else {
      toast.error('Failed to start shuffle playback');
    }
  };

  const handlePlayTrack = async (track: FavoriteTrack) => {
    if (!track.audioUrl) {
      toast.error('No audio URL available for this track');
      return;
    }

    try {
      // Create a single-track album with proper metadata
      const singleTrackAlbum: RSSAlbum = {
        id: track.id,
        title: track.album || track.Feed?.title || 'Single Track',
        artist: track.artist || track.Feed?.artist || 'Unknown Artist',
        description: '',
        coverArt: track.image || track.Feed?.image || '',
        releaseDate: track.favoritedAt,
        tracks: [{
          title: track.title,
          url: track.audioUrl,
          duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
          image: track.image || track.Feed?.image || '',
          id: track.id,
        }],
        link: '',
        feedUrl: ''
      };

      const success = await globalPlayAlbum(singleTrackAlbum, 0);
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
    <AppLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-x-hidden">
      <div className="container mx-auto px-4 py-8 pb-24 sm:pb-8">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="mb-4 flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm sm:text-base">Back</span>
          </button>
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
            <span className="text-sm sm:text-base">Albums & EPs</span>
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
          <button
            onClick={() => setActiveTab('playlists')}
            className={`px-3 sm:px-4 py-2 font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${
              activeTab === 'playlists'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <ListMusic className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base">Playlists</span>
            <span className="text-xs sm:text-sm text-gray-500">({favoritePlaylists.length})</span>
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
                <h2 className="text-2xl font-bold mb-2">No Favorite Albums & EPs</h2>
                <p className="text-gray-400 mb-4">Start favoriting albums to see them here!</p>
                <Link
                  href="/"
                  className="inline-block px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
                >
                  Browse Albums & EPs
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-6 flex items-center gap-2 sm:gap-4">
                  <select
                    id="album-sort"
                    value={albumSortBy}
                    onChange={(e) => setAlbumSortBy(e.target.value as typeof albumSortBy)}
                    className="px-3 sm:px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal transition-all"
                  >
                    <option value="date-desc">Date Favorited (Newest)</option>
                    <option value="date-asc">Date Favorited (Oldest)</option>
                    <option value="title-asc">Title (A-Z)</option>
                    <option value="title-desc">Title (Z-A)</option>
                    <option value="artist-asc">Artist (A-Z)</option>
                    <option value="artist-desc">Artist (Z-A)</option>
                  </select>
                  <label htmlFor="album-sort" className="text-xs sm:text-sm text-gray-400">
                    Sort by
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {sortedAlbums.map((album) => {
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
                    // V4V data for boost button
                    v4vValue: album.v4vValue || undefined,
                    v4vRecipient: album.v4vRecipient || undefined,
                    feedUrl: album.originalUrl || undefined,
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
              </>
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
              <>
                <div className="mb-6 flex items-center gap-2 sm:gap-4">
                  <select
                    id="publisher-sort"
                    value={publisherSortBy}
                    onChange={(e) => setPublisherSortBy(e.target.value as typeof publisherSortBy)}
                    className="px-3 sm:px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal transition-all"
                  >
                    <option value="date-desc">Date Favorited (Newest)</option>
                    <option value="date-asc">Date Favorited (Oldest)</option>
                    <option value="title-asc">Name (A-Z)</option>
                    <option value="title-desc">Name (Z-A)</option>
                  </select>
                  <label htmlFor="publisher-sort" className="text-xs sm:text-sm text-gray-400">
                    Sort by
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {sortedPublishers.map((publisher) => {
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
              </>
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
                {/* Sort Selector and Shuffle Button */}
                <div className="mb-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
                  <div className="flex items-center gap-2 sm:gap-4">
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
                    <label htmlFor="track-sort" className="text-xs sm:text-sm text-gray-400">
                      Sort by
                    </label>
                  </div>
                  <button
                    onClick={handleShufflePlay}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg text-sm font-medium transition-all sm:ml-auto"
                    title="Shuffle play all tracks"
                  >
                    <Shuffle className="w-4 h-4" />
                    <span>Shuffle All</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {sortedTracks.map((track) => {
                    // Get v4v data from track or feed
                    const v4vValue = track.v4vValue || track.Feed?.v4vValue;
                    const v4vRecipient = track.v4vRecipient || track.Feed?.v4vRecipient;
                    const hasV4v = !!(v4vValue || v4vRecipient);
                    const valueSplits = v4vValue?.recipients || v4vValue?.destinations || [];

                    return (
                      <div
                        key={track.id}
                        className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all border border-white/10"
                      >
                        {/* Album Art */}
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

                        {/* Track Info */}
                        <div className="min-w-0">
                          <h3 className="font-semibold text-base sm:text-lg truncate">{track.title}</h3>
                          <p className="text-gray-400 text-xs sm:text-sm truncate">
                            {track.artist || track.Feed?.artist || 'Unknown Artist'}
                          </p>
                          {track.album && (
                            <p className="text-gray-500 text-xs truncate">from {track.album}</p>
                          )}
                        </div>

                        {/* Duration */}
                        <span className="text-gray-400 text-xs sm:text-sm w-10 sm:w-12 text-right">
                          {track.duration
                            ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}`
                            : '--:--'}
                        </span>

                        {/* Boost Button */}
                        {hasV4v ? (
                          <BoostButton
                            trackId={track.id}
                            feedId={track.Feed?.id}
                            trackTitle={track.title}
                            artistName={track.artist || track.Feed?.artist || 'Unknown Artist'}
                            lightningAddress={v4vRecipient || undefined}
                            valueSplits={valueSplits.filter((r: any) => !r.fee).map((r: any) => ({
                              name: r.name,
                              address: r.address,
                              split: r.split,
                              type: r.type || (r.address?.includes('@') ? 'lnaddress' : 'node')
                            }))}
                            feedUrl={track.Feed?.originalUrl || undefined}
                            episodeGuid={track.guid || track.id}
                            albumName={track.album || track.Feed?.title}
                            iconOnly={true}
                            className="w-8 h-8 sm:w-9 sm:h-9"
                          />
                        ) : (
                          <div className="w-8 h-8 sm:w-9 sm:h-9" />
                        )}

                        {/* Favorite Button */}
                        <FavoriteButton
                          trackId={track.id}
                          onToggle={handleFavoriteToggle}
                          isFavorite={true}
                        />

                        {/* Play Button */}
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
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* Playlists Tab */}
        {activeTab === 'playlists' && (
          <div>
            {favoritePlaylists.length === 0 ? (
              <div className="text-center py-12">
                <ListMusic className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h2 className="text-2xl font-bold mb-2">No Favorite Playlists</h2>
                <p className="text-gray-400 mb-4">Start favoriting playlists to see them here!</p>
                <Link
                  href="/?filter=playlist"
                  className="inline-block px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
                >
                  Browse Playlists
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-6 flex items-center gap-2 sm:gap-4">
                  <select
                    id="playlist-sort"
                    value={playlistSortBy}
                    onChange={(e) => setPlaylistSortBy(e.target.value as typeof playlistSortBy)}
                    className="px-3 sm:px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal transition-all"
                  >
                    <option value="date-desc">Date Favorited (Newest)</option>
                    <option value="date-asc">Date Favorited (Oldest)</option>
                    <option value="title-asc">Name (A-Z)</option>
                    <option value="title-desc">Name (Z-A)</option>
                  </select>
                  <label htmlFor="playlist-sort" className="text-xs sm:text-sm text-gray-400">
                    Sort by
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {sortedPlaylists.map((playlist) => {
                    // Extract playlist slug from ID (e.g., 'hgh-playlist' -> 'hgh')
                    const playlistSlug = playlist.id.replace('-playlist', '').toLowerCase();

                    const playlistForCard = {
                      id: playlist.id,
                      title: playlist.title,
                      artist: playlist.artist || 'Playlist',
                      description: playlist.description || '',
                      coverArt: playlist.image || '',
                      releaseDate: playlist.favoritedAt,
                      tracks: (playlist.Track || []).map(track => ({
                        title: track.title,
                        artist: track.artist || undefined,
                        duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
                        url: '',
                        id: track.id
                      })),
                      feedId: playlist.id,
                      type: 'playlist',
                      isPlaylistCard: true,
                      playlistUrl: `/playlist/${playlistSlug}`
                    };

                    return (
                      <AlbumCard
                        key={playlist.id}
                        album={playlistForCard}
                        onPlay={handlePlayAlbum}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
    </AppLayout>
  );
}

