'use client';

import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import ArtworkImage from '@/components/ArtworkImage';
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
import SharedFavoritesNotice from '@/components/favorites/SharedFavoritesNotice';
import FavoritesModeConflictNotice from '@/components/favorites/FavoritesModeConflictNotice';
import SharedFavoritesDisclosure from '@/components/favorites/SharedFavoritesDisclosure';
import PublishPlaylistButton from '@/components/favorites/PublishPlaylistButton';
import { BoostButton } from '@/components/Lightning/BoostButton';
import { Heart, Music, Disc, Users, Play, Shuffle, ListMusic, Globe, RefreshCw, Mic } from 'lucide-react';
import { toast } from '@/components/Toast';
import AppLayout from '@/components/AppLayout';
import BackButton from '@/components/BackButton';
import HomeButton from '@/components/HomeButton';
import { useAutoSyncFavorites } from '@/hooks/useAutoSyncFavorites';

// Cache key for community favorites in sessionStorage. v2 because the payload is now
// grouped by person — a stale v1 envelope would deserialize into the wrong shape.
// Scoped per-pubkey because `excludeSelf` changes what comes back.
const COMMUNITY_CACHE_KEY = 'community-favorites-cache:v2';
const communityCacheKeyFor = (pubkey?: string | null) =>
  `${COMMUNITY_CACHE_KEY}:${pubkey || 'anon'}`;
// Three hours, matching the server's FRESH_MS: other people's favorites have no urgency,
// so there's nothing to gain from re-asking sooner and a fast tab to gain from not.
const COMMUNITY_CACHE_TTL = 3 * 60 * 60 * 1000;
// An empty result expires much sooner — "nobody here yet" is the one answer we want to
// stop showing quickly once it stops being true.
const COMMUNITY_EMPTY_CACHE_TTL = 15 * 60 * 1000;
// Older than this and we'd rather show a spinner than something misleadingly stale.
// Between the TTL and this, the cached list is painted immediately and refreshed behind it.
const COMMUNITY_CACHE_HARD_MAX = 24 * 60 * 60 * 1000;
// How many tiles to show per person before "show all".
const COMMUNITY_PREVIEW_COUNT = 8;

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
    guid?: string | null;
    v4vValue?: any;
    v4vRecipient?: string | null;
    originalUrl?: string | null;
    type?: string | null;
  };
}

type AlbumSort = 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc';

type FavoritesTab = 'albums' | 'podcasts' | 'tracks' | 'publishers' | 'playlists' | 'community';

interface FavoriteAlbum {
  id: string;
  title: string;
  description: string | null;
  artist: string | null;
  image: string | null;
  type: string;
  /** `<podcast:medium>` as the feed declared it — null when it declared none,
   *  which is "we haven't been told", not "music". Cross-app favorites arrive
   *  carrying this at position 4 of their `i` tag, so a podcast someone saved
   *  in another app can be told from an album without resolving it first. */
  medium?: string | null;
  favoritedAt: string;
  /** Album release date — the oldest track's publish date, when the feed has
   *  one. NOT `lastFetched`, which is when we last polled the feed; using that
   *  showed a different year for the same album than the home grid did. */
  oldestItemPubdate?: string | Date | null;
  /** When the feed row was created here. The fallback for `oldestItemPubdate`. */
  createdAt?: string | Date | null;
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
    audioUrl?: string | null;
    guid?: string | null;
    mediaType?: string | null;
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
  favoritedAt: number;
  nostrEventId: string;
  /** Canonical DB id — safe to hand to FavoriteButton. Never the raw Nostr `d` tag. */
  originalItemId: string;
}

/** The Community tab is grouped by person; the API returns it pre-grouped. */
interface CommunityPerson {
  pubkey: string;
  npub: string;
  displayName?: string;
  avatar?: string;
  nip05?: string;
  favoriteCount: number;
  mostRecentAt: number;
  favorites: CommunityFavorite[];
}

function FavoritesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { sessionId, isLoading: sessionLoading } = useSession();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();
  const { playAlbum: globalPlayAlbum, setFullscreenMode } = useAudio();

  // Get tab from URL or default to 'albums'
  const tabFromUrl = searchParams?.get('tab') as FavoritesTab | null;
  const validTabs = ['albums', 'podcasts', 'tracks', 'publishers', 'playlists', 'community'];
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'albums';
  const [activeTab, setActiveTab] = useState<FavoritesTab>(initialTab);

  // Update URL when tab changes (without full navigation)
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    // Update URL without triggering navigation
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  };
  const [favoriteAlbums, setFavoriteAlbums] = useState<FavoriteAlbum[]>([]);
  const [favoritePodcasts, setFavoritePodcasts] = useState<FavoriteAlbum[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [favoritePublishers, setFavoritePublishers] = useState<FavoriteAlbum[]>([]);
  const [favoritePlaylists, setFavoritePlaylists] = useState<FavoriteAlbum[]>([]);
  const [communityPeople, setCommunityPeople] = useState<CommunityPerson[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityFilter, setCommunityFilter] = useState<'all' | 'tracks' | 'albums'>('all');
  // Which people have their full list expanded past the preview cap.
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set());
  // The loading state is read inside loadCommunityFavorites, which the effect can call
  // twice in quick succession — both closures would see `false` and start a sweep. A ref
  // is the only guard that reflects the in-flight call synchronously.
  const communityLoadingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackSortBy, setTrackSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc'>('date-desc');
  const [albumSortBy, setAlbumSortBy] = useState<AlbumSort>('artist-asc');
  const [publisherSortBy, setPublisherSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc'>('title-asc');
  const [playlistSortBy, setPlaylistSortBy] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc'>('title-asc');

  // This page owns the viewport: the document is exactly one screen tall and only the
  // inner list scrolls. But iOS still elastically drags the whole document when a
  // gesture starts somewhere non-scrollable — i.e. on the pinned header — which makes
  // the "pinned" row visibly slide. Suppressing the document's overscroll is the same
  // remedy NowPlayingScreen applies while it's open; scoped to this page and restored
  // on unmount so pull-to-refresh is unaffected everywhere else.
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overscrollBehavior;
    html.style.overscrollBehavior = 'none';
    return () => { html.style.overscrollBehavior = previous; };
  }, []);

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
        const playlistTitles = ['hgh', 'mmm', 'sas', 'iam', 'itdv', 'mmt', 'b4ts', 'upbeats', 'flowgnar', 'greatesthits', 'lt', 'tft'];

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
          'greatesthits': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Greatest-Hits-music-playlist.png',
          'lt': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.png',
          'tft': 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-playlist-art.png'
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

        // A shared cross-app list carries podcasts and music at once by design,
        // so something has to say which. `medium` is what the feed declared;
        // `type` is this app's own classification and is only consulted as a
        // fallback for rows whose medium we haven't parsed yet.
        //
        // Note what is NOT here: a default. An entry we know nothing about
        // stays where it has always been rather than being called music, which
        // would be wrong for exactly the half of the list this separates.
        const isPodcast = (album: any) =>
          album.medium === 'podcast' || (!album.medium && album.type === 'podcast');

        const albums = allAlbums.filter((album: any) =>
          album.type !== 'publisher' && !isPlaylist(album) && !isPodcast(album)
        );
        const podcasts = allAlbums.filter((album: any) =>
          album.type !== 'publisher' && !isPlaylist(album) && isPodcast(album)
        );
        const publishers = allAlbums.filter((album: any) => album.type === 'publisher');
        const playlists = allAlbums.filter((album: any) => isPlaylist(album)).map((album: any) => ({
          ...album,
          image: getPlaylistImageFallback(album)
        }));

        setFavoriteAlbums(albums);
        setFavoritePodcasts(podcasts);
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

  const handleFavoriteToggle = (trackId?: string) => (isFavorite: boolean) => {
    if (!isFavorite && trackId) {
      // Optimistically remove the track from local state — no reload needed
      setFavoriteTracks(prev => prev.filter(t => t.id !== trackId));
      return;
    }
    // Only reload when re-favoriting (to get fresh data)
    setTimeout(() => {
      if (isNostrAuthenticated && nostrUser) {
        loadFavorites(null, nostrUser.id);
      } else {
        const currentSessionId = sessionId || getSessionId();
        if (currentSessionId) {
          loadFavorites(currentSessionId, null);
        }
      }
    }, 500);
  };

  // Handler for community favorites - removes item when unfavorited
  const handleCommunityFavoriteToggle = (nostrEventId: string) => (isFavorite: boolean) => {
    // Reload personal favorites (delayed to let the API call complete)
    handleFavoriteToggle()(isFavorite);

    // If unfavorited, remove from community list immediately
    if (!isFavorite) {
      setCommunityPeople(prev =>
        prev
          .map(person => {
            const favorites = person.favorites.filter(f => f.nostrEventId !== nostrEventId);
            return { ...person, favorites, favoriteCount: favorites.length };
          })
          .filter(person => person.favorites.length > 0)
      );
      // Clear cache so next load gets fresh data
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(communityCacheKeyFor(nostrUser?.nostrPubkey));
      }
    }
  };

  const loadCommunityFavorites = useCallback(async (forceRefresh = false) => {
    if (communityLoadingRef.current) return;

    const cacheKey = communityCacheKeyFor(nostrUser?.nostrPubkey);

    // Clear cache if force refresh
    if (forceRefresh && typeof window !== 'undefined') {
      sessionStorage.removeItem(cacheKey);
    }

    // Stale-while-revalidate. Paint whatever we have IMMEDIATELY, then decide whether to
    // go back to the network behind the already-rendered view. Waiting on relays before
    // showing anything is what made this tab feel slow; the data is other people's
    // favorites, so a few-minute-old answer on screen now beats a perfect one in 4s.
    //
    // An EMPTY result is cached too — it used to require `data.length > 0`, so the
    // common "nobody here" case re-ran the full sweep on every single visit.
    let paintedFromCache = false;
    if (!forceRefresh && typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const { people, timestamp } = JSON.parse(cached);
          if (Array.isArray(people)) {
            const age = Date.now() - timestamp;
            const ttl = people.length ? COMMUNITY_CACHE_TTL : COMMUNITY_EMPTY_CACHE_TTL;
            if (age <= COMMUNITY_CACHE_HARD_MAX) {
              setCommunityPeople(people);
              paintedFromCache = true;
            }
            // Young enough to trust outright — don't touch the network at all.
            if (age <= ttl) return;
          }
        }
      } catch (e) {
        console.warn('Failed to read community cache:', e);
      }
    }

    communityLoadingRef.current = true;
    // Only show the spinner when there's nothing on screen. A background revalidate must
    // not replace a rendered list with a loading state.
    if (!paintedFromCache) setCommunityLoading(true);
    setCommunityError(null);

    try {
      const headers: HeadersInit = {};
      if (nostrUser?.nostrPubkey) {
        headers['x-nostr-pubkey'] = nostrUser.nostrPubkey;
      }

      // Always fetch all types - filtering is done client-side for faster switching
      const response = await fetch(
        `/api/nostr/global-favorites?excludeSelf=true${forceRefresh ? '&refresh=true' : ''}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch community favorites');
      }

      const data = await response.json();

      // A relay outage is NOT "nobody has favorites" — surface it as an error with a
      // retry and never cache it, or one bad sweep sticks for the whole TTL.
      if (data.status === 'error' || !data.success) {
        throw new Error(data.error || 'Could not reach Nostr relays');
      }

      const people: CommunityPerson[] = data.people || [];
      setCommunityPeople(people);

      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ people, timestamp: Date.now() }));
        } catch (e) {
          console.warn('Failed to cache community favorites:', e);
        }
      }
    } catch (err) {
      console.error('Error loading community favorites:', err);
      // Only surface an error banner when there's nothing on screen. A failed BACKGROUND
      // revalidate should leave the already-painted list alone rather than throwing an
      // alarming banner over content that is perfectly usable.
      if (!paintedFromCache) {
        setCommunityError(
          err instanceof Error ? err.message : 'Failed to load community favorites'
        );
      }
    } finally {
      communityLoadingRef.current = false;
      setCommunityLoading(false);
    }
  }, [nostrUser?.nostrPubkey]);

  // Load community favorites when the tab is selected.
  //
  // Waiting on `nostrLoading` matters: deep-linking to ?tab=community used to fire this
  // before NostrContext had hydrated, so the x-nostr-pubkey header was missing and
  // excludeSelf silently no-opped — you saw your own favorites. Keying on the pubkey
  // also re-fetches after a late sign-in instead of showing the anonymous list forever.
  useEffect(() => {
    if (activeTab !== 'community') return;
    if (nostrLoading) return;
    loadCommunityFavorites();
  }, [activeTab, nostrLoading, nostrUser?.nostrPubkey, loadCommunityFavorites]);

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

  const toRssAlbum = (album: any): RSSAlbum => ({
    id: album.id,
    title: album.title,
    artist: album.artist || 'Unknown Artist',
    description: album.description || '',
    coverArt: album.coverArt || '',
    releaseDate: album.releaseDate,
    tracks: (album.tracks || []).map((track: any) => ({
      title: track.title,
      duration: track.duration || '0:00',
      url: track.url || '',
      id: track.id,
      v4vRecipient: track.v4vRecipient,
      v4vValue: track.v4vValue,
      guid: track.guid,
    })),
    link: '',
    feedUrl: album.feedUrl || '',
    feedId: album.feedId || album.id,
    feedGuid: album.feedGuid,
    v4vRecipient: album.v4vRecipient,
    v4vValue: album.v4vValue,
  });

  // Play a community favorite — the album itself, or the album positioned at the track.
  // Extracted from the render so both were not maintained as near-identical copies.
  const playCommunityFavorite = async (fav: CommunityFavorite) => {
    const albumId = fav.type === 'album' ? fav.item.id : fav.item.feedId;
    if (!albumId) {
      toast.error(fav.type === 'album' ? 'Could not play album' : 'Could not play track');
      return;
    }

    try {
      const response = await fetch(`/api/albums/${albumId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.album?.tracks) {
          const index =
            fav.type === 'album'
              ? 0
              : data.album.tracks.findIndex((t: any) => t.id === fav.item.id);
          if (index >= 0) {
            await globalPlayAlbum(toRssAlbum(data.album), index);
            return;
          }
        }
      }
    } catch (err) {
      console.error('Error playing community favorite:', err);
    }
    toast.error(fav.type === 'album' ? 'Could not play album' : 'Could not play track');
  };

  const handlePlayAlbum = async (album: any, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      console.log('🎵 Attempting to play album from favorites:', album.title, album.id, 'feedId:', album.feedId);
      
      // The fast path that used to sit here played straight from
      // `album.originalAlbum.Track`. Those tracks rode along with the favorites
      // list, so every page load carried up to 50 rows for each of 94 favorited
      // feeds on the chance that one album was played. The list no longer sends
      // them; the album is fetched below, once, for the album being played.
      //
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
      
      // Method 3: fetch this feed's tracks directly.
      //
      // The two methods above are guesses — one derives a slug from the title,
      // the other hands an id to a route that expects a slug. This one is not:
      // `album.id` IS the Feed row, and `/api/tracks` filters on it. It is the
      // backstop that makes the two guesses above safe to fail.
      //
      // It replaces a call to `/api/feeds/${album.feedId}`, which could never
      // work: `album.feedId` is not a field this page's albums carry, that
      // route answers under `data` rather than `feed`, and it returns a track
      // COUNT and no tracks. Three reasons, so nothing about it ever ran.
      if (!albumData && album.id) {
        console.log('🔍 Trying to fetch tracks by feed id:', album.id);
        const params = new URLSearchParams({
          feedId: album.id,
          limit: '500',
          sortBy: 'trackOrder',
          sortOrder: 'asc',
        });
        const tracksResponse = await fetch(`/api/tracks?${params}`);
        if (tracksResponse.ok) {
          const { tracks: feedTracks } = await tracksResponse.json();
          const playable = (feedTracks || []).filter((track: any) => track.audioUrl);
          if (playable.length > 0) {
            albumData = {
              id: album.id,
              title: album.title,
              artist: album.artist || 'Unknown Artist',
              description: album.description || '',
              coverArt: album.image || '',
              // oldestItemPubdate, NOT lastFetched — the latter is when we
              // last POLLED the feed. Same drift as app/publisher/[id]/page.tsx
              // had; see lib/catalog/album-shape.ts.
              releaseDate: album.oldestItemPubdate || album.createdAt,
              tracks: playable.map((track: any, index: number) => ({
                title: track.title,
                duration: track.duration ? `${Math.floor(track.duration / 60)}:${String(track.duration % 60).padStart(2, '0')}` : '0:00',
                url: track.audioUrl || '',
                trackNumber: index + 1,
                subtitle: track.subtitle || '',
                summary: track.description || track.summary || '',
                image: track.image || album.image || '',
                explicit: track.explicit || false,
                keywords: track.keywords || [],
                v4vRecipient: track.v4vRecipient,
                v4vValue: track.v4vValue,
                guid: track.guid,
                id: track.id,
                startTime: track.startTime,
                endTime: track.endTime
              })),
              link: album.originalUrl || '',
              feedUrl: album.originalUrl || ''
            };
            console.log(`✅ Constructed album from ${playable.length} feed tracks`);
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
        feedUrl: albumData.feedUrl || albumData.link || '',
        feedId: albumData.feedId || albumData.id,
        feedGuid: albumData.feedGuid || undefined,
        v4vRecipient: albumData.v4vRecipient || undefined,
        v4vValue: albumData.v4vValue || undefined,
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

  // Sort albums based on selected sort option. Shared by the Albums and
  // Podcasts tabs — they are the same grid over a different half of the list.
  const sortAlbumList = useCallback((list: FavoriteAlbum[], albumSortBy: AlbumSort) => {
    const albums = [...list];

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
  }, []);

  const sortedAlbums = useMemo(
    () => sortAlbumList(favoriteAlbums, albumSortBy),
    [sortAlbumList, favoriteAlbums, albumSortBy]
  );
  const sortedPodcasts = useMemo(
    () => sortAlbumList(favoritePodcasts, albumSortBy),
    [sortAlbumList, favoritePodcasts, albumSortBy]
  );

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

  // Apply the type filter WITHIN each person, then drop anyone left with nothing.
  // (The old per-user dropdown is gone — people are the structure now.)
  const filteredCommunityPeople = useMemo(() => {
    if (communityFilter === 'all') return communityPeople;
    const wanted = communityFilter === 'tracks' ? 'track' : 'album';
    return communityPeople
      .map(person => ({
        ...person,
        favorites: person.favorites.filter(f => f.type === wanted),
      }))
      .filter(person => person.favorites.length > 0);
  }, [communityPeople, communityFilter]);

  const communityTotalFavorites = useMemo(
    () => filteredCommunityPeople.reduce((n, p) => n + p.favorites.length, 0),
    [filteredCommunityPeople]
  );

  const handleShufflePlay = async () => {
    if (favoriteTracks.length === 0) {
      toast.error('No tracks to shuffle');
      return;
    }

    // Shuffle the tracks array, excluding podcast episodes
    const shuffled = [...favoriteTracks]
      .filter(track => track.Feed?.type !== 'podcast')
      .sort(() => Math.random() - 0.5);

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
          v4vRecipient: track.v4vRecipient || track.Feed?.v4vRecipient || undefined,
          v4vValue: track.v4vValue || track.Feed?.v4vValue || undefined,
          guid: track.guid || undefined,
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
          v4vRecipient: track.v4vRecipient || track.Feed?.v4vRecipient || undefined,
          v4vValue: track.v4vValue || track.Feed?.v4vValue || undefined,
          guid: track.guid || undefined,
        }],
        link: '',
        feedUrl: track.Feed?.originalUrl || '',
        feedId: track.Feed?.id,
        feedGuid: (track.Feed as any)?.guid || undefined,
        v4vRecipient: track.Feed?.v4vRecipient || track.v4vRecipient || undefined,
        v4vValue: track.Feed?.v4vValue || track.v4vValue || undefined,
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
      <div className="h-[100dvh] flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <LoadingSpinner size="large" text="Loading favorites..." />
      </div>
    );
  }

  // Check if we have either a session or Nostr user
  const hasSession = sessionId || getSessionId();
  const hasUser = isNostrAuthenticated && nostrUser;

  if (!hasSession && !hasUser) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
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
      {/* The height must SUBTRACT the layout's player reservation. `app/layout.tsx`
          wraps every page in `pb-[var(--sk-player-reserve)]`, so a bare `h-[100dvh]`
          made the document taller than the viewport — the body then scrolled ~88-122px
          and dragged this "pinned" header off the top with it, which is exactly the
          bug this page was reported for. Subtracting it makes the document exactly one
          viewport tall, so only the inner list scrolls. */}
      <div className="h-[calc(100dvh-var(--sk-player-reserve))] flex flex-col bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white overflow-hidden">
      {/* Pinned block: Back/Home and the tabs only. The title, subtitle and sync
          button deliberately live in the scroll area below — pinning the whole header
          cost ~240px, roughly 30% of a phone screen. */}
      <div className="container mx-auto px-4 pt-safe-plus flex-shrink-0">
        <div className="mb-4 -ml-2 flex items-center gap-1">
          <BackButton />
          <HomeButton />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 sm:gap-4 border-b border-gray-700 overflow-x-auto scrollbar-hide -mx-4 px-4">
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
          {/* Podcasts only earn a tab once there is one — a cross-app list may
              hold none at all, and an empty tab is just noise on a music app. */}
          {favoritePodcasts.length > 0 && (
            <button
              onClick={() => handleTabChange('podcasts')}
              className={`px-3 sm:px-4 py-2 font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap flex-shrink-0 ${
                activeTab === 'podcasts'
                  ? 'text-white border-b-2 border-stablekraft-teal'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="text-sm sm:text-base">Podcasts</span>
              <span className="text-xs sm:text-sm text-gray-500">({favoritePodcasts.length})</span>
            </button>
          )}
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
      </div>

      {/* Scrollable content area. `data-scroll-container` tells BackToTop to drive
          this element instead of the window — the window does not scroll on this page,
          so the button would otherwise never appear and its click would do nothing. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-scroll-container>
        <div className="container mx-auto px-4 pt-6 pb-28">

        {/* Title block scrolls with the list; only Back/Home and the tabs stay pinned. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl sm:text-4xl font-bold mb-2 flex items-center gap-2 sm:gap-3">
              <Heart className="w-6 h-6 sm:w-10 sm:h-10 text-red-500 fill-red-500" />
              My Favorites
            </h1>
            <p className="text-sm sm:text-base text-gray-400">Your favorite tracks, albums, and publishers</p>

            {/* Inside the title block, directly under the subtitle, rather than
                as a row of its own below it. It is one quiet line about what
                happens to these favorites, so it belongs with the words that
                introduce them — and in the space beside the sync button, which
                was otherwise empty. Renders nothing when signed out or on a
                read-only nip05 session. Prerequisite for removing the trial
                allowlist — see the component. */}
            <SharedFavoritesDisclosure />
          </div>
          <SyncToNostrButton className="self-start sm:self-auto" />
        </div>

        {/* Sits directly under the sync control because that is what has
            actually stopped working — the favorites below are this device's
            copy and are fine. Renders nothing unless the last cross-app sync
            was degraded. See #194. */}
        <SharedFavoritesNotice />

        {/* Mounted HERE as well as in Settings › Nostr, because a conflict that
            can only be answered from a settings screen is a trap on a phone:
            the publish is held, nothing on /favorites says why, and the list
            simply stops syncing. Renders nothing when there is no conflict. */}
        <FavoritesModeConflictNotice />

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* Albums and Podcasts are the same grid over the two halves of the
            list, split by `<podcast:medium>`. Rendered from one block so a fix
            to the card mapping can't land on only one of them. */}
        {(activeTab === 'albums' || activeTab === 'podcasts') && (
          <div>
            {(activeTab === 'podcasts' ? favoritePodcasts : favoriteAlbums).length === 0 ? (
              <div className="text-center py-12">
                {activeTab === 'podcasts' ? (
                  <>
                    {/* Reachable by unfavoriting the last one while standing on
                        the tab, which then disappears from under you. */}
                    <Mic className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <h2 className="text-2xl font-bold mb-2">No Favorite Podcasts</h2>
                    <p className="text-gray-400 mb-4">
                      Podcasts you save in another app show up here.
                    </p>
                  </>
                ) : (
                  <>
                    <Disc className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <h2 className="text-2xl font-bold mb-2">No Favorite Albums & EPs</h2>
                    <p className="text-gray-400 mb-4">Start favoriting albums to see them here!</p>
                  </>
                )}
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
                    <option value="date-desc">Favorited (Newest)</option>
                    <option value="date-asc">Favorited (Oldest)</option>
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
                  {(activeTab === 'podcasts' ? sortedPodcasts : sortedAlbums).map((album) => {
                  const albumForCard = {
                    id: album.id,
                    title: album.title,
                    artist: album.artist || 'Unknown Artist',
                    description: album.description || '',
                    coverArt: album.image || '',
                    releaseDate: album.favoritedAt,
                    // `/api/favorites/albums` no longer sends a track list —
                    // it was 593 KB of a 1.27 MB load that nothing rendered.
                    // The card gets counts instead, and resolves the real
                    // tracks only when someone downloads or plays.
                    tracks: [],
                    trackCount: album.trackCount || 0,
                    downloadableTrackCount: (album as any).downloadableTrackCount ?? 0,
                    hasVideoTracks: (album as any).hasVideoTracks ?? false,
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
                    <option value="date-desc">Favorited (Newest)</option>
                    <option value="date-asc">Favorited (Oldest)</option>
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
                    albumCount: (publisher as any).itemCount ?? (publisher.Track?.length || 0)
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
                      <option value="date-desc">Favorited (Newest)</option>
                      <option value="date-asc">Favorited (Oldest)</option>
                      <option value="title-asc">Title (A-Z)</option>
                      <option value="title-desc">Title (Z-A)</option>
                      <option value="artist-asc">Artist (A-Z)</option>
                      <option value="artist-desc">Artist (Z-A)</option>
                    </select>
                    <label htmlFor="track-sort" className="text-xs sm:text-sm text-gray-400">
                      Sort by
                    </label>
                  </div>
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <PublishPlaylistButton tracks={sortedTracks} />
                    <button
                      onClick={handleShufflePlay}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-lg text-sm font-medium transition-all"
                      title="Shuffle play all tracks"
                    >
                      <Shuffle className="w-4 h-4" />
                      <span>Shuffle All</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {sortedTracks.map((track) => {
                    // Get v4v data from track or feed
                    const v4vValue = track.v4vValue || track.Feed?.v4vValue;
                    const v4vRecipient = track.v4vRecipient || track.Feed?.v4vRecipient;
                    const valueSplits = v4vValue?.recipients || v4vValue?.destinations || [];

                    return (
                      <div
                        key={track.id}
                        className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all border border-white/10"
                      >
                        {/* Album Art */}
                        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg overflow-hidden flex-shrink-0">
                          <ArtworkImage
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
                          // Never `|| track.id` — an internal id published as
                          // `podcast:item:guid` resolves nowhere (#242).
                          episodeGuid={track.guid || undefined}
                          remoteFeedGuid={(track.Feed as any)?.guid}
                          albumName={track.album || track.Feed?.title}
                          iconOnly={true}
                          className="w-8 h-8 sm:w-9 sm:h-9"
                        />

                        {/* Favorite Button */}
                        <FavoriteButton
                          trackId={track.id}
                          onToggle={handleFavoriteToggle(track.id)}
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
                    <option value="date-desc">Favorited (Newest)</option>
                    <option value="date-asc">Favorited (Oldest)</option>
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
                    const playlistSlugOverrides: Record<string, string> = {
                      'greatestHits-playlist': 'greatest-hits',
                    };
                    const playlistSlug = playlistSlugOverrides[playlist.id]
                      || playlist.id.replace('-playlist', '').toLowerCase();

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

        {/* Community Tab — grouped by person, not one flat chronological list */}
        {activeTab === 'community' && (
          <div>
            {/* Header with description and controls */}
            <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-400">
                  {filteredCommunityPeople.length > 0
                    ? `${filteredCommunityPeople.length} ${filteredCommunityPeople.length === 1 ? 'person' : 'people'} · ${communityTotalFavorites} ${communityTotalFavorites === 1 ? 'favorite' : 'favorites'}`
                    : 'Discover what others are favoriting'}
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

            {/* Error state — a relay outage is not an empty community, so it gets a retry */}
            {communityError && (
              <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-400 flex flex-col sm:flex-row sm:items-center gap-3">
                <span className="flex-1">{communityError}</span>
                <button
                  onClick={() => loadCommunityFavorites(true)}
                  className="self-start sm:self-auto px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-sm font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Loading state */}
            {communityLoading && filteredCommunityPeople.length === 0 && (
              <div className="text-center py-12">
                <LoadingSpinner size="large" text="Fetching from Nostr relays..." />
              </div>
            )}

            {/* Empty state */}
            {!communityLoading && filteredCommunityPeople.length === 0 && !communityError && (
              <div className="text-center py-12">
                <Globe className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <h2 className="text-2xl font-bold mb-2">No Community Favorites Yet</h2>
                <p className="text-gray-400 mb-4">
                  No one else has published favorites to Nostr yet.
                </p>
                <p className="text-gray-500 text-sm">
                  Start favoriting music and it will appear here for others!
                </p>
              </div>
            )}

            {/* One card per person */}
            {filteredCommunityPeople.length > 0 && (
              <div className="space-y-4">
                {filteredCommunityPeople.map((person) => {
                  const isExpanded = expandedPeople.has(person.pubkey);
                  const visible = isExpanded
                    ? person.favorites
                    : person.favorites.slice(0, COMMUNITY_PREVIEW_COUNT);
                  const hidden = person.favorites.length - visible.length;

                  return (
                    <div
                      key={person.pubkey}
                      className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden"
                    >
                      {/* Person header */}
                      <div className="flex items-center gap-3 p-3 sm:p-4 border-b border-white/10">
                        {person.avatar ? (
                          <ArtworkImage
                            src={person.avatar}
                            alt=""
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full flex-shrink-0 bg-gradient-to-br from-purple-500 to-pink-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <a
                            href={`https://njump.me/${person.npub}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-base truncate block hover:text-stablekraft-teal transition-colors"
                          >
                            {formatNpub(person.npub, person.displayName)}
                          </a>
                          <p className="text-gray-500 text-xs truncate">
                            {person.favorites.length}{' '}
                            {person.favorites.length === 1 ? 'favorite' : 'favorites'}
                            {person.mostRecentAt
                              ? ` · ${formatRelativeTime(person.mostRecentAt)}`
                              : ''}
                          </p>
                        </div>
                      </div>

                      {/* Their favorites */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 p-3 sm:p-4">
                        {visible.map((fav) => {
                          const count = fav.item.trackCount || 0;
                          const label =
                            fav.type === 'track' || count <= 1
                              ? 'Track'
                              : count <= 6
                                ? 'EP'
                                : 'Album';
                          const badgeClass =
                            label === 'Track'
                              ? 'bg-green-500/20 text-green-400'
                              : label === 'EP'
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'bg-blue-500/20 text-blue-400';
                          const href =
                            fav.type === 'album'
                              ? `/album/${fav.item.id}`
                              : `/album/${fav.item.feedId}`;

                          return (
                            <div key={fav.nostrEventId} className="group min-w-0">
                              <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-2">
                                <ArtworkImage
                                  src={getAlbumArtworkUrl(fav.item.image || '', 'thumbnail')}
                                  alt={fav.item.title}
                                  width={200}
                                  height={200}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = getPlaceholderImageUrl('thumbnail');
                                  }}
                                />
                                {/* Play covers the whole tile so the tap target is the
                                    artwork itself — hover-only controls are unreachable
                                    on touch, so it stays visible at rest on small screens. */}
                                <button
                                  onClick={() => playCommunityFavorite(fav)}
                                  aria-label={`Play ${fav.item.title}`}
                                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                >
                                  <span className="w-11 h-11 rounded-full bg-black/60 ring-1 ring-white/25 backdrop-blur-md flex items-center justify-center">
                                    <Play className="w-5 h-5 text-white" />
                                  </span>
                                </button>
                                <div className="absolute bottom-1.5 left-1.5 sm:hidden">
                                  <button
                                    onClick={() => playCommunityFavorite(fav)}
                                    aria-label={`Play ${fav.item.title}`}
                                    className="w-11 h-11 rounded-full bg-black/60 ring-1 ring-white/25 backdrop-blur-md flex items-center justify-center"
                                  >
                                    <Play className="w-[18px] h-[18px] text-white" />
                                  </button>
                                </div>
                                {/* Copy into your own favorites. The circle must BE the
                                    tap target — FavoriteButton renders its own
                                    padding-less <button>, so without the child selectors
                                    the real target is just the glyph. */}
                                {(fav.originalItemId || fav.item.singleTrack?.id) && (
                                  <div className="absolute top-1.5 right-1.5 w-11 h-11 rounded-full bg-black/50 ring-1 ring-white/20 backdrop-blur-md flex items-center justify-center [&>button]:w-full [&>button]:h-full [&>button]:rounded-full [&>button]:flex [&>button]:items-center [&>button]:justify-center">
                                    <FavoriteButton
                                      trackId={fav.type === 'track' ? fav.originalItemId : undefined}
                                      feedId={
                                        fav.type === 'album' && !fav.item.singleTrack
                                          ? fav.originalItemId
                                          : undefined
                                      }
                                      onToggle={handleCommunityFavoriteToggle(fav.nostrEventId)}
                                      singleTrackData={
                                        fav.item.singleTrack
                                          ? {
                                              id: fav.item.singleTrack.id,
                                              title: fav.item.singleTrack.title,
                                              artist: fav.item.artist,
                                            }
                                          : undefined
                                      }
                                    />
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${badgeClass}`}>
                                  {label}
                                </span>
                              </div>
                              <Link
                                href={href}
                                className="block font-medium text-sm truncate hover:text-stablekraft-teal transition-colors"
                                title={fav.item.title}
                              >
                                {fav.item.title}
                              </Link>
                              <p className="text-gray-400 text-xs truncate">
                                {fav.item.artist || 'Unknown Artist'}
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {/* One heavy favoriter must not bury everyone below them */}
                      {(hidden > 0 || isExpanded) && (
                        <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                          <button
                            onClick={() =>
                              setExpandedPeople((prev) => {
                                const next = new Set(prev);
                                if (next.has(person.pubkey)) next.delete(person.pubkey);
                                else next.add(person.pubkey);
                                return next;
                              })
                            }
                            className="text-sm text-gray-400 hover:text-white transition-colors py-2 px-1 -mx-1"
                          >
                            {isExpanded ? 'Show less' : `Show all ${person.favorites.length}`}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </div>
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
