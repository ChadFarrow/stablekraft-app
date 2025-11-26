'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';
import { RSSAlbum } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl, generatePublisherSlug } from '@/lib/url-utils';
import { useAudio } from '@/contexts/AudioContext';
import { AppError, ErrorCodes, ErrorCode, getErrorMessage, createErrorLogger } from '@/lib/error-utils';
import { toast } from '@/components/Toast';
import dynamic from 'next/dynamic';
import SearchBar from '@/components/SearchBar';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import { Play, Pause } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import FavoriteButton from '@/components/favorites/FavoriteButton';



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
    <div className="mb-8 p-4 bg-gray-800/20 rounded-lg animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-8 bg-gray-700/50 rounded w-24"></div>
        <div className="h-8 bg-gray-700/50 rounded w-20"></div>
        <div className="h-8 bg-gray-700/50 rounded w-16"></div>
        <div className="h-8 bg-gray-700/50 rounded w-20"></div>
      </div>
    </div>
  ),
  ssr: false // Disable SSR for better performance
});

// Lazy load the fullscreen Now Playing Screen - only loaded when user opens it
const NowPlayingScreen = dynamic(() => import('@/components/NowPlayingScreen'), {
  loading: () => (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="text-white text-lg">Loading...</div>
    </div>
  ),
  ssr: false // Client-side only component
});

// Loading skeleton component for better UX
const LoadingSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-4 animate-pulse">
        <div className="aspect-square bg-gray-800/50 rounded-lg mb-3"></div>
        <div className="h-4 bg-gray-700/50 rounded mb-2"></div>
        <div className="h-3 bg-gray-700/50 rounded w-2/3"></div>
      </div>
    ))}
  </div>
);

// Import types from the original component
import type { FilterType, ViewType, SortType } from '@/components/ControlsBar';
// RSS feed configuration - CDN removed, using original URLs directly

// Development logging utility - disabled for performance
const devLog = (...args: any[]) => {
  // Disabled for performance
};

const verboseLog = (...args: any[]) => {
  // Disabled for performance
};

// RSS feed URLs - hardcoded for client-side compatibility
// All CDN URLs removed, using original URLs directly

// Feed URLs are now loaded dynamically from /api/feeds endpoint
// This ensures feeds are always up-to-date with data/feeds.json

