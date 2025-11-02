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
import SearchBar from '@/components/SearchBar';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';



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

export default function HomePage() {
  const router = useRouter();
  const { shouldPreventClick } = useScrollDetectionContext();
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
  const API_VERSION = 'v10'; // Increment to bust cache when API changes - v10 includes V4V fields + AudioContext version check
  
  // HGH filter removed - no longer needed
  
  // Global audio context
  const { playAlbum: globalPlayAlbum, shuffleAllTracks } = useAudio();
  const hasLoadedRef = useRef(false);
  

  
  // Static background state - Bloodshot Lies album art
  const [backgroundImageLoaded, setBackgroundImageLoaded] = useState(false);

  // Controls state
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [viewType, setViewType] = useState<ViewType>('grid');
  const [sortType, setSortType] = useState<SortType>('name');
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  
  // Cache for filter data to avoid re-fetching
  const [filterCache, setFilterCache] = useState<Map<FilterType, any>>(new Map());

  // Test feeds state
  const [testFeeds, setTestFeeds] = useState<any[]>([]);
  const [testFeedsLoading, setTestFeedsLoading] = useState(true);

  // Shuffle functionality is now handled by the global AudioContext
  const handleShuffle = async () => {
    try {
      console.log('🎲 Shuffle button clicked - starting shuffle all tracks');
      const success = await shuffleAllTracks();
      if (success) {
        toast.success('🎲 Shuffle started!');
      } else {
        toast.error('Failed to start shuffle');
      }
    } catch (error) {
      console.error('Error starting shuffle:', error);
      toast.error('Error starting shuffle');
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

  // Load test feeds
  useEffect(() => {
    const loadTestFeeds = async () => {
      try {
        const response = await fetch('/api/feeds?type=test&status=active');
        if (response.ok) {
          const data = await response.json();
          setTestFeeds(data.feeds || []);
        }
      } catch (error) {
        console.error('Error loading test feeds:', error);
      } finally {
        setTestFeedsLoading(false);
      }
    };

    loadTestFeeds();
  }, []);

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

      // Handle artists filter separately - redirect to handleFilterChange
      if (activeFilter === 'artists') {
        console.log(`🔄 loadCriticalAlbums: Redirecting ${activeFilter} filter to handleFilterChange`);
        setIsLoading(false);
        await handleFilterChange(activeFilter);
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

    // Don't load more for artists filter - all publishers are already loaded
    if (activeFilter === 'artists') {
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
  const handleFilterChange = async (newFilter: FilterType) => {
    console.log(`🔄 handleFilterChange called with filter: "${newFilter}"`);
    if (newFilter === activeFilter) return; // No change

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
      
      if (newFilter === 'artists') {
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

  // Calculate pagination info
  const totalPages = Math.ceil(totalAlbums / ALBUMS_PER_PAGE);
  const loadedAlbumsCount = displayedAlbums.length;

  const loadAlbumsData = async (loadTier: 'core' | 'extended' | 'lowPriority' | 'all' = 'all', limit: number = 50, offset: number = 0, filter: string = 'all'): Promise<{ albums: RSSAlbum[]; totalCount: number }> => {
    try {
      // Handle artists filter separately - don't call albums API for publishers
      if (filter === 'artists') {
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
        const hasGoodTitle = track.title.length > 5 && !track.title.includes('http');
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
    toast.success(`Playing ${track.title} by ${track.artist}`);
  };

  const playAlbum = async (album: RSSAlbum, e: React.MouseEvent | React.TouchEvent) => {
    // Only prevent default/propagation for the play button, not the entire card
    e.stopPropagation();
    
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
  
  // Debug filtered albums when activeFilter is 'artists'
  if (activeFilter === 'artists') {
    console.log(`🔍 Debug filteredAlbums for artists filter:`, {
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
        
        {/* Header */}
        <header 
          className="border-b backdrop-blur-sm bg-black/70 pt-safe-plus pt-6"
          style={{
            borderColor: 'rgba(255, 255, 255, 0.1)'
          }}
        >
          <div className="container mx-auto px-6 py-2">
            {/* Mobile Header - Stacked Layout */}
            <div className="block sm:hidden mb-3">
              {/* Top row - Menu, Logo, Actions */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                  {/* Menu Button */}
                  <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors text-white"
                    aria-label="Toggle menu"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                </div>

                {/* Right side - Lightning Wallet Button */}
                <div className="flex items-center">
                  {(() => {
                    try {
                      const { LightningWalletButton } = require('@/components/Lightning/LightningWalletButton');
                      return (
                        <LightningWalletButton
                          variant="dropdown"
                          showLabel={false}
                          className="p-2"
                        />
                      );
                    } catch (error) {
                      console.error('LightningWalletButton error in mobile header:', error);
                      return null;
                    }
                  })()}
                </div>
              </div>

              {/* Bottom row - Title and Beta badge */}
              <div className="text-center">
                <h1 className="text-xl font-bold mb-1 text-white">Project StableKraft</h1>
                <p className="text-xs text-gray-300 mb-2">- &quot;its was all this reimagined, its a different kind of speech, it was repition, it was what you wanted it to be&quot; - The Contortionist - Reimagined</p>
              </div>
            </div>

            {/* Desktop Header - Original Layout */}
            <div className="hidden sm:block mb-4">
              <div className="relative flex items-center justify-center min-h-[60px]">
                {/* Left side - Menu Button */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <button
                    onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                    className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors text-white"
                    aria-label="Toggle menu"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                </div>

                {/* Center - Title */}
                <div className="text-center">
                  <h1 className="text-3xl font-bold mb-1 text-white">Project StableKraft</h1>
                  <p className="text-sm text-gray-300 mb-2">- &quot;its was all this reimagined, its a different kind of speech, it was repition, it was what you wanted it to be&quot; - The Contortionist - Reimagined</p>
                </div>

                {/* Right side - Lightning Wallet Button */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2">
                  {(() => {
                    try {
                      const { LightningWalletButton } = require('@/components/Lightning/LightningWalletButton');
                      return (
                        <LightningWalletButton
                          variant="dropdown"
                          showLabel={false}
                          className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
                        />
                      );
                    } catch (error) {
                      console.error('LightningWalletButton error in desktop header:', error);
                      return (
                        <button className="p-2 bg-gray-800/50 hover:bg-gray-700/50 text-yellow-400 rounded-lg transition-colors">
                          ⚡
                        </button>
                      );
                    }
                  })()}
                </div>
              </div>
            </div>
            
            {/* Error Status Only */}
            {isClient && error && (
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-stablekraft-orange rounded-full"></span>
                  <span className="text-stablekraft-orange">{error}</span>
                </div>
              </div>
            )}
          </div>
        </header>
        
        {/* Filter Menu - Below Header */}
        <div className="relative z-30 bg-black/70 backdrop-blur-sm border-b border-gray-700 py-3">
          <div className="container mx-auto px-6">
            {/* Search Bar - Full Width on Mobile, Inline on Desktop */}
            <div className="mb-3">
              <SearchBar className="w-full md:max-w-md" />
            </div>

            <div className="flex items-center justify-between">
              {/* Left side - Filter buttons */}
              <div className="flex gap-1 overflow-x-auto">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'albums', label: 'Albums' },
                  { value: 'eps', label: 'EPs' },
                  { value: 'singles', label: 'Singles' },
                  { value: 'artists', label: 'Publishers' },
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
              <div className="flex items-center gap-2">
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
        
        {/* Sidebar */}
        <div className={`fixed top-0 left-0 h-full w-80 bg-gray-900/95 backdrop-blur-sm transform transition-transform duration-300 z-30 border-r border-gray-700 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <div className="p-4 pt-16 flex flex-col h-full">
            <h2 className="text-lg font-bold mb-4 text-white">Menu</h2>
            
            {/* Navigation Links */}
            <div className="mb-4 space-y-1">
              <Link 
                href="/about" 
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-800/50 transition-colors text-gray-300"
                onClick={() => setIsSidebarOpen(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-gray-300">About & Support</span>
              </Link>
              
            </div>



            {/* Artists with Publisher Feeds */}
            {(() => {
              // Use pre-computed publisher stats from API
              console.log(`📊 Publisher Stats: Using ${publisherStats.length} pre-computed publisher stats`);

              // Always show the section, even if empty, to indicate it exists
              return (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold mb-2 text-white">
                    Publisher Feeds
                    {showProgressiveLoading && (
                      <span className="ml-2 text-xs text-stablekraft-teal">(Loading more...)</span>
                    )}
                  </h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {publisherStats.length > 0 ? (
                      publisherStats.map((artist, index) => (
                        <Link
                          key={`publisher-${artist.feedGuid || artist.name || index}`}
                          href={`/publisher/${generatePublisherSlug({ title: artist.name, feedGuid: artist.feedGuid })}`}
                          className="flex items-center justify-between bg-gray-800/30 hover:bg-gray-800/50 rounded p-1.5 transition-colors group"
                          onClick={() => setIsSidebarOpen(false)}
                        >
                          <span className="text-xs text-gray-300 group-hover:text-white truncate flex-1">
                            {artist.name}
                          </span>
                          <span className="text-xs text-gray-500 group-hover:text-gray-400 ml-1">
                            {artist.albumCount}
                          </span>
                        </Link>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500 italic">
                        {isLoading ? 'Loading publisher feeds...' : 'No publisher feeds available'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            
            {/* Test Feeds Section */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2 text-white">
                Test Feeds
                {testFeedsLoading && (
                  <span className="ml-2 text-xs text-stablekraft-teal">(Loading...)</span>
                )}
              </h3>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {testFeeds.length > 0 ? (
                  testFeeds.map((feed) => (
                    <Link
                      key={`test-feed-${feed.id}`}
                      href={`/album/${feed.id}`}
                      className="flex items-center justify-between bg-orange-800/20 hover:bg-orange-800/30 rounded p-1.5 transition-colors group border border-orange-700/30"
                      onClick={(e) => {
                        // Prevent navigation if user was scrolling
                        if (shouldPreventClick()) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        setIsSidebarOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <svg className="w-3 h-3 text-orange-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span className="text-xs text-orange-300 group-hover:text-orange-200 truncate flex-1">
                          {feed.title}
                        </span>
                      </div>
                      <span className="text-xs text-orange-500 group-hover:text-orange-400 ml-1">
                        {feed._count?.Track || 0}
                      </span>
                    </Link>
                  ))
                ) : (
                  <div className="text-sm text-gray-500 italic">
                    {testFeedsLoading ? 'Loading test feeds...' : 'No test feeds available'}
                  </div>
                )}
              </div>
            </div>
            
            {/* Version Display - Moved to top for better visibility */}
            <div className="mt-auto pt-2 border-t border-gray-700">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Version</span>
                <span className="text-xs text-gray-400 font-mono">{getVersionString()}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Overlay to close sidebar when clicking outside */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-20" 
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        
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
                  {(() => {
                    const albumsWithMultipleTracks = filteredAlbums
                      .filter(album => (album.tracks?.length || album.totalTracks || 0) >= 6);
                    return albumsWithMultipleTracks.length > 0 && (
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
                                className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                              >
                                <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                  <Image 
                                    src={getAlbumArtworkUrl(album.coverArt || '', 'medium')} 
                                    alt={album.title}
                                    width={128}
                                    height={128}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = getPlaceholderImageUrl('thumbnail');
                                    }}
                                  />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-lg group-hover:text-stablekraft-teal transition-colors truncate">
                                    {album.title}
                                  </h3>
                                  <p className="text-gray-400 text-sm truncate">{album.artist}</p>
                                </div>
                                
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                  <span>{new Date(album.releaseDate).getFullYear()}</span>
                                  <span>{album.tracks?.length || album.totalTracks || 0} tracks</span>
                                  <span className="px-2 py-1 bg-white/10 rounded text-xs">Album</span>
                                  {album.explicit && (
                                    <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                                      E
                                    </span>
                                  )}
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
                  {/* EPs and Singles Grid */}
                  {(() => {
                    const epsAndSingles = filteredAlbums
                      .filter(album => (album.tracks?.length || album.totalTracks || 0) < 6);
                    return epsAndSingles.length > 0 && (
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
                                className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                              >
                                <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                                  <Image 
                                    src={getAlbumArtworkUrl(album.coverArt || '', 'medium')} 
                                    alt={album.title}
                                    width={128}
                                    height={128}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.src = getPlaceholderImageUrl('thumbnail');
                                    }}
                                  />
                                </div>
                                
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-semibold text-lg group-hover:text-stablekraft-teal transition-colors truncate">
                                    {album.title}
                                  </h3>
                                  <p className="text-gray-400 text-sm truncate">{album.artist}</p>
                                </div>
                                
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                  <span>{new Date(album.releaseDate).getFullYear()}</span>
                                  <span>{album.tracks?.length || album.totalTracks || 0} tracks</span>
                                  <span className="px-2 py-1 bg-white/10 rounded text-xs">
                                    {(album.tracks?.length || album.totalTracks || 0) === 1 ? 'Single' : 'EP'}
                                  </span>
                                  {album.explicit && (
                                    <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                                      E
                                    </span>
                                  )}
                                </div>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  

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
                        className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                          <Image 
                            src={getAlbumArtworkUrl(album.coverArt || '', 'thumbnail')} 
                            alt={album.title}
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
                          <h3 className="font-semibold text-lg group-hover:text-stablekraft-teal transition-colors truncate">
                            {album.title}
                          </h3>
                          <p className="text-gray-400 text-sm truncate">{album.artist}</p>
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span>{new Date(album.releaseDate).getFullYear()}</span>
                          <span>{album.tracks?.length || album.totalTracks || 0} tracks</span>
                          <span className="px-2 py-1 bg-white/10 rounded text-xs">
                            {(album.tracks?.length || album.totalTracks || 0) <= 6 ? ((album.tracks?.length || album.totalTracks || 0) === 1 ? 'Single' : 'EP') : 'Album'}
                          </span>
                          {album.explicit && (
                            <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">
                              E
                            </span>
                          )}
                        </div>
                        
                        {/* Play button removed - now handled by global audio context */}
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
  );
}