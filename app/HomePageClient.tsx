'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';
import { RSSAlbum } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl, generatePublisherSlug } from '@/lib/url-utils';
import { getVersionString } from '@/lib/version';
import { useAudio } from '@/contexts/AudioContext';
import { AppError, ErrorCodes, ErrorCode, getErrorMessage, createErrorLogger } from '@/lib/error-utils';
import { toast } from '@/components/Toast';
import dynamic from 'next/dynamic';
import NowPlayingScreen from '@/components/NowPlayingScreen';

// Dynamic imports for heavy components with better loading states
const AlbumCard = dynamic(() => import('@/components/AlbumCardLazy'), {
  loading: () => (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 animate-pulse">
      <div className="aspect-square bg-gray-800/50 rounded-lg mb-3"></div>
      <div className="h-4 bg-gray-700/50 rounded mb-2"></div>
      <div className="h-3 bg-gray-700/50 rounded w-2/3"></div>
    </div>
  ),
  ssr: false // Disable SSR for better performance
});

const CDNImage = dynamic(() => import('@/components/CDNImageLazy'), {
  loading: () => (
    <div className="animate-pulse bg-gray-800/50 rounded flex items-center justify-center">
      <div className="w-6 h-6 bg-white/20 rounded-full animate-spin"></div>
    </div>
  ),
  ssr: false
});

const ControlsBar = dynamic(() => import('@/components/ControlsBarLazy'), {
  loading: () => (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 animate-pulse">
      <div className="h-8 bg-gray-700/50 rounded mb-2"></div>
      <div className="h-6 bg-gray-700/50 rounded w-1/2"></div>
    </div>
  ),
  ssr: false
});

// Error logging utility
const logError = createErrorLogger('HomePage');

// Development logging
const devLog = (message: string) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(message);
  }
};

devLog('🚀 Feeds will be loaded dynamically from /api/feeds endpoint');