// Debug logging - Performance optimization info
devLog('🚀 PERFORMANCE OPTIMIZATION ENABLED - Dynamic feed loading');
devLog('🔧 Environment check:', { NODE_ENV: process.env.NODE_ENV });
devLog('🚀 Feeds will be loaded dynamically from /api/feeds endpoint');

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { shouldPreventClick } = useScrollDetectionContext();
  const [isLoading, setIsLoading] = useState(true);
  const [albums, setAlbums] = useState<RSSAlbum[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [totalFeedsCount, setTotalFeedsCount] = useState(0);
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
  const API_VERSION = 'v10'; // Increment to bust cache when API changes - v10 includes V4V fields + AudioContext version check
  
  // HGH filter removed - no longer needed
  
  // Global audio context
  const { playAlbum: globalPlayAlbum, shuffleAllTracks } = useAudio();
  const hasLoadedRef = useRef(false);
  const isUpdatingFromUrlRef = useRef(false); // Track if we're updating from URL to avoid loops
  

  
  // Static background state - Bloodshot Lies album art
  const [backgroundImageLoaded, setBackgroundImageLoaded] = useState(false);

  // Controls state - Initialize from URL params if available
  const getInitialFilter = (): FilterType => {
    if (typeof window === 'undefined') return 'all';
    const urlFilter = searchParams?.get('filter');
    const validFilters: FilterType[] = ['all', 'albums', 'eps', 'singles', 'publishers', 'playlist'];
    if (urlFilter && validFilters.includes(urlFilter as FilterType)) {
      return urlFilter as FilterType;
    }
    return 'all';
  };
  const [activeFilter, setActiveFilter] = useState<FilterType>(getInitialFilter());

  // Store handleFilterChange in a ref to avoid dependency issues
  const handleFilterChangeRef = useRef<((newFilter: FilterType, skipUrlUpdate?: boolean) => Promise<void>) | null>(null);
  
  // Sync filter from URL params when URL changes (e.g., browser back button)
  useEffect(() => {
    const urlFilter = searchParams?.get('filter');
    const validFilters: FilterType[] = ['all', 'albums', 'eps', 'singles', 'publishers', 'playlist'];
    const newFilter = (urlFilter && validFilters.includes(urlFilter as FilterType))
      ? (urlFilter as FilterType)
      : 'all';

    // Check if we need to reload data:
    // 1. Filter changed, OR
    // 2. Filter is the same but we don't have data for it (especially important for back navigation)
    const hasDataForFilter = displayedAlbums.length > 0 || enhancedAlbums.length > 0 || criticalAlbums.length > 0;
    const needsReload = newFilter !== activeFilter || (newFilter === activeFilter && !hasDataForFilter && !isLoading);

    // Only update if needed and we're not already updating from URL
    if (needsReload && !isUpdatingFromUrlRef.current && handleFilterChangeRef.current) {
      console.log(`🔄 URL filter changed: "${activeFilter}" -> "${newFilter}" (hasData: ${hasDataForFilter})`);
      isUpdatingFromUrlRef.current = true;
      // Trigger filter change with skipUrlUpdate to avoid loop
      handleFilterChangeRef.current(newFilter, true).finally(() => {
        // Reset the flag after filter change completes
        setTimeout(() => {
          isUpdatingFromUrlRef.current = false;
        }, 100);
      });
    }
  }, [searchParams, activeFilter, displayedAlbums.length, enhancedAlbums.length, criticalAlbums.length, isLoading]);
  
  const [viewType, setViewType] = useState<ViewType>('grid');
  const [sortType, setSortType] = useState<SortType>('name');
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  
  // Cache for filter data to avoid re-fetching
  const [filterCache, setFilterCache] = useState<Map<FilterType, any>>(new Map());

  // Test feeds state


  // Shuffle functionality is now handled by the global AudioContext
  const handleShuffle = async () => {
    try {
      console.log('🎲 Shuffle button clicked - starting shuffle all tracks');
      await shuffleAllTracks();
    } catch (error) {
      console.error('Error starting shuffle:', error);
    }
  };

  // Ref for the sentinel element that triggers loading
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsClient(true);
    
    // Add scroll detection for mobile
    let scrollTimer: NodeJS.Timeout;
    const handleScroll = () => {
      document.body.classList.add('is-scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        document.body.classList.remove('is-scrolling');
      }, 150);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
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


  // Load publisher stats separately to ensure they're always available, even when using cache
  useEffect(() => {
    const loadPublisherStats = async () => {
      // Only load if not already loaded
      if (publisherStats.length > 0) return;

      try {
        const response = await fetch('/api/albums-fast?limit=1&offset=0&tier=all&filter=all');
        if (response.ok) {
          const data = await response.json();
          const stats = data.publisherStats || [];
          if (stats.length > 0) {
            setPublisherStats(stats);
            console.log(`📊 Loaded ${stats.length} publisher stats separately`);
          }
        }
      } catch (error) {
        console.error('Error loading publisher stats:', error);
      }
    };

    // Load after a short delay to allow main content to load first
    const timer = setTimeout(loadPublisherStats, 500);
    return () => clearTimeout(timer);
  }, [publisherStats.length]);


  // Delay background image loading until after critical content
  useEffect(() => {
    // Only start loading background after critical albums are loaded
    if (isCriticalLoaded && !backgroundImageLoaded) {
      const timer = setTimeout(() => {
        // Load background image after critical content
        const bgElement = document.getElementById('background-image');
        if (bgElement) {
          bgElement.style.opacity = '0.6';
          setBackgroundImageLoaded(true);
        }
      }, 1000); // Delay after critical content loads
      
      return () => clearTimeout(timer);
    }
  }, [isCriticalLoaded, backgroundImageLoaded]);



  // Optimized loading: Load all data in one request with prioritized display
  const loadCriticalAlbums = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setLoadingProgress(0);

      // Handle publishers filter separately - redirect to handleFilterChange
      if (activeFilter === 'publishers') {
        console.log(`🔄 loadCriticalAlbums: Redirecting ${activeFilter} filter to handleFilterChange`);
        setIsLoading(false);
        await handleFilterChange(activeFilter, true); // skipUrlUpdate = true to avoid conflicts
        return;
      }

      // OPTIMIZED: Load albums in single API call (includes totalCount in response)
      // Removed redundant count query - totalCount is now included in albums response
      const startIndex = (currentPage - 1) * ALBUMS_PER_PAGE;
      const { albums: pageAlbums, totalCount } = await loadAlbumsData('all', ALBUMS_PER_PAGE, startIndex, activeFilter);
      
      // Update total albums count from API response (for pagination)
      setTotalAlbums(totalCount);
      
      // For all filters, show first 12 items in server-provided order
      setCriticalAlbums(pageAlbums.slice(0, 12));

      setEnhancedAlbums(pageAlbums);
      setDisplayedAlbums(pageAlbums);
      setAlbums(pageAlbums); // Also set the main albums state
      
      // Use totalCount to correctly determine if there are more albums
      // If we got a full page (50 albums) and there's more than what we loaded, there are more
      setHasMoreAlbums(pageAlbums.length >= ALBUMS_PER_PAGE && pageAlbums.length < totalCount);
      setIsCriticalLoaded(true);
      setIsEnhancedLoaded(true);
      setLoadingProgress(100);
      setIsLoading(false);
      
    } catch (error) {
      setError('Failed to load albums');
      setIsLoading(false);
    }
  };

  // Remove separate enhanced loading function since we load all at once
  const loadEnhancedAlbums = () => {
    // This function is now handled in loadCriticalAlbums
  };

  // Load more function to append albums instead of replacing
  const loadMoreAlbums = useCallback(async () => {
    if (isLoading || !hasMoreAlbums) return;

    // Don't load more for publishers filter - all publishers are already loaded
    if (activeFilter === 'publishers') {
      console.log(`🚫 loadMoreAlbums: Skipping - all publishers already loaded for ${activeFilter} filter`);
      return;
    }

    setIsLoading(true);
    const nextPage = currentPage + 1;

      try {
        // Load next page from API (server-side sorted globally: Albums → EPs → Singles)
        const startIndex = (nextPage - 1) * ALBUMS_PER_PAGE;
        const { albums: newAlbums, totalCount: newTotalCount } = await loadAlbumsData('all', ALBUMS_PER_PAGE, startIndex, activeFilter);
        
        // Update totalAlbums if we got a new total count (should be the same, but ensure consistency)
        if (newTotalCount > 0) {
          setTotalAlbums(newTotalCount);
        }
        
        if (newAlbums.length > 0) {
          // Append new albums to existing ones (already sorted globally from server)
          // The API returns albums in correct global order: Albums → EPs → Singles
          setDisplayedAlbums(prev => {
            const updated = [...prev, ...newAlbums];
            const totalLoaded = updated.length;
            // Check if there are more albums:
            // 1. If we loaded fewer albums than requested, we've reached the end
            // 2. Otherwise, check if total loaded is less than total count
            const hasMore = newAlbums.length >= ALBUMS_PER_PAGE && totalLoaded < newTotalCount;
            console.log(`📊 Pagination check: loaded=${newAlbums.length}, totalLoaded=${totalLoaded}, totalCount=${newTotalCount}, hasMore=${hasMore}`);
            setHasMoreAlbums(hasMore);
            return updated;
          });
          setCurrentPage(nextPage);
        } else {
          console.log('📊 No more albums returned, stopping pagination');
          setHasMoreAlbums(false);
        }
    } catch (error) {
      console.error('Error loading more albums:', error);
      setError('Failed to load more albums');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMoreAlbums, currentPage, activeFilter, totalAlbums, displayedAlbums.length]);
  
  // Keep loadPage for backward compatibility (used by pagination buttons)
  const loadPage = async (page: number) => {
    // This function is no longer used but kept for compatibility
  };

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current) return;
    
    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        console.log(`👁 Intersection: isIntersecting=${target.isIntersecting}, hasMore=${hasMoreAlbums}, loading=${isLoading}, enhanced=${isEnhancedLoaded}`);
        if (target.isIntersecting && hasMoreAlbums && !isLoading && isEnhancedLoaded) {
          console.log('📄 Triggering loadMoreAlbums');
          loadMoreAlbums();
        }
      },
      {
        root: null,
        rootMargin: '100px', // Start loading 100px before reaching the sentinel
        threshold: 0.1
      }
    );

    observer.observe(loadMoreRef.current);

    return () => {
      if (loadMoreRef.current) {
        observer.unobserve(loadMoreRef.current);
      }
    };
  }, [hasMoreAlbums, isLoading, isEnhancedLoaded, loadMoreAlbums]);

  // Handle filter changes - reload data and reset to page 1
  const handleFilterChange = async (newFilter: FilterType, skipUrlUpdate = false) => {
    console.log(`🔄 handleFilterChange called with filter: "${newFilter}"`);

    // Check if filter is the same AND we already have data
    if (newFilter === activeFilter) {
      const hasData = displayedAlbums.length > 0 || enhancedAlbums.length > 0 || criticalAlbums.length > 0;
      if (hasData) {
        console.log(`🚫 Filter unchanged and data exists, skipping reload`);
        return;
      }
      console.log(`⚠️ Filter unchanged but no data, continuing to load`);
    }

    // Update URL with new filter (unless we're updating from URL change)
    if (!skipUrlUpdate && !isUpdatingFromUrlRef.current) {
      const params = new URLSearchParams(searchParams?.toString() || '');
      if (newFilter === 'all') {
        params.delete('filter');
      } else {
        params.set('filter', newFilter);
      }
      const newUrl = params.toString() ? `/?${params.toString()}` : '/';
      router.push(newUrl, { scroll: false });
    }

    // Check cache first
    const cachedData = filterCache.get(newFilter);
    if (cachedData) {
      console.log(`📦 Using cached data for filter: ${newFilter}`);
      setActiveFilter(newFilter);
      setCurrentPage(1);
      setDisplayedAlbums(cachedData.albums);
      setCriticalAlbums(cachedData.albums.slice(0, 12));
      setEnhancedAlbums(cachedData.albums);
      setTotalAlbums(cachedData.totalCount);
      setHasMoreAlbums(cachedData.hasMore);
      setIsCriticalLoaded(true);
      setIsEnhancedLoaded(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setActiveFilter(newFilter);
    setCurrentPage(1); // Reset to first page
    setIsFilterLoading(true);
    setIsLoading(true);
    
    try {
      let resultData;

      if (newFilter === 'publishers') {
        console.log(`🎯 handleFilterChange: Processing ${newFilter} filter`);
        // Load publishers instead of albums
        const publishersResponse = await fetch('/api/publishers');
        if (!publishersResponse.ok) {
          throw new Error(`Publishers API failed: ${publishersResponse.status}`);
        }
        const publishersData = await publishersResponse.json();
        const publishers = publishersData.publishers || [];
        console.log(`🎯 handleFilterChange: Received ${publishers.length} publishers from API`);
        
        // Update publisher stats for sidebar from publishers data
        const publisherStatsFromPublishers = publishers.map((publisher: any) => ({
          name: publisher.title,
          feedGuid: publisher.feedGuid || publisher.id,
          albumCount: publisher.itemCount || 0
        }));
        setPublisherStats(publisherStatsFromPublishers);
        
        // Convert publishers to album-like format for display
        const publisherAlbums = publishers.map((publisher: any) => {
          // Use generatePublisherSlug to create clean URLs from artist names
          const publisherSlug = generatePublisherSlug({ 
            title: publisher.title, 
            artist: publisher.title,
            feedGuid: publisher.feedGuid || publisher.id 
          });
          
          return {
            id: publisher.id,
            feedId: publisher.id, // Add feedId for favorite button (use publisher ID)
            title: publisher.title,
            artist: publisher.title,
            description: publisher.description || `${publisher.itemCount} releases`,
            coverArt: publisher.image,
            tracks: Array(publisher.totalTracks || 1).fill(null).map((_, i) => ({
              id: `track-${i}`,
              title: `Track ${i + 1}`,
              duration: '0:00',
              url: publisher.originalUrl
            })),
            releaseDate: new Date().toISOString(),
            link: `/publisher/${publisherSlug}`,
            feedUrl: publisher.originalUrl,
            isPublisherCard: true,
            publisherUrl: `/publisher/${publisherSlug}`,
            albumCount: publisher.itemCount,
            totalTracks: publisher.totalTracks
          };
        });
        
        resultData = {
          albums: publisherAlbums,
          totalCount: publishers.length,
          hasMore: false
        };
      } else if (newFilter === 'playlist') {
        // Special handling for playlist filter - multiple playlists
        const { albums: pageAlbums, totalCount } = await loadAlbumsData('all', ALBUMS_PER_PAGE, 0, newFilter);
        
        resultData = {
          albums: pageAlbums,
          totalCount: totalCount,
          hasMore: pageAlbums.length < totalCount
        };
      } else {
        // Parallel fetch for count and data
        const [totalCountResponse, albumsResult] = await Promise.all([
          fetch(`/api/albums-fast?limit=1&offset=0&filter=${newFilter}`),
          loadAlbumsData('all', ALBUMS_PER_PAGE, 0, newFilter)
        ]);
        
        const totalCountData = await totalCountResponse.json();
        const totalCountFromAPI = totalCountData.totalCount || 0;
        const { albums: pageAlbums, totalCount } = albumsResult;
        
        // Use the totalCount from loadAlbumsData (more accurate) or fall back to API count
        const finalTotalCount = totalCount > 0 ? totalCount : totalCountFromAPI;
        
        resultData = {
          albums: pageAlbums,
          totalCount: finalTotalCount,
          hasMore: pageAlbums.length < finalTotalCount
        };
      }
      
      // Cache the result
      setFilterCache(prev => new Map(prev).set(newFilter, resultData));
      
      // Apply the data
      setTotalAlbums(resultData.totalCount);
      setCriticalAlbums(resultData.albums.slice(0, 12));
      setEnhancedAlbums(resultData.albums);
      setDisplayedAlbums(resultData.albums);
      setHasMoreAlbums(resultData.hasMore);
      setIsCriticalLoaded(true);
      setIsEnhancedLoaded(true);
      
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('❌ handleFilterChange error:', error);
      console.error('❌ Filter was:', newFilter);
      setError(`Failed to load ${newFilter} data: ${error}`);
    } finally {
      setIsFilterLoading(false);
      setIsLoading(false);
    }
  };

  // Store handleFilterChange in ref for use in URL sync effect
  useEffect(() => {
    handleFilterChangeRef.current = handleFilterChange;
  }, [handleFilterChange]);

  // Calculate pagination info
  const totalPages = Math.ceil(totalAlbums / ALBUMS_PER_PAGE);
  const loadedAlbumsCount = displayedAlbums.length;

  const loadAlbumsData = async (loadTier: 'core' | 'extended' | 'lowPriority' | 'all' = 'all', limit: number = 50, offset: number = 0, filter: string = 'all'): Promise<{ albums: RSSAlbum[]; totalCount: number }> => {
    try {
      // Handle publishers filter separately - don't call albums API for publishers
      if (filter === 'publishers') {
        console.log(`⚠️ loadAlbumsData called with ${filter} filter - this should be handled by handleFilterChange`);
        return { albums: [], totalCount: 0 }; // Return empty array to prevent showing wrong data
      }

      // Handle playlist filter separately - use fast endpoint for better performance
      if (filter === 'playlist') {
        console.log('🎵 Loading playlists using fast endpoint...');

        try {
          const response = await fetch('/api/playlists-fast');
          
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.albums) {
              console.log(`✅ Loaded ${data.albums.length} playlists from fast endpoint`);
              return { albums: data.albums, totalCount: data.albums.length };
            }
          }
          
          console.warn('⚠️ Fast playlist endpoint failed, falling back to individual APIs');
          
          // Fallback to individual playlist APIs if fast endpoint fails
          const [upbeatsResponse, b4tsResponse, itdvResponse, hghResponse, iamResponse, mmmResponse, mmtResponse, sasResponse, flowgnarResponse] = await Promise.allSettled([
            fetch('/api/playlist/upbeats'),
            fetch('/api/playlist/b4ts'),
            fetch('/api/playlist/itdv'),
            fetch('/api/playlist/hgh'),
            fetch('/api/playlist/iam'),
            fetch('/api/playlist/mmm'),
            fetch('/api/playlist/mmt'),
            fetch('/api/playlist/sas'),
            fetch('/api/playlist/flowgnar')
          ]);

          const allAlbums: any[] = [];

          // Process Upbeats playlist
          if (upbeatsResponse.status === 'fulfilled' && upbeatsResponse.value.ok) {
            const upbeatsData = await upbeatsResponse.value.json();
            if (upbeatsData.success && upbeatsData.albums) {
              allAlbums.push(...upbeatsData.albums);
              console.log(`✅ Loaded ${upbeatsData.albums.length} Upbeats playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load Upbeats playlist');
          }

          // Process B4TS playlist
          if (b4tsResponse.status === 'fulfilled' && b4tsResponse.value.ok) {
            const b4tsData = await b4tsResponse.value.json();
            if (b4tsData.success && b4tsData.albums) {
              allAlbums.push(...b4tsData.albums);
              console.log(`✅ Loaded ${b4tsData.albums.length} B4TS playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load B4TS playlist');
          }

          // Process ITDV playlist
          if (itdvResponse.status === 'fulfilled' && itdvResponse.value.ok) {
            const itdvData = await itdvResponse.value.json();
            if (itdvData.success && itdvData.albums) {
              allAlbums.push(...itdvData.albums);
              console.log(`✅ Loaded ${itdvData.albums.length} ITDV playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load ITDV playlist');
          }

          // Process HGH playlist
          if (hghResponse.status === 'fulfilled' && hghResponse.value.ok) {
            const hghData = await hghResponse.value.json();
            if (hghData.success && hghData.albums) {
              allAlbums.push(...hghData.albums);
              console.log(`✅ Loaded ${hghData.albums.length} HGH playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load HGH playlist');
          }

          // Process IAM playlist
          if (iamResponse.status === 'fulfilled' && iamResponse.value.ok) {
            const iamData = await iamResponse.value.json();
            if (iamData.success && iamData.albums) {
              allAlbums.push(...iamData.albums);
              console.log(`✅ Loaded ${iamData.albums.length} IAM playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load IAM playlist');
          }

          // Process MMM playlist
          if (mmmResponse.status === 'fulfilled' && mmmResponse.value.ok) {
            const mmmData = await mmmResponse.value.json();
            if (mmmData.success && mmmData.albums) {
              allAlbums.push(...mmmData.albums);
              console.log(`✅ Loaded ${mmmData.albums.length} MMM playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load MMM playlist');
          }

          // Process Flowgnar playlist
          if (flowgnarResponse.status === 'fulfilled' && flowgnarResponse.value.ok) {
            const flowgnarData = await flowgnarResponse.value.json();
            if (flowgnarData.success && flowgnarData.albums) {
              allAlbums.push(...flowgnarData.albums);
              console.log(`✅ Loaded ${flowgnarData.albums.length} Flowgnar playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load Flowgnar playlist');
          }

          // Process MMT playlist
          if (mmtResponse.status === 'fulfilled' && mmtResponse.value.ok) {
            const mmtData = await mmtResponse.value.json();
            if (mmtData.success && mmtData.albums) {
              allAlbums.push(...mmtData.albums);
              console.log(`✅ Loaded ${mmtData.albums.length} MMT playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load MMT playlist');
          }

          // Process SAS playlist
          if (sasResponse.status === 'fulfilled' && sasResponse.value.ok) {
            const sasData = await sasResponse.value.json();
            if (sasData.success && sasData.albums) {
              allAlbums.push(...sasData.albums);
              console.log(`✅ Loaded ${sasData.albums.length} SAS playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load SAS playlist');
          }

          return { albums: allAlbums, totalCount: allAlbums.length };
          
        } catch (error) {
          console.error('❌ Error loading playlists:', error);
          return { albums: [], totalCount: 0 };
        }
      }
      
      // Simplified caching - only cache the main 'all' request with no filtering
      if (typeof window !== 'undefined' && loadTier === 'all' && offset === 0 && filter === 'all') {
        const cached = localStorage.getItem(`cachedAlbums_${ALBUMS_PER_PAGE}_${API_VERSION}`);
        const timestamp = localStorage.getItem(`albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`);
        
        if (cached && timestamp) {
          const age = Date.now() - parseInt(timestamp);
          if (age < 15 * 60 * 1000) { // 15 minutes cache for better performance
            console.log('📦 Using cached albums');
            const cachedAlbums = JSON.parse(cached);
            // For cached data, we need to estimate totalCount - use a large number to allow pagination
            // The actual totalCount will be updated from the next API call
            return { albums: cachedAlbums, totalCount: cachedAlbums.length >= ALBUMS_PER_PAGE ? 10000 : cachedAlbums.length };
          }
        }
      }

      // Fetch pre-parsed album data from the optimized API endpoint with pagination
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        tier: loadTier,
        filter: filter
        // Remove cache busting for better performance
      });
      
      console.log(`🌐 Fetching: /api/albums-fast?${params}`);
      const response = await fetch(`/api/albums-fast?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ API Error: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const albums = data.albums || [];
      const totalCount = data.totalCount || 0;
      const publisherStatsFromAPI = data.publisherStats || [];
      
      // Update total albums count from API response (for pagination)
      setTotalAlbums(totalCount);
      
      // Update publisher stats from API response - always use albums API when available
      if (publisherStatsFromAPI.length > 0) {
        setPublisherStats(publisherStatsFromAPI);
      }
      
      // Skip music tracks processing for initial load performance
      // Music tracks can be loaded separately if needed
      const allAlbums = albums;
      
      setLoadingProgress(75);
      
      // Convert to RSSAlbum format for compatibility
      let rssAlbums: RSSAlbum[] = allAlbums.map((album: any): RSSAlbum => ({
        title: album.title,
        artist: album.artist,
        description: album.description,
        coverArt: album.coverArt,
        releaseDate: album.releaseDate || album.lastUpdated || new Date().toISOString(),
        tracks: album.tracks.map((track: any) => ({
          title: track.title,
          duration: track.duration,
          url: track.url,
          trackNumber: track.trackNumber,
          subtitle: track.subtitle,
          summary: track.summary,
          image: track.image,
          explicit: track.explicit,
          keywords: track.keywords,
          // Include V4V fields for Lightning payments
          v4vRecipient: track.v4vRecipient,
          v4vValue: track.v4vValue,
          guid: track.guid,
          id: track.id,
          startTime: track.startTime,
          endTime: track.endTime
        })),
        publisher: album.publisher,
        podroll: album.podroll,
        funding: album.funding,
        feedId: album.feedId,
        feedUrl: album.feedUrl,
        feedGuid: album.feedGuid,
        // Include V4V payment data for boost buttons
        ...(album.v4vRecipient && { v4vRecipient: album.v4vRecipient }),
        ...(album.v4vValue && { v4vValue: album.v4vValue })
      } as RSSAlbum));
      
      // Apply limit if specified (for critical loading)
      if (limit && limit > 0) {
        rssAlbums = rssAlbums.slice(0, limit);
      }
      
      // Cache only the main 'all' request for performance - but only if we have publisher stats
      if (typeof window !== 'undefined' && loadTier === 'all' && offset === 0 && filter === 'all' && publisherStatsFromAPI.length > 0) {
        try {
          localStorage.setItem(`cachedAlbums_${ALBUMS_PER_PAGE}_${API_VERSION}`, JSON.stringify(rssAlbums));
          localStorage.setItem(`albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`, Date.now().toString());
          console.log(`💾 Cached ${rssAlbums.length} albums with ${publisherStatsFromAPI.length} publisher stats`);
        } catch (error) {
          console.warn('⚠️ Failed to cache albums:', error);
        }
      }
      
      return { albums: rssAlbums, totalCount };
      
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      console.error('❌ Error loading main feed tracks:', err);
      setError(`Error loading main feed tracks: ${errorMessage}`);
      toast.error(`Failed to load albums: ${errorMessage}`);
      return { albums: [], totalCount: 0 };
    } finally {
      setIsLoading(false);
    }
  };

  const loadMusicTracksFromRSS = async (limit: number = 50) => {
    try {
      // Load music tracks from the RSS feed with pagination for performance
      const response = await fetch(`/api/tracks?limit=${limit}&page=1`);
      if (!response.ok) {
        console.warn('Failed to load music tracks from RSS');
        return [];
      }
      
      const data = await response.json();
      return data.data?.tracks || [];
    } catch (error) {
      console.warn('Error loading music tracks from RSS:', error);
      return [];
    }
  };



  const convertMusicTracksToAlbums = (tracks: any[]) => {
    // Filter out low-quality tracks (HTML fragments, very short titles, etc.)
    const qualityTracks = tracks.filter((track: any) => {
      // Skip tracks with HTML-like content
      if (track.title.includes('<') || track.title.includes('>') || track.title.includes('&')) {
        return false;
      }
      
      // Skip tracks with very short titles (likely fragments)
      if (track.title.length < 3) {
        return false;
      }
      
      // Skip tracks with generic titles
      const genericTitles = ['Unknown Artist', 'Unknown', 'Unknown Track', 'Track', 'Music'];
      if (genericTitles.includes(track.title) || genericTitles.includes(track.artist)) {
        return false;
      }
      
      // Prefer tracks from chapters over description extraction
      if (track.source === 'chapter') {
        return true;
      }
      
      // Include ITDV playlist tracks - they're high quality and resolved
      if (track.source === 'itdv-playlist') {
        return true;
      }
      
      // For description tracks, be more selective
      if (track.source === 'description') {
        // Only include if it looks like a real song title
        const hasArtist = track.artist && track.artist.length > 2 && !track.artist.includes('Unknown');
        const hasGoodTitle = track.title.length > 5 && !track.title.includes('not http');
        return hasArtist && hasGoodTitle;
      }
      
      return false;
    });
    
    // Group tracks by episode to create "albums"
    const episodeGroups = qualityTracks.reduce((groups: any, track: any) => {
      const episodeKey = `${track.episodeId}-${track.episodeTitle}`;
      if (!groups[episodeKey]) {
        groups[episodeKey] = {
          episodeId: track.episodeId,
          episodeTitle: track.episodeTitle,
          episodeDate: track.episodeDate,
          tracks: []
        };
      }
      groups[episodeKey].tracks.push(track);
      return groups;
    }, {});

    // Convert episode groups to album format
    return Object.values(episodeGroups).map((episode: any, index: number) => {
      // Ensure tracks array exists and is valid
      const tracks = episode.tracks || [];
      
      return {
        id: `music-episode-${episode.episodeId}`,
        title: episode.episodeTitle,
        artist: tracks.length > 0 ? tracks[0].artist : 'From RSS Feed',
        description: `Music tracks from ${episode.episodeTitle}`,
        coverArt: tracks.length > 0 ? (tracks[0].artworkUrl || tracks[0].image || '') : '',
        releaseDate: episode.episodeDate,
        feedId: 'music-rss',
        tracks: tracks.map((track: any, trackIndex: number) => ({
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          url: track.audioUrl || '',
          trackNumber: trackIndex + 1,
          subtitle: track.episodeTitle,
          summary: track.description || '',
          image: track.artworkUrl || track.image || '',
          explicit: false,
          keywords: [],
          // Add music track specific fields
          musicTrack: true,
          episodeId: track.episodeId,
          episodeDate: track.episodeDate,
          source: track.source,
          startTime: track.startTime,
          endTime: track.endTime
        })),
        // Mark as music track album
        isMusicTrackAlbum: true,
        source: 'rss-feed'
      };
    });
  };

  const playMusicTrack = async (track: any) => {
    // TODO: Implement music track playback
    console.log('Playing music track:', track);
    // Playback started successfully
  };

  const playAlbum = async (album: RSSAlbum, e: React.MouseEvent | React.TouchEvent) => {
    // Only prevent default/propagation for the play button, not the entire card
    e.stopPropagation();

    // Check if this is a playlist card with no tracks (from playlists-fast API)
    // Playlist feedIds end with '-playlist' (e.g., 'hgh-playlist', 'b4ts-playlist')
    const isPlaylistCard = album.feedId?.endsWith('-playlist');
    const hasNoPlayableTracks = !album.tracks.length || !album.tracks.some(track => track.url);

    // If it's a playlist card with no tracks, fetch full data from individual API
    if (isPlaylistCard && hasNoPlayableTracks) {
      console.log('📥 Playlist card detected with no tracks, fetching full data...');
      try {
        // Extract playlist ID from feedId (e.g., 'hgh-playlist' -> 'hgh')
        const playlistId = album.feedId?.replace('-playlist', '');
        const response = await fetch(`/api/playlist/${playlistId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.albums?.[0]?.tracks?.length > 0) {
            // Use the full album data with tracks
            album = {
              ...album,
              tracks: data.albums[0].tracks.map((track: any) => ({
                ...track,
                url: track.url || track.audioUrl // Ensure url field is set
              }))
            };
            console.log(`✅ Fetched ${album.tracks.length} tracks for playlist`);
          }
        }
      } catch (error) {
        console.error('Failed to fetch playlist tracks:', error);
      }
    }

    // Find the first playable track
    const firstTrack = album.tracks.find(track => track.url);

    if (!firstTrack || !firstTrack.url) {
      console.warn('Cannot play album: missing track');
      setError('No playable tracks found in this album');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      console.log('🎵 Attempting to play:', album.title, 'Track URL:', firstTrack.url);
      
      // Use global audio context to play album
      const success = await globalPlayAlbum(album, 0);
      if (success) {
        console.log('✅ Successfully started playback');
        // Open the fullscreen now playing screen
        setFullscreenMode(true);
      } else {
        throw new Error('Failed to start album playback');
      }
    } catch (error) {
      let errorMessage = 'Unable to play audio - please try again';
      let errorCode: ErrorCode = ErrorCodes.AUDIO_PLAYBACK_ERROR;
      
      if (error instanceof DOMException) {
        switch (error.name) {
          case 'NotAllowedError':
            errorMessage = 'Tap the play button again to start playback';
            errorCode = ErrorCodes.PERMISSION_ERROR;
            break;
          case 'NotSupportedError':
            errorMessage = 'Audio format not supported on this device';
            errorCode = ErrorCodes.AUDIO_NOT_FOUND;
            break;
        }
      }
      
      // Temporarily disable error logging to prevent recursion
      // logger.error('Audio playback error', error, {
      //   album: album.title,
      //   trackUrl: firstTrack?.url,
      //   errorName: error instanceof DOMException ? error.name : 'Unknown'
      // });
      
      const appError = new AppError(errorMessage, errorCode, 400, false);
      setError(appError.message);
      toast.error(appError.message);
      
      setTimeout(() => setError(null), 5000);
    }
  };

  // Audio playback functions are now handled by the global AudioContext

  // Shuffle functionality is now handled by the global AudioContext

  // Albums are now sorted server-side, just use them directly
  const filteredAlbums = displayedAlbums.length > 0 ? displayedAlbums : (isEnhancedLoaded ? enhancedAlbums : criticalAlbums);

  // Memoize expensive filtering operations to prevent re-computation on every render
  const albumsWithMultipleTracks = useMemo(() =>
    filteredAlbums.filter(album => (album.tracks?.length || album.totalTracks || 0) >= 6),
    [filteredAlbums]
  );

  const epsAndSingles = useMemo(() =>
    filteredAlbums.filter(album => (album.tracks?.length || album.totalTracks || 0) < 6),
    [filteredAlbums]
  );

  // Debug filtered albums when activeFilter is 'publishers'
  if (activeFilter === 'publishers') {
    console.log(`🔍 Debug filteredAlbums for publishers filter:`, {
      displayedAlbums: displayedAlbums.length,
      enhancedAlbums: enhancedAlbums.length,
      criticalAlbums: criticalAlbums.length,
      filteredAlbums: filteredAlbums.length,
      activeFilter
    });
  }

  // Show loading state for progressive loading
  const showProgressiveLoading = isCriticalLoaded && !isEnhancedLoaded && filteredAlbums.length > 0;

  return (
    <AppLayout>
      <div className="min-h-screen text-white relative overflow-hidden">
      {/* Navy Background Base - Full Screen */}
      <div className="fixed inset-0 z-0" style={{
        background: 'linear-gradient(to right, #0a0f1a, #0f1419, #0a0f1a)',
        backgroundColor: '#0a0f1a'
      }} />
      
      {/* Static Background - STABLEKRAFT Rocket - Lazy loaded */}
      {backgroundImageLoaded && (
        <div 
          className="fixed inset-0 z-10 transition-opacity duration-300"
          style={{
            backgroundImage: 'url(/stablekraft-rocket-new.png)',
            backgroundSize: 'auto 100vh',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        >
          {/* Dark overlay for better readability */}
          <div className="absolute inset-0 bg-gradient-to-br from-black/40 via-black/30 to-black/50" />
        </div>
      )}
      
      {/* Preload background image after critical content - Always render but handle loading client-side */}
      <div className="hidden">
        {isClient && isCriticalLoaded && (
          <Image
            src="/stablekraft-rocket-new.png"
            alt=""
            width={1920}
            height={1080}
            onLoad={() => setBackgroundImageLoaded(true)}
            onError={() => setBackgroundImageLoaded(true)}
          />
        )}
      </div>
      
      {/* Fallback gradient background - only for very slow connections */}
      <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-0" style={{
        opacity: backgroundImageLoaded ? 0 : 1,
        transition: 'opacity 0.3s ease-in-out'
      }} />

      {/* Content overlay */}
      <div className="relative z-20">
        {/* Audio element is now handled by the global AudioContext */}
        
        {/* Header - Aligned with menu buttons */}
        <header
          className="border-b backdrop-blur-sm bg-black/70 pt-safe-plus"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.1)'
          }}
        >
          <div className="container mx-auto px-6">
            {/* Header row - Centered title between menu buttons */}
            <div className="flex items-center justify-center gap-4 h-16">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Project StableKraft</h1>
            </div>

            {/* Error Status Only */}
            {isClient && error && (
              <div className="flex items-center justify-center gap-2 text-sm pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-stablekraft-orange rounded-full"></span>
                  <span className="text-stablekraft-orange">{error}</span>
                </div>
              </div>
            )}
          </div>
        </header>
        
        {/* Filter Menu - Below Header */}
        <div className="relative z-30 bg-black/70 backdrop-blur-sm border-b border-gray-700 py-2 sm:py-3">
          <div className="container mx-auto px-6">
            <div className="flex items-center justify-between gap-2">
              {/* Mobile: Dropdown filter */}
              <select
                value={activeFilter}
                onChange={(e) => handleFilterChange(e.target.value as FilterType)}
                disabled={isFilterLoading}
                className="md:hidden bg-gray-800 text-white px-3 py-2 rounded text-sm border border-gray-600 focus:outline-none focus:border-stablekraft-teal"
              >
                <option value="all">All</option>
                <option value="albums">Albums</option>
                <option value="eps">EPs</option>
                <option value="singles">Singles</option>
                <option value="publishers">Publishers</option>
                <option value="playlist">Playlists</option>
              </select>

              {/* Desktop: Button tabs */}
              <div className="hidden md:flex gap-1">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'albums', label: 'Albums' },
                  { value: 'eps', label: 'EPs' },
                  { value: 'singles', label: 'Singles' },
                  { value: 'publishers', label: 'Publishers' },
                  { value: 'playlist', label: 'Playlists' },
                ].map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => handleFilterChange(filter.value as FilterType)}
                    disabled={isFilterLoading}
                    className={`px-3 py-2 rounded text-sm font-medium whitespace-nowrap transition-all ${
                      activeFilter === filter.value
                        ? 'bg-stablekraft-teal text-white shadow-sm'
                        : 'text-gray-300 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {/* Right side - Action buttons */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Search Button */}
                <SearchBar className="w-full sm:w-auto sm:min-w-[300px]" />

                {/* Favorites Button */}
                <Link
                  href="/favorites"
                  className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center"
                  title="View Favorites"
                  aria-label="View Favorites"
                  style={{ minWidth: '36px', minHeight: '36px' }}
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" style={{ display: 'block' }}>
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </Link>
                
                {/* Shuffle Button */}
                <button
                  onClick={handleShuffle}
                  className="bg-stablekraft-teal hover:bg-stablekraft-orange text-white p-2 rounded-lg transition-all shadow-lg hover:shadow-xl active:scale-95"
                  title="Random Shuffle"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>

                {/* View Toggle */}
                <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-600">
                  <button
                    onClick={() => setViewType('grid')}
                    className={`p-1.5 rounded transition-all ${
                      viewType === 'grid' 
                        ? 'bg-stablekraft-teal text-white shadow-sm' 
                        : 'text-gray-300 hover:text-white active:bg-gray-700'
                    }`}
                    title="Grid view"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setViewType('list')}
                    className={`p-1.5 rounded transition-all ${
                      viewType === 'list' 
                        ? 'bg-stablekraft-teal text-white shadow-sm' 
                        : 'text-gray-300 hover:text-white active:bg-gray-700'
                    }`}
                    title="List view"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Main Content */}
        <div className="container mx-auto px-3 sm:px-6 py-6 sm:py-8 pb-28">
          

          {isLoading && !isCriticalLoaded ? (
            <div className="space-y-8">
              <div className="text-center">
                <h1 className="text-3xl font-bold text-white mb-4">Loading Music Feeds...</h1>
                <p className="text-gray-400 mb-6">Fetching the latest releases from your favorite podcasts</p>
                <LoadingSpinner 
                  size="large"
                  text="Loading critical feeds..."
                  showProgress={true}
                  progress={loadingProgress}
                />
              </div>
              
              {/* Show skeleton while loading */}
              <LoadingSkeleton count={12} />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <h2 className="text-2xl font-semibold mb-4 text-red-600">Error Loading Albums</h2>
              <p className="text-gray-400">{error}</p>
              <button 
                onClick={() => loadCriticalAlbums()}
                className="mt-4 px-4 py-2 bg-stablekraft-teal text-white rounded-lg hover:bg-stablekraft-orange transition-colors"
              >
                Retry
              </button>
            </div>
          ) : filteredAlbums.length > 0 ? (
            <div className="max-w-7xl mx-auto">
              

              {/* Shuffle functionality is now handled by the global AudioContext */}

              {/* Progressive Loading Indicator */}
              {!isEnhancedLoaded && isCriticalLoaded && (
                <div className="mb-6 p-4 bg-stablekraft-teal/20 border border-stablekraft-teal/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 bg-stablekraft-teal rounded-full animate-pulse"></div>
                    <span className="text-stablekraft-teal text-sm">
                      Loading more albums in the background... ({filteredAlbums.length} loaded so far)
                    </span>
                  </div>
                </div>
              )}

              {/* Satellite Spotlight Section */}
              {(() => {
                const spotlightAlbum = filteredAlbums.find(
                  album => album.title?.toLowerCase().includes('satellite spotlight') ||
                           album.id === 'the-satellite-skirmish-the-satellite-spotlight' ||
                           album.feedUrl?.includes('satspotlightsymphony.xml')
                );
                
                if (spotlightAlbum && activeFilter === 'all') {
                  return (
                    <div className="mb-12">
                      <div className="bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20 backdrop-blur-md rounded-2xl p-6 sm:p-8 border border-cyan-400/30 shadow-2xl">
                        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8">
                          {/* Album Art */}
                          <div className="flex-shrink-0">
                            <Link
                              href={generateAlbumUrl(spotlightAlbum.title)}
                              className="block group"
                              onClick={(e) => {
                                if (shouldPreventClick()) {
                                  e.preventDefault();
                                  return;
                                }
                              }}
                            >
                              <div className="relative w-48 h-48 sm:w-64 sm:h-64 rounded-xl overflow-hidden shadow-2xl group-hover:scale-105 transition-transform duration-300">
                                <Image
                                  src={getAlbumArtworkUrl(spotlightAlbum.coverArt || '', 'large')}
                                  alt={spotlightAlbum.title}
                                  width={256}
                                  height={256}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.src = getPlaceholderImageUrl('large');
                                  }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </Link>
                          </div>
                          
                          {/* Album Info */}
                          <div className="flex-1 text-center md:text-left">
                            <div className="inline-block px-3 py-1 bg-cyan-500/30 rounded-full mb-3">
                              <span className="text-cyan-300 text-xs font-semibold uppercase tracking-wider">⭐ Featured Spotlight</span>
                            </div>
                            <h2 className="text-3xl sm:text-4xl font-bold mb-3 text-white group-hover:text-cyan-400 transition-colors">
                              <Link
                                href={generateAlbumUrl(spotlightAlbum.title)}
                                onClick={(e) => {
                                  if (shouldPreventClick()) {
                                    e.preventDefault();
                                    return;
                                  }
                                }}
                              >
                                {spotlightAlbum.title}
                              </Link>
                            </h2>
                            <p className="text-xl text-gray-300 mb-4">{spotlightAlbum.artist}</p>
                            
                            {/* Description */}
                            {spotlightAlbum.description && (
                              <div 
                                className="text-gray-400 mb-6 line-clamp-3"
                                dangerouslySetInnerHTML={{ 
                                  __html: spotlightAlbum.description.replace(/<p>/g, '').replace(/<\/p>/g, '') 
                                }}
                              />
                            )}
                            
                            {/* Action Buttons */}
                            <div className="flex flex-col sm:flex-row gap-3">
                              <button
                                onClick={(e) => {
                                  if (!shouldPreventClick()) {
                                    playAlbum(spotlightAlbum, e);
                                  }
                                }}
                                className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 text-white rounded-lg font-semibold transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2"
                              >
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                                Play Now
                              </button>
                              <Link
                                href={generateAlbumUrl(spotlightAlbum.title)}
                                onClick={(e) => {
                                  if (shouldPreventClick()) {
                                    e.preventDefault();
                                    return;
                                  }
                                }}
                                className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-semibold transition-all border border-white/20 hover:border-white/40 flex items-center justify-center gap-2"
                              >
                                View Album
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Albums Display */}
              {!isEnhancedLoaded && isCriticalLoaded ? (
                // Show critical albums with loading indicator for enhanced data
                <div className="space-y-8">
                  <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-stablekraft-teal/20 border border-stablekraft-teal/30 rounded-full">
                      <div className="w-2 h-2 bg-stablekraft-teal rounded-full animate-pulse"></div>
                      <span className="text-stablekraft-teal text-sm">Loading enhanced content...</span>
                    </div>
                  </div>
                  
                  {/* Show critical albums */}
                  <div>
                    <h2 className="text-2xl font-bold mb-6 text-white">Latest Releases</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                      {criticalAlbums.map((album, index) => (
                        <AlbumCard
                          key={`critical-${index}`}
                          album={album}
                          onPlay={playAlbum}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : activeFilter === 'all' ? (
                // Original sectioned layout for "All" filter
                <>
                  {/* Albums Grid */}
                  {albumsWithMultipleTracks.length > 0 && (
                      <div className="mb-12">
                        <h2 className="text-2xl font-bold mb-6 text-white">Albums</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {albumsWithMultipleTracks.map((album, index) => (
                              <AlbumCard
                                key={`album-${index}`}
                                album={album}
                                onPlay={playAlbum}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {albumsWithMultipleTracks.map((album, index) => (
                              <Link
                                key={`album-${index}`}
                                href={generateAlbumUrl(album.title)}
                                className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                              >
                                <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                                  <Image
                                    src={getAlbumArtworkUrl(album.coverArt || '', 'large')}
                                    alt={album.title}
                                    width={80}
                                    height={80}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = getPlaceholderImageUrl('thumbnail');
                                    }}
                                  />
                                  {/* Play button overlay */}
                                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        playAlbum(album, e);
                                      }}
                                      className="w-10 h-10 bg-cyan-400/20 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-cyan-400/30 active:bg-cyan-400/40 transition-colors duration-200 border border-cyan-400/30 hover:border-cyan-400/50 shadow-lg shadow-cyan-400/20"
                                      aria-label="Play album"
                                    >
                                      <Play className="w-4 h-4 text-white ml-0.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-white text-sm sm:text-base leading-tight group-hover:text-cyan-400 transition-colors duration-200 truncate">
                                    {album.title}
                                  </h3>
                                  <p className="text-gray-300 text-xs sm:text-sm mt-1 truncate">{album.artist}</p>
                                </div>

                                <div className="flex items-center gap-2 sm:gap-4">
                                  <div onClick={(e) => e.preventDefault()}>
                                    <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} />
                                  </div>
                                  <div className="hidden sm:flex items-center gap-4 text-sm text-gray-200">
                                    <span className="font-medium">{new Date(album.releaseDate).getFullYear()}</span>
                                    <span className="font-medium">{album.tracks?.length || album.totalTracks || 0} tracks</span>
                                    <span className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white font-medium">Album</span>
                                    {album.explicit && (
                                      <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                                        E
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                  )}

                  {/* EPs and Singles Grid */}
                  {epsAndSingles.length > 0 && (
                      <div>
                        <h2 className="text-2xl font-bold mb-6 text-white">EPs and Singles</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {epsAndSingles.map((album, index) => (
                              <AlbumCard
                                key={`ep-single-${index}`}
                                album={album}
                                onPlay={playAlbum}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {epsAndSingles.map((album, index) => (
                              <Link
                                key={`ep-single-${index}`}
                                href={generateAlbumUrl(album.title)}
                                className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                              >
                                <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                                  <Image
                                    src={getAlbumArtworkUrl(album.coverArt || '', 'large')}
                                    alt={album.title}
                                    width={80}
                                    height={80}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = getPlaceholderImageUrl('thumbnail');
                                    }}
                                  />
                                  {/* Play button overlay */}
                                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        playAlbum(album, e);
                                      }}
                                      className="w-10 h-10 bg-cyan-400/20 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-cyan-400/30 active:bg-cyan-400/40 transition-colors duration-200 border border-cyan-400/30 hover:border-cyan-400/50 shadow-lg shadow-cyan-400/20"
                                      aria-label="Play album"
                                    >
                                      <Play className="w-4 h-4 text-white ml-0.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-white text-sm sm:text-base leading-tight group-hover:text-cyan-400 transition-colors duration-200 truncate">
                                    {album.title}
                                  </h3>
                                  <p className="text-gray-300 text-xs sm:text-sm mt-1 truncate">{album.artist}</p>
                                </div>

                                <div className="flex items-center gap-2 sm:gap-4">
                                  <div onClick={(e) => e.preventDefault()}>
                                    <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} />
                                  </div>
                                  <div className="hidden sm:flex items-center gap-4 text-sm text-gray-200">
                                    <span className="font-medium">{new Date(album.releaseDate).getFullYear()}</span>
                                    <span className="font-medium">{album.tracks?.length || album.totalTracks || 0} tracks</span>
                                    <span className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white font-medium">
                                      {(album.tracks?.length || album.totalTracks || 0) === 1 ? 'Single' : 'EP'}
                                    </span>
                                    {album.explicit && (
                                      <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                                        E
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                  )}
                </>
              ) : (
                // Unified layout for specific filters (Albums, EPs, Singles)
                viewType === 'grid' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                    {filteredAlbums
                      .map((album, index) => (
                      <AlbumCard
                        key={`${album.title}-${index}`}
                        album={album}
                        onPlay={playAlbum}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredAlbums
                      .map((album, index) => (
                      <Link
                        key={`${album.title}-${index}`}
                        href={generateAlbumUrl(album.title)}
                        className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                      >
                        <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                          <Image
                            src={getAlbumArtworkUrl(album.coverArt || '', 'large')}
                            alt={album.title}
                            width={80}
                            height={80}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = getPlaceholderImageUrl('thumbnail');
                            }}
                          />
                          {/* Play button overlay */}
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                playAlbum(album, e);
                              }}
                              className="w-10 h-10 bg-cyan-400/20 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-cyan-400/30 active:bg-cyan-400/40 transition-colors duration-200 border border-cyan-400/30 hover:border-cyan-400/50 shadow-lg shadow-cyan-400/20"
                              aria-label="Play album"
                            >
                              <Play className="w-4 h-4 text-white ml-0.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-white text-sm sm:text-base leading-tight group-hover:text-cyan-400 transition-colors duration-200 truncate">
                            {album.title}
                          </h3>
                          <p className="text-gray-300 text-xs sm:text-sm mt-1 truncate">{album.artist}</p>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-4">
                          <div onClick={(e) => e.preventDefault()}>
                            <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} />
                          </div>
                          <div className="hidden sm:flex items-center gap-4 text-sm text-gray-200">
                            <span className="font-medium">{new Date(album.releaseDate).getFullYear()}</span>
                            <span className="font-medium">{album.tracks?.length || album.totalTracks || 0} tracks</span>
                            <span className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white font-medium">
                              {(album.tracks?.length || album.totalTracks || 0) <= 6 ? ((album.tracks?.length || album.totalTracks || 0) === 1 ? 'Single' : 'EP') : 'Album'}
                            </span>
                            {album.explicit && (
                              <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                                E
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )
              )}
              
              {/* HGH filter removed - no longer needed */}
              
              {/* Infinite Scroll Sentinel & Loading Indicator */}
              {isEnhancedLoaded && hasMoreAlbums && (
                <div ref={loadMoreRef} className="mt-12 flex justify-center py-8">
                  {isLoading ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-3 border-stablekraft-teal/30 border-t-stablekraft-teal rounded-full animate-spin"></div>
                      <span className="text-gray-400">Loading more albums...</span>
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm">
                      Scroll to load more ({totalAlbums - loadedAlbumsCount} remaining)
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <h2 className="text-2xl font-semibold mb-4 text-white">No Albums Found</h2>
              <p className="text-gray-400">Unable to load any album information from the RSS feeds.</p>
            </div>
          )}
        </div>

        {/* Now Playing Bar is now handled by the global AudioContext */}
      </div>
      
      {/* Fullscreen Now Playing Screen */}
      <NowPlayingScreen
        isOpen={isFullscreenMode}
        onClose={() => setFullscreenMode(false)}
      />
    </div>
    </AppLayout>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <LoadingSpinner size="large" text="Loading..." />
      </div>
    }>
      <HomePageContent />
    </Suspense>
  );
}