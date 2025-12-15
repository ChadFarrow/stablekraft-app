'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { useAudio } from '@/contexts/AudioContext';
import { getSessionId } from '@/lib/session-utils';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumSlug } from '@/lib/url-utils';
import { RSSAlbum } from '@/lib/rss-parser';
import LoadingSpinner from '@/components/LoadingSpinner';
import AlbumCard from '@/components/AlbumCard';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import SyncToNostrButton from '@/components/favorites/SyncToNostrButton';
import { BoostButton } from '@/components/Lightning/BoostButton';
import { Heart, Music, Disc, Users, Play, ArrowLeft, Shuffle, ListMusic, Globe, RefreshCw } from 'lucide-react';
import { toast } from '@/components/Toast';
import AppLayout from '@/components/AppLayout';
import { useAutoSyncFavorites } from '@/hooks/useAutoSyncFavorites';

// Cache key for community favorites in sessionStorage
const COMMUNITY_CACHE_KEY = 'community-favorites-cache';
const COMMUNITY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  trackCount?: number;
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

interface CommunityFavorite {
  type: 'track' | 'album';
  item: {
    id: string;
    title: string;
    artist?: string;
    image?: string;
    duration?: number;
    feedId?: string;
    trackCount?: number;
    type?: string;
    // For single-track albums, include track data to favorite as track
    singleTrack?: {
      id: string;
      title: string;
    };
  };
  favoritedBy: {
    pubkey: string;
    npub: string;
    displayName?: string;
    avatar?: string;
  };
  favoritedAt: number;
  nostrEventId: string;
  originalItemId: string;
}

function FavoritesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sessionId, isLoading: sessionLoading } = useSession();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();
  const { playAlbum: globalPlayAlbum, setFullscreenMode } = useAudio();

  // Get tab from URL or default to 'albums'
  const tabFromUrl = searchParams?.get('tab') as 'albums' | 'tracks' | 'publishers' | 'playlists' | 'community' | null;
  const validTabs = ['albums', 'tracks', 'publishers', 'playlists', 'community'];
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'albums';
  const [activeTab, setActiveTab] = useState<'albums' | 'tracks' | 'publishers' | 'playlists' | 'community'>(initialTab);

  // Update URL when tab changes (without full navigation)
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    // Update URL without triggering navigation
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  };
  const [favoriteAlbums, setFavoriteAlbums] = useState<FavoriteAlbum[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [favoritePublishers, setFavoritePublishers] = useState<FavoriteAlbum[]>([]);
  const [favoritePlaylists, setFavoritePlaylists] = useState<FavoriteAlbum[]>([]);
  const [communityFavorites, setCommunityFavorites] = useState<CommunityFavorite[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityFilter, setCommunityFilter] = useState<'all' | 'tracks' | 'albums'>('all');
  const [communityUserFilter, setCommunityUserFilter] = useState<string | null>(null); // npub or null for "all"
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

  // Auto-sync unpublished favorites to Nostr when authenticated
  useAutoSyncFavorites({
    enabled: isNostrAuthenticated && !nostrLoading,
    onSyncComplete: () => {
      // Reload favorites to update UI after sync
      if (nostrUser) {
        loadFavorites(null, nostrUser.id);
      }
    }
  });

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
          'flowgnar': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-playlist-art.webp',
          'top100': 'https://podcastindex.org/android-chrome-256x256.png'
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

  // Handler for community favorites - removes item when unfavorited
  const handleCommunityFavoriteToggle = (nostrEventId: string) => (isFavorite: boolean) => {
    // Also trigger the regular favorite reload
    handleFavoriteToggle();

    // If unfavorited, remove from community list immediately
    if (!isFavorite) {
      setCommunityFavorites(prev => prev.filter(fav => fav.nostrEventId !== nostrEventId));
      // Clear cache so next load gets fresh data
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(COMMUNITY_CACHE_KEY);
      }
    }
  };

  const loadCommunityFavorites = async (forceRefresh = false) => {
    if (communityLoading && !forceRefresh) return;

    // Clear cache if force refresh
    if (forceRefresh && typeof window !== 'undefined') {
      sessionStorage.removeItem(COMMUNITY_CACHE_KEY);
    }

    // Check cache first (unless force refresh)
    if (!forceRefresh && typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(COMMUNITY_CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          const isExpired = Date.now() - timestamp > COMMUNITY_CACHE_TTL;

          if (!isExpired && data && data.length > 0) {
            console.log('📦 Using cached community favorites');
            setCommunityFavorites(data);
            return;
          }
        }
      } catch (e) {
        console.warn('Failed to read community cache:', e);
      }
    }

    setCommunityLoading(true);
    setCommunityError(null);

    try {
      const headers: HeadersInit = {};
      if (nostrUser?.nostrPubkey) {
        headers['x-nostr-pubkey'] = nostrUser.nostrPubkey;
      }

      // Always fetch all types - filtering is done client-side for faster switching
      const response = await fetch(
        `/api/nostr/global-favorites?type=all&limit=200&excludeSelf=true`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch community favorites');
      }

      const data = await response.json();

      if (data.success) {
        const favorites = data.data || [];
        setCommunityFavorites(favorites);

        // Cache the results
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(COMMUNITY_CACHE_KEY, JSON.stringify({
              data: favorites,
              timestamp: Date.now()
            }));
            console.log('💾 Cached community favorites');
          } catch (e) {
            console.warn('Failed to cache community favorites:', e);
          }
        }
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Error loading community favorites:', err);
      setCommunityError(err instanceof Error ? err.message : 'Failed to load community favorites');
    } finally {
      setCommunityLoading(false);
    }
  };

  // Load community favorites when tab is selected (filter is applied client-side)
  useEffect(() => {
    if (activeTab === 'community') {
      loadCommunityFavorites();
    }
  }, [activeTab]);

  // Helper to format relative time
  const formatRelativeTime = (timestamp: number) => {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  // Helper to truncate npub for display
  const formatNpub = (npub: string, displayName?: string) => {
    if (displayName) return displayName;
    return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
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

  // Extract unique users from community favorites for the user filter dropdown
  const uniqueUsers = useMemo(() => {
    const userMap = new Map<string, { npub: string; displayName?: string; avatar?: string }>();
    communityFavorites.forEach(fav => {
      if (!userMap.has(fav.favoritedBy.npub)) {
        userMap.set(fav.favoritedBy.npub, fav.favoritedBy);
      }
    });
    return Array.from(userMap.values()).sort((a, b) =>
      (a.displayName || a.npub).localeCompare(b.displayName || b.npub)
    );
  }, [communityFavorites]);

  // Filter community favorites by type and selected user (client-side for fast switching)
  const filteredCommunityFavorites = useMemo(() => {
    let filtered = communityFavorites;

    // Filter by type (all, tracks, albums)
    if (communityFilter === 'tracks') {
      filtered = filtered.filter(fav => fav.type === 'track');
    } else if (communityFilter === 'albums') {
      filtered = filtered.filter(fav => fav.type === 'album');
    }

    // Filter by selected user
    if (communityUserFilter !== null) {
      filtered = filtered.filter(fav => fav.favoritedBy.npub === communityUserFilter);
    }

    return filtered;
  }, [communityFavorites, communityFilter, communityUserFilter]);

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
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="mb-4 flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
            <span className="text-sm sm:text-base">Back</span>
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h1 className="text-2xl sm:text-4xl font-bold mb-2 flex items-center gap-2 sm:gap-3">
                <Heart className="w-6 h-6 sm:w-10 sm:h-10 text-red-500 fill-red-500" />
                My Favorites
              </h1>
              <p className="text-sm sm:text-base text-gray-400">Your favorite tracks, albums, and publishers</p>
            </div>
            <SyncToNostrButton className="self-start sm:self-auto" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 sm:gap-4 mb-8 border-b border-gray-700 overflow-x-auto scrollbar-hide -mx-4 px-4">
          <button
            onClick={() => handleTabChange('albums')}
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
            onClick={() => handleTabChange('publishers')}
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
            onClick={() => handleTabChange('tracks')}
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
            onClick={() => handleTabChange('playlists')}
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
          <button
            onClick={() => handleTabChange('community')}
            className={`px-3 sm:px-4 py-2 font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${
              activeTab === 'community'
                ? 'text-white border-b-2 border-stablekraft-teal'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base">Community</span>
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
                    trackCount: album.trackCount || album.Track?.length || 0,
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

        {/* Community Tab */}
        {activeTab === 'community' && (
          <div>
            {/* Header with description and controls */}
            <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm text-gray-400">
                  Discover what others are favoriting
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <select
                  id="community-filter"
                  value={communityFilter}
                  onChange={(e) => setCommunityFilter(e.target.value as typeof communityFilter)}
                  className="px-3 sm:px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal transition-all"
                >
                  <option value="all">All</option>
                  <option value="tracks">Tracks Only</option>
                  <option value="albums">Albums Only</option>
                </select>
                <select
                  id="community-user-filter"
                  value={communityUserFilter || ''}
                  onChange={(e) => setCommunityUserFilter(e.target.value || null)}
                  className="px-3 sm:px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-stablekraft-teal transition-all max-w-[180px]"
                >
                  <option value="">All Users</option>
                  {uniqueUsers.map(user => (
                    <option key={user.npub} value={user.npub}>
                      {formatNpub(user.npub, user.displayName)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => loadCommunityFavorites(true)}
                  disabled={communityLoading}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 ${communityLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Error state */}
            {communityError && (
              <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400">
                {communityError}
              </div>
            )}

            {/* Loading state */}
            {communityLoading && filteredCommunityFavorites.length === 0 && (
              <div className="text-center py-12">
                <LoadingSpinner size="large" text="Fetching from Nostr relays..." />
              </div>
            )}

            {/* Empty state */}
            {!communityLoading && filteredCommunityFavorites.length === 0 && !communityError && (
              <div className="text-center py-12">
                <Globe className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h2 className="text-2xl font-bold mb-2">No Community Favorites Found</h2>
                <p className="text-gray-400 mb-4">
                  No one has published favorites to Nostr yet, or they couldn&apos;t be resolved.
                </p>
                <p className="text-gray-500 text-sm">
                  Start favoriting music and it will appear here for others!
                </p>
              </div>
            )}

            {/* Community favorites list */}
            {filteredCommunityFavorites.length > 0 && (
              <div className="space-y-3">
                {filteredCommunityFavorites.map((fav) => (
                  <div
                    key={fav.nostrEventId}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all border border-white/10"
                  >
                    {/* Album Art */}
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg overflow-hidden flex-shrink-0">
                      <Image
                        src={getAlbumArtworkUrl(fav.item.image || '', 'thumbnail')}
                        alt={fav.item.title}
                        width={64}
                        height={64}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = getPlaceholderImageUrl('thumbnail');
                        }}
                      />
                    </div>

                    {/* Item Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          fav.type === 'track' || (fav.item.trackCount || 0) <= 1
                            ? 'bg-green-500/20 text-green-400'
                            : (fav.item.trackCount || 0) <= 6
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {fav.type === 'track' || (fav.item.trackCount || 0) <= 1
                            ? 'Track'
                            : (fav.item.trackCount || 0) <= 6
                              ? 'EP'
                              : 'Album'}
                        </span>
                      </div>
                      <h3 className="font-semibold text-base sm:text-lg truncate">{fav.item.title}</h3>
                      <p className="text-gray-400 text-xs sm:text-sm truncate">
                        {fav.item.artist || 'Unknown Artist'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {/* User avatar */}
                        {fav.favoritedBy.avatar ? (
                          <Image
                            src={fav.favoritedBy.avatar}
                            alt=""
                            width={16}
                            height={16}
                            className="w-4 h-4 rounded-full"
                            unoptimized
                          />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                        )}
                        <span className="text-gray-500 text-xs truncate">
                          <a
                            href={`https://njump.me/${fav.favoritedBy.npub}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-stablekraft-teal hover:underline transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {formatNpub(fav.favoritedBy.npub, fav.favoritedBy.displayName)}
                          </a>
                          {' '}• {formatRelativeTime(fav.favoritedAt)}
                        </span>
                      </div>
                    </div>

                    {/* Favorite Button - Add to own favorites */}
                    <FavoriteButton
                      trackId={fav.type === 'track' ? fav.originalItemId : undefined}
                      feedId={fav.type === 'album' && !fav.item.singleTrack ? fav.originalItemId : undefined}
                      onToggle={handleCommunityFavoriteToggle(fav.nostrEventId)}
                      singleTrackData={fav.item.singleTrack ? {
                        id: fav.item.singleTrack.id,
                        title: fav.item.singleTrack.title,
                        artist: fav.item.artist,
                      } : undefined}
                    />

                    {/* Play and View Buttons */}
                    <div className="flex items-center gap-2">
                    {/* Play Button */}
                    <button
                      onClick={async () => {
                        if (fav.type === 'album') {
                          // Play album from the beginning
                          try {
                            const response = await fetch(`/api/albums/${fav.item.id}`);
                            if (response.ok) {
                              const data = await response.json();
                              if (data.album && data.album.tracks) {
                                const rssAlbum: RSSAlbum = {
                                  id: data.album.id,
                                  title: data.album.title,
                                  artist: data.album.artist || 'Unknown Artist',
                                  description: data.album.description || '',
                                  coverArt: data.album.coverArt || '',
                                  releaseDate: data.album.releaseDate,
                                  tracks: data.album.tracks.map((track: any) => ({
                                    title: track.title,
                                    duration: track.duration || '0:00',
                                    url: track.url || '',
                                    id: track.id,
                                  })),
                                  link: '',
                                  feedUrl: ''
                                };
                                await globalPlayAlbum(rssAlbum, 0);
                                return;
                              }
                            }
                          } catch (err) {
                            console.error('Error playing album:', err);
                          }
                          toast.error('Could not play album');
                        } else {
                          // Play specific track
                          if (fav.item.feedId) {
                            try {
                              const response = await fetch(`/api/albums/${fav.item.feedId}`);
                              if (response.ok) {
                                const data = await response.json();
                                if (data.album && data.album.tracks) {
                                  const trackIndex = data.album.tracks.findIndex(
                                    (t: any) => t.id === fav.item.id
                                  );
                                  if (trackIndex >= 0) {
                                    const rssAlbum: RSSAlbum = {
                                      id: data.album.id,
                                      title: data.album.title,
                                      artist: data.album.artist || 'Unknown Artist',
                                      description: data.album.description || '',
                                      coverArt: data.album.coverArt || '',
                                      releaseDate: data.album.releaseDate,
                                      tracks: data.album.tracks.map((track: any) => ({
                                        title: track.title,
                                        duration: track.duration || '0:00',
                                        url: track.url || '',
                                        id: track.id,
                                      })),
                                      link: '',
                                      feedUrl: ''
                                    };
                                    await globalPlayAlbum(rssAlbum, trackIndex);
                                    return;
                                  }
                                }
                              }
                            } catch (err) {
                              console.error('Error playing track:', err);
                            }
                          }
                          toast.error('Could not play track');
                        }
                      }}
                      className="px-2.5 sm:px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-white text-xs sm:text-sm font-medium transition-colors flex items-center gap-1"
                    >
                      <Play className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span className="hidden sm:inline">Play</span>
                    </button>

                    {/* View Button */}
                    <Link
                      href={fav.type === 'album' ? `/album/${fav.item.id}` : `/album/${fav.item.feedId}`}
                      className="px-2.5 sm:px-3 py-1.5 bg-stablekraft-teal hover:bg-stablekraft-orange rounded-lg text-white text-xs sm:text-sm font-medium transition-colors flex items-center gap-1"
                    >
                      <Disc className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span className="hidden sm:inline">View</span>
                    </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </AppLayout>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <FavoritesPageContent />
    </Suspense>
  );
}