export default function HomePageClient() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [albums, setAlbums] = useState<RSSAlbum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalFeedsCount, setTotalFeedsCount] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  
  // Progressive loading states
  const [criticalAlbums, setCriticalAlbums] = useState<RSSAlbum[]>([]);
  const [enhancedAlbums, setEnhancedAlbums] = useState<RSSAlbum[]>([]);
  const [isCriticalLoaded, setIsCriticalLoaded] = useState(false);
  const [isEnhancedLoaded, setIsEnhancedLoaded] = useState(false);
  const [publisherStats, setPublisherStats] = useState<{ name: string; feedGuid: string; albumCount: number }[]>([]);
  // Removed local nowPlayingOpen state - now managed in AudioContext
  const { isFullscreenMode, setFullscreenMode } = useAudio();
  
  // Performance optimization: Limit rendered albums for better scrolling
  const [visibleAlbumCount, setVisibleAlbumCount] = useState(50);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAlbums, setTotalAlbums] = useState(0);
  const [displayedAlbums, setDisplayedAlbums] = useState<RSSAlbum[]>([]);
  const [hasMoreAlbums, setHasMoreAlbums] = useState(true);
  const ALBUMS_PER_PAGE = 50; // Load 50 albums per page for better user experience
  const API_VERSION = 'v6'; // Increment to bust cache when API changes - v6 optimizes database queries
  
  // HGH filter removed - no longer needed
  
  // Global audio context
  const { playAlbum: globalPlayAlbum, shuffleAllTracks } = useAudio();
  const hasLoadedRef = useRef(false);
  
  // Static background state - Bloodshot Lies album art
  const [backgroundImageLoaded, setBackgroundImageLoaded] = useState(false);

  // Controls state
  const [activeFilter, setActiveFilter] = useState<'all' | 'featured' | 'recent'>('all');

  // Load more ref for intersection observer
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Set client-side flag
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Scroll detection for performance optimization
  useEffect(() => {
    let scrollTimer: NodeJS.Timeout;
    
    const handleScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        // Throttled scroll handling
      }, 100);
    };

    window.addEventListener('scroll', handleScroll);
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimer);
    };
  }, []);

  // Audio playback is now handled by the global AudioContext
  
  useEffect(() => {
    // Prevent multiple loads
    if (hasLoadedRef.current) {
      return;
    }
    
    hasLoadedRef.current = true;
    
    // Clear ALL old cache versions to prevent stale data issues
    if (typeof window !== 'undefined') {
      // Clear any old cache versions (pre-v4)
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('cachedAlbums_') || key.includes('albumsCacheTimestamp_'))) {
          // Only keep current version cache
          if (!key.includes(`_${API_VERSION}`)) {
            keysToRemove.push(key);
          }
        }
      }
      keysToRemove.forEach(key => {
        console.log('🗑️ Removing old cache:', key);
        localStorage.removeItem(key);
      });

      // Also clear current cache if it's stale (older than 15 minutes for better performance)
      const timestamp = localStorage.getItem(`albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`);
      if (timestamp) {
        const age = Date.now() - parseInt(timestamp);
        if (age > 15 * 60 * 1000) { // 15 minutes - increased for better performance
          localStorage.removeItem(`cachedAlbums_${ALBUMS_PER_PAGE}_${API_VERSION}`);
          localStorage.removeItem(`albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`);
        }
      }
    }
    
    // Progressive loading: Load critical data first, then enhance
    loadCriticalAlbums();
  }, []); // Run only once on mount

  // Delay background image loading until after critical content
  useEffect(() => {
    if (isCriticalLoaded) {
      const timer = setTimeout(() => {
        setBackgroundImageLoaded(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isCriticalLoaded]);

  // Load critical albums first for better perceived performance
  const loadCriticalAlbums = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Check cache first
      const cacheKey = `cachedAlbums_${ALBUMS_PER_PAGE}_${API_VERSION}`;
      const timestampKey = `albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`;
      
      if (typeof window !== 'undefined') {
        const cachedData = localStorage.getItem(cacheKey);
        const timestamp = localStorage.getItem(timestampKey);
        
        if (cachedData && timestamp) {
          const age = Date.now() - parseInt(timestamp);
          if (age < 15 * 60 * 1000) { // 15 minutes cache
            const parsedData = JSON.parse(cachedData);
            setAlbums(parsedData.albums || []);
            setTotalAlbums(parsedData.totalAlbums || 0);
            setPublisherStats(parsedData.publisherStats || []);
            setCriticalAlbums(parsedData.albums?.slice(0, 20) || []);
            setIsCriticalLoaded(true);
            setIsLoading(false);
            devLog('📦 Loaded from cache');
            return;
          }
        }
      }
      
      // Load from API
      const response = await fetch(`/api/feeds?page=${currentPage}&limit=${ALBUMS_PER_PAGE}&version=${API_VERSION}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      const fetchedAlbums = data.albums || [];
      setAlbums(fetchedAlbums);
      setTotalAlbums(data.totalAlbums || fetchedAlbums.length);
      setPublisherStats(data.publisherStats || []);
      
      // Set critical albums (first 20 for immediate display)
      setCriticalAlbums(fetchedAlbums.slice(0, 20));
      setIsCriticalLoaded(true);
      
      // Cache the data
      if (typeof window !== 'undefined') {
        localStorage.setItem(cacheKey, JSON.stringify({
          albums: fetchedAlbums,
          totalAlbums: data.totalAlbums || fetchedAlbums.length,
          publisherStats: data.publisherStats || []
        }));
        localStorage.setItem(timestampKey, Date.now().toString());
      }
      
      setIsLoading(false);
      devLog(`✅ Loaded ${fetchedAlbums.length} albums`);
      
    } catch (error) {
      logError.error('Failed to load albums', error);
      setError(getErrorMessage(error as Error));
      setIsLoading(false);
    }
  }, [currentPage, ALBUMS_PER_PAGE, API_VERSION]);

  // Load more albums when scrolling
  const loadMoreAlbums = useCallback(async () => {
    if (isLoadingMore || !hasMoreAlbums) return;
    
    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const response = await fetch(`/api/feeds?page=${nextPage}&limit=${ALBUMS_PER_PAGE}&version=${API_VERSION}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const newAlbums = data.albums || [];
      
      if (newAlbums.length === 0) {
        setHasMoreAlbums(false);
      } else {
        setAlbums(prev => [...prev, ...newAlbums]);
        setCurrentPage(nextPage);
      }
      
    } catch (error) {
      logError.error('Failed to load more albums', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentPage, ALBUMS_PER_PAGE, API_VERSION, isLoadingMore, hasMoreAlbums]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreAlbums && !isLoadingMore) {
          loadMoreAlbums();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => {
      if (loadMoreRef.current) {
        observer.unobserve(loadMoreRef.current);
      }
    };
  }, [loadMoreAlbums, hasMoreAlbums, isLoadingMore]);

  // Filter albums based on active filter
  const filteredAlbums = useMemo(() => {
    if (activeFilter === 'all') return albums;
    if (activeFilter === 'featured') return albums.slice(0, 20); // First 20 as featured
    if (activeFilter === 'recent') return albums.slice(0, 50); // Most recent 50
    return albums;
  }, [albums, activeFilter]);

  // Display albums with pagination
  const displayedAlbumsToShow = useMemo(() => {
    return filteredAlbums.slice(0, visibleAlbumCount);
  }, [filteredAlbums, visibleAlbumCount]);

  // Handle album play
  const handlePlayAlbum = useCallback(async (album: RSSAlbum) => {
    try {
      const success = await globalPlayAlbum(album);
      if (success) {
        toast.success(`Now playing: ${album.title}`);
      } else {
        toast.error('Failed to play album');
      }
    } catch (error) {
      logError.error('Error playing album', error);
      toast.error('Error playing album');
    }
  }, [globalPlayAlbum]);

  // Handle shuffle all
  const handleShuffleAll = useCallback(async () => {
    try {
      const success = await shuffleAllTracks();
      if (success) {
        toast.success('Shuffling all tracks');
      } else {
        toast.error('Failed to shuffle tracks');
      }
    } catch (error) {
      logError.error('Error shuffling tracks', error);
      toast.error('Error shuffling tracks');
    }
  }, [shuffleAllTracks]);

  if (!isClient) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Background Image - Lazy loaded for better performance */}
      <div 
        className="fixed inset-0 z-0"
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          opacity: 0.8
        }}
      />
      
      {/* Background image loads after critical content */}
      <div 
        className="fixed inset-0 z-0 opacity-0 transition-opacity duration-1000"
        id="background-image"
        style={{
          backgroundImage: backgroundImageLoaded ? 'url(/bloodshot-lies-background.jpg)' : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      />

      {/* Main Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="bg-black/20 backdrop-blur-sm border-b border-white/10">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/" className="text-2xl font-bold text-white hover:text-purple-400 transition-colors">
                  FUCKIT Music
                </Link>
                <span className="text-sm text-gray-400">v{getVersionString()}</span>
              </div>
              
              <nav className="hidden md:flex items-center gap-6">
                <Link href="/music-tracks" className="text-gray-300 hover:text-white transition-colors">
                  Music Tracks
                </Link>
                <Link href="/library" className="text-gray-300 hover:text-white transition-colors">
                  Library
                </Link>
                <Link href="/playlist" className="text-gray-300 hover:text-white transition-colors">
                  Playlists
                </Link>
                <Link href="/about" className="text-gray-300 hover:text-white transition-colors">
                  About
                </Link>
              </nav>
              
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="md:hidden p-2 text-gray-300 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-8">
          {/* Loading State */}
          {isLoading && (
            <div className="text-center py-12">
              <LoadingSpinner />
              <p className="text-gray-400 mt-4">Loading albums...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
              <h2 className="text-xl font-bold text-red-400 mb-2">Error Loading Albums</h2>
              <p className="text-gray-300 mb-4">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Albums Grid */}
          {!isLoading && !error && (
            <>
              {/* Controls */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-3xl font-bold text-white">Music Albums</h1>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={handleShuffleAll}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                    >
                      Shuffle All
                    </button>
                  </div>
                </div>
                
                {/* Filter Buttons */}
                <div className="flex gap-2 mb-6">
                  {(['all', 'featured', 'recent'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={`px-4 py-2 rounded-lg transition-colors ${
                        activeFilter === filter
                          ? 'bg-purple-600 text-white'
                          : 'bg-white/10 text-gray-300 hover:bg-white/20'
                      }`}
                    >
                      {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Albums Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  {displayedAlbumsToShow.map((album) => (
                    <AlbumCard
                      key={`${album.feedId}-${album.id}`}
                      album={album}
                      onPlay={() => handlePlayAlbum(album)}
                    />
                  ))}
              </div>

              {/* Load More Trigger */}
              {hasMoreAlbums && (
                <div ref={loadMoreRef} className="text-center py-8">
                  {isLoadingMore ? (
                    <LoadingSpinner />
                  ) : (
                    <button
                      onClick={loadMoreAlbums}
                      className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
                    >
                      Load More Albums
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Now Playing Screen */}
      <NowPlayingScreen />
    </div>
  );
}
