'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import Image from 'next/image';
import ArtworkImage from '@/components/ArtworkImage';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import LoadingSpinner from '@/components/LoadingSpinner';
import { RSSAlbum } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumHref, generatePublisherSlug } from '@/lib/url-utils';
import { useAudio } from '@/contexts/AudioContext';
import { AppError, ErrorCodes, ErrorCode, getErrorMessage, createErrorLogger } from '@/lib/error-utils';
import { toast } from '@/components/Toast';
import dynamic from 'next/dynamic';
import SearchBar from '@/components/SearchBar';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import { Play, Pause } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { singleTrackFavoriteData } from '@/lib/favorite-target';
import { SkeletonGrid } from '@/components/SkeletonCard';



// Dynamic imports for heavy components with better loading states
// SSR enabled for faster initial paint - components guard browser APIs properly
const AlbumCard = dynamic(() => import('@/components/AlbumCardLazy'), {
  loading: () => (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 animate-pulse">
      <div className="aspect-square bg-gray-800/50 rounded-lg mb-3"></div>
      <div className="h-4 bg-gray-700/50 rounded mb-2"></div>
      <div className="h-3 bg-gray-700/50 rounded w-2/3"></div>
    </div>
  )
});

const CDNImage = dynamic(() => import('@/components/CDNImageLazy'), {
  loading: () => (
    <div className="animate-pulse bg-gray-800/50 rounded flex items-center justify-center">
      <div className="w-6 h-6 bg-white/20 rounded-full animate-spin"></div>
    </div>
  )
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
  )
});

// NowPlayingScreen is mounted globally in app/layout.tsx — do not import here.

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

// Import types and sort option sets from ControlsBar
import type { FilterType, ViewType, SortType } from '@/components/ControlsBar';
import { SORT_OPTIONS_ALBUMS, SORT_OPTIONS_PUBLISHERS, SORT_OPTIONS_PLAYLIST } from '@/components/ControlsBar';
import { useDataSaver } from '@/hooks/useDataSaver';
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

// Convert publisher API data to album-like format for display in AlbumCard grid
function convertPublishersToAlbums(publishers: any[]): RSSAlbum[] {
  return publishers.map((publisher: any) => {
    const publisherSlug = generatePublisherSlug({
      title: publisher.title,
      artist: publisher.title,
      feedGuid: publisher.feedGuid || publisher.id
    });

    return {
      id: publisher.id,
      feedId: publisher.id,
      title: publisher.title,
      artist: publisher.title,
      description: publisher.description || `${publisher.itemCount} releases`,
      coverArt: publisher.image,
      tracks: [],
      releaseDate: publisher.dateAdded || new Date().toISOString(),
      dateAdded: publisher.dateAdded,
      link: `/publisher/${publisherSlug}`,
      feedUrl: publisher.originalUrl,
      isPublisherCard: true,
      publisherUrl: `/publisher/${publisherSlug}`,
      albumCount: publisher.itemCount,
      totalTracks: publisher.totalTracks
    };
  });
}

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
  const { setFullscreenMode } = useAudio();
  
  // Performance optimization: Limit rendered albums for better scrolling
  const [visibleAlbumCount, setVisibleAlbumCount] = useState(50);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAlbums, setTotalAlbums] = useState(0);
  const [displayedAlbums, setDisplayedAlbums] = useState<RSSAlbum[]>([]);
  const [hasMoreAlbums, setHasMoreAlbums] = useState(true);
  // Mobile: when the search input is expanded it takes over the whole header
  // row (the dropdown + action buttons hide) so it can't get squished/overflow.
  const [searchExpanded, setSearchExpanded] = useState(false);
  const dataSaver = useDataSaver();
  const ALBUMS_PER_PAGE = 50; // Load 50 albums per page for better user experience

  // Format-aware loading state (for "all" filter - load all albums before EPs)
  const [formatCounts, setFormatCounts] = useState<{ albums: number; eps: number; singles: number } | null>(null);
  const [currentFormatPhase, setCurrentFormatPhase] = useState<'albums' | 'eps' | 'singles'>('albums');
  // v17: album.guid/episodeGuid no longer fall back to feed.id (issue #242) —
  // shape unchanged, but a cached album still carries the old internal id and
  // would publish it as podcast:item:guid.
  //
  // v18: /api/albums-fast track objects no longer carry a track-level
  // podcastImages, and podcast episode lists are bounded to the 20 newest.
  // Both change the cached SHAPE, so the version has to move or clients keep
  // serving the old objects from localStorage indefinitely (CLAUDE.md).
  //
  // chapters, chaptersUrl, valueTimeSplits and persons were dropped here too
  // and have been PUT BACK. This mapper does discard them, but it is not the
  // only consumer: app/radio/RadioClient.tsx hands the raw response to
  // setInitialAlbums and playback reads all four off those track objects. See
  // lib/catalog/album-shape.ts.
  //
  // v19: the mapper below now keeps album-level persons, so AlbumCard's boost
  // can tag the artist. A cached album has none and would keep tagging nobody.
  const API_VERSION = 'v19';
  
  // HGH filter removed - no longer needed
  
  // Global audio context
  const { playAlbum: globalPlayAlbum, shuffleAllTracks } = useAudio();
  const hasLoadedRef = useRef(false);
  const isUpdatingFromUrlRef = useRef(false); // Track if we're updating from URL to avoid loops
  

  
  // Static background state - Bloodshot Lies album art
  const [backgroundImageLoaded, setBackgroundImageLoaded] = useState(false);

  // Controls state - Initialize from URL params (works on both server and client)
  const validFilters: FilterType[] = ['all', 'new', 'albums', 'eps', 'singles', 'publishers', 'playlist', 'podcasts', 'videos'];
  const urlFilter = searchParams?.get('filter');
  const initialFilter = (urlFilter && validFilters.includes(urlFilter as FilterType))
    ? (urlFilter as FilterType)
    : 'all';
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);

  // Store handleFilterChange in a ref to avoid dependency issues
  const handleFilterChangeRef = useRef<((newFilter: FilterType, skipUrlUpdate?: boolean) => Promise<void>) | null>(null);
  
  // Sync filter from URL params when URL changes (e.g., browser back button)
  useEffect(() => {
    const currentUrlFilter = searchParams?.get('filter');
    const newFilter = (currentUrlFilter && validFilters.includes(currentUrlFilter as FilterType))
      ? (urlFilter as FilterType)
      : 'all';

    // Check if we need to reload data:
    // 1. Filter changed, OR
    // 2. Filter is the same but we don't have data for it (especially important for back navigation)
    const hasDataForFilter = displayedAlbums.length > 0 || enhancedAlbums.length > 0 || criticalAlbums.length > 0;
    const needsReload = newFilter !== activeFilter || (newFilter === activeFilter && !hasDataForFilter && !isLoading);

    // Only update if needed and we're not already updating from URL
    if (needsReload && !isUpdatingFromUrlRef.current && handleFilterChangeRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔄 URL filter changed: "${activeFilter}" -> "${newFilter}" (hasData: ${hasDataForFilter})`);
      }
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
  const [sortType, setSortType] = useState<SortType>('name-asc');
  const [isFilterLoading, setIsFilterLoading] = useState(false);
  
  // Sort options per filter: albums/EPs/singles get full options; publishers and playlist get reduced sets
  const currentSortOptions = useMemo(() => {
    if (activeFilter === 'publishers') return SORT_OPTIONS_PUBLISHERS;
    if (activeFilter === 'playlist') return SORT_OPTIONS_PLAYLIST;
    return SORT_OPTIONS_ALBUMS;
  }, [activeFilter]);

  // Re-fetch from server when sort changes (server-side sort for correct pagination)
  const sortTypeRef = useRef(sortType);
  useEffect(() => {
    // Skip on initial render — data is already loaded with default sort
    if (sortTypeRef.current === sortType) return;
    sortTypeRef.current = sortType;

    // Invalidate filter cache since sort changed — cached data has the old sort order
    setFilterCache(new Map());

    // Playlists don't support server-side sorting
    if (activeFilter === 'playlist') return;

    // Publishers use their own paginated API with sort support
    if (activeFilter === 'publishers') {
      const loadSortedPublishers = async () => {
        setIsLoading(true);
        setCurrentPage(1);
        setHasMoreAlbums(true);
        try {
          const publishersResponse = await fetch(`/api/publishers?limit=${ALBUMS_PER_PAGE}&offset=0&sort=${sortType}`);
          if (!publishersResponse.ok) throw new Error(`Publishers API failed: ${publishersResponse.status}`);
          const publishersData = await publishersResponse.json();
          const publishers = publishersData.publishers || [];
          const publisherAlbums = convertPublishersToAlbums(publishers);
          setDisplayedAlbums(publisherAlbums);
          setEnhancedAlbums(publisherAlbums);
          setCriticalAlbums(publisherAlbums.slice(0, 12));
          setTotalAlbums(publishersData.total || publishers.length);
          setHasMoreAlbums(publishersData.hasMore ?? false);
        } catch (error) {
          console.error('Error reloading publishers with sort:', error);
        } finally {
          setIsLoading(false);
        }
      };
      loadSortedPublishers();
      return;
    }

    const loadSorted = async () => {
      setIsLoading(true);
      setCurrentPage(1);
      setHasMoreAlbums(true);
      try {
        const { albums, totalCount } = await loadAlbumsData('all', ALBUMS_PER_PAGE, 0, activeFilter);
        setDisplayedAlbums(albums);
        setEnhancedAlbums(albums);
        setCriticalAlbums(albums.slice(0, 12));
        setTotalAlbums(totalCount);
        setHasMoreAlbums(albums.length >= ALBUMS_PER_PAGE && albums.length < totalCount);
      } catch (error) {
        console.error('Error reloading with sort:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSorted();
  }, [sortType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache for filter data to avoid re-fetching
  const [filterCache, setFilterCache] = useState<Map<FilterType, any>>(new Map());

  // Test feeds state


  // Shuffle functionality is now handled by the global AudioContext
  const handleShuffle = async () => {
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('🎲 Shuffle button clicked - starting shuffle all tracks');
      }
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

    // Defer localStorage cleanup to idle time to avoid blocking initial render
    if (typeof window !== 'undefined') {
      const cleanupCache = () => {
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
          if (process.env.NODE_ENV === 'development') {
            console.log('🗑️ Removing old cache:', key);
          }
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
      };

      // Use requestIdleCallback if available, otherwise setTimeout
      if ('requestIdleCallback' in window) {
        requestIdleCallback(cleanupCache, { timeout: 2000 });
      } else {
        setTimeout(cleanupCache, 100);
      }
    }

    // Progressive loading: Load critical data first, then enhance
    loadCriticalAlbums();
  }, []); // Run only once on mount


  // Publisher stats are now loaded from the initial /api/albums-fast response
  // and cached/restored via localStorage alongside album data


  // Show background image after critical content loads (no artificial delay)
  useEffect(() => {
    if (isCriticalLoaded && !backgroundImageLoaded) {
      // Show background immediately when critical content is ready
      const bgElement = document.getElementById('background-image');
      if (bgElement) {
        bgElement.style.opacity = '0.6';
        setBackgroundImageLoaded(true);
      }
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
        if (process.env.NODE_ENV === 'development') {
          console.log(`🔄 loadCriticalAlbums: Redirecting ${activeFilter} filter to handleFilterChange`);
        }
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
      
      // Use totalCount to correctly determine if there are more albums.
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

    // Publishers use their own paginated API
    if (activeFilter === 'publishers') {
      setIsLoading(true);
      try {
        const currentCount = displayedAlbums.length;
        const publishersResponse = await fetch(`/api/publishers?limit=${ALBUMS_PER_PAGE}&offset=${currentCount}&sort=${sortType}`);
        if (!publishersResponse.ok) {
          throw new Error(`Publishers API failed: ${publishersResponse.status}`);
        }
        const publishersData = await publishersResponse.json();
        const publishers = publishersData.publishers || [];
        if (publishers.length > 0) {
          const newPublisherAlbums = convertPublishersToAlbums(publishers);
          setDisplayedAlbums(prev => [...prev, ...newPublisherAlbums]);
          setHasMoreAlbums(publishersData.hasMore ?? false);
          setCurrentPage(prev => prev + 1);
        } else {
          setHasMoreAlbums(false);
        }
      } catch (error) {
        console.error('Error loading more publishers:', error);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    const nextPage = currentPage + 1;

      try {
        // Format-aware loading: For "all" filter, ensure we load all albums before any EPs
        const currentCount = displayedAlbums.length;
        // Offset MUST be the count of items already loaded, NOT page*pageSize:
        // loadLimit varies (albums load in 2x batches below), so page arithmetic
        // drifts out of sync with what's actually loaded and re-fetches rows,
        // which surfaces as duplicate cards. (The publishers path above already
        // uses offset=currentCount for this same reason.)
        let startIndex = currentCount;
        let loadLimit = ALBUMS_PER_PAGE;

        // When "all" is selected and we have format counts, enforce format boundaries
        if (activeFilter === 'all' && formatCounts) {
          const { albums: albumCount, eps: epCount } = formatCounts;
          const albumsAndEpsCount = albumCount + epCount;

          if (currentCount < albumCount) {
            // Still loading albums - load remaining albums (or batch size, whichever is smaller)
            const remaining = albumCount - currentCount;
            loadLimit = Math.min(remaining, ALBUMS_PER_PAGE * 2); // Load bigger batches for albums
            if (process.env.NODE_ENV === 'development') {
              console.log(`📀 Loading albums: ${currentCount}/${albumCount} loaded, requesting ${loadLimit} more`);
            }
          } else if (currentCount < albumsAndEpsCount) {
            // Done with albums, now loading EPs
            if (currentFormatPhase !== 'eps') {
              setCurrentFormatPhase('eps');
              if (process.env.NODE_ENV === 'development') {
                console.log(`💿 Transitioning to EPs phase`);
              }
            }
          } else {
            // Done with EPs, now loading singles
            if (currentFormatPhase !== 'singles') {
              setCurrentFormatPhase('singles');
              if (process.env.NODE_ENV === 'development') {
                console.log(`🎵 Transitioning to Singles phase`);
              }
            }
          }
        }

        // Load next page from API (server-side sorted globally: Albums → EPs → Singles)
        const { albums: newAlbums, totalCount: newTotalCount } = await loadAlbumsData('all', loadLimit, startIndex, activeFilter);

        // Update totalAlbums if we got a new total count (should be the same, but ensure consistency)
        if (newTotalCount > 0) {
          setTotalAlbums(newTotalCount);
        }

        if (newAlbums.length > 0) {
          // Append new albums to existing ones (already sorted globally from server)
          // The API returns albums in correct global order: Albums → EPs → Singles
          setDisplayedAlbums(prev => {
            // Dedup by stable id as a safety net: even if an offset ever drifts,
            // a card can never appear twice. Only genuinely-new items are added.
            const seen = new Set(prev.map(a => (a as any).id ?? (a as any).feedId ?? a.title));
            const additions = newAlbums.filter(a => {
              const key = (a as any).id ?? (a as any).feedId ?? a.title;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            const updated = [...prev, ...additions];
            const totalLoaded = updated.length;
            // More to load only if: this fetch added new items, the server
            // returned a full batch, and we haven't reached the total. Requiring
            // new items also stops paging if a fetch returns only duplicates.
            const hasMore =
              additions.length > 0 && newAlbums.length >= loadLimit && totalLoaded < newTotalCount;
            if (process.env.NODE_ENV === 'development') {
              console.log(`📊 Pagination check: fetched=${newAlbums.length}, added=${additions.length}, totalLoaded=${totalLoaded}, totalCount=${newTotalCount}, hasMore=${hasMore}`);
            }
            setHasMoreAlbums(hasMore);
            return updated;
          });
          setCurrentPage(nextPage);
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.log('📊 No more albums returned, stopping pagination');
          }
          setHasMoreAlbums(false);
        }
    } catch (error) {
      console.error('Error loading more albums:', error);
      setError('Failed to load more albums');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMoreAlbums, currentPage, activeFilter, totalAlbums, displayedAlbums.length, formatCounts, currentFormatPhase]);
  
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
        if (process.env.NODE_ENV === 'development') {
          console.log(`👁 Intersection: isIntersecting=${target.isIntersecting}, hasMore=${hasMoreAlbums}, loading=${isLoading}, enhanced=${isEnhancedLoaded}`);
        }
        if (target.isIntersecting && hasMoreAlbums && !isLoading && isEnhancedLoaded) {
          if (process.env.NODE_ENV === 'development') {
            console.log('📄 Triggering loadMoreAlbums');
          }
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
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 handleFilterChange called with filter: "${newFilter}"`);
    }

    // Check if filter is the same AND we already have data
    if (newFilter === activeFilter) {
      const hasData = displayedAlbums.length > 0 || enhancedAlbums.length > 0 || criticalAlbums.length > 0;
      if (hasData) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`🚫 Filter unchanged and data exists, skipping reload`);
        }
        return;
      }
      if (process.env.NODE_ENV === 'development') {
        console.log(`⚠️ Filter unchanged but no data, continuing to load`);
      }
    }

    // Set activeFilter immediately so UI updates right away
    setActiveFilter(newFilter);

    // When switching to publishers or playlist, ensure sortType is valid for reduced options
    const optsForFilter = newFilter === 'publishers' ? SORT_OPTIONS_PUBLISHERS : newFilter === 'playlist' ? SORT_OPTIONS_PLAYLIST : null;
    if (optsForFilter && !optsForFilter.some((o) => o.value === sortType)) {
      setSortType(optsForFilter[0].value as SortType);
    }

    // Reset format-aware loading state
    setFormatCounts(null);
    setCurrentFormatPhase('albums');

    // Prevent URL sync effect from interfering while we're updating
    isUpdatingFromUrlRef.current = true;

    // Update URL with new filter (unless we're updating from URL change)
    if (!skipUrlUpdate) {
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
      if (process.env.NODE_ENV === 'development') {
        console.log(`📦 Using cached data for filter: ${newFilter}`);
      }
      setCurrentPage(1);
      setDisplayedAlbums(cachedData.albums);
      setCriticalAlbums(cachedData.albums.slice(0, 12));
      setEnhancedAlbums(cachedData.albums);
      setTotalAlbums(cachedData.totalCount);
      setHasMoreAlbums(cachedData.hasMore);
      setIsCriticalLoaded(true);
      setIsEnhancedLoaded(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // Reset the ref after cache hit
      setTimeout(() => { isUpdatingFromUrlRef.current = false; }, 100);
      return;
    }

    setCurrentPage(1); // Reset to first page
    setIsFilterLoading(true);
    setIsLoading(true);
    
    try {
      let resultData;

      if (newFilter === 'publishers') {
        if (process.env.NODE_ENV === 'development') {
          console.log(`🎯 handleFilterChange: Processing ${newFilter} filter`);
        }
        // Load first page of publishers with server-side sorting
        const publishersResponse = await fetch(`/api/publishers?limit=${ALBUMS_PER_PAGE}&offset=0&sort=${sortType}`);
        if (!publishersResponse.ok) {
          throw new Error(`Publishers API failed: ${publishersResponse.status}`);
        }
        const publishersData = await publishersResponse.json();
        const publishers = publishersData.publishers || [];
        const publisherTotal = publishersData.total || publishers.length;
        if (process.env.NODE_ENV === 'development') {
          console.log(`🎯 handleFilterChange: Received ${publishers.length}/${publisherTotal} publishers from API`);
        }

        // Convert publishers to album-like format for display
        const publisherAlbums = convertPublishersToAlbums(publishers);

        resultData = {
          albums: publisherAlbums,
          totalCount: publisherTotal,
          hasMore: publishersData.hasMore ?? (publishers.length < publisherTotal)
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
        // Single fetch - loadAlbumsData already returns totalCount
        const { albums: pageAlbums, totalCount } = await loadAlbumsData('all', ALBUMS_PER_PAGE, 0, newFilter);

        resultData = {
          albums: pageAlbums,
          totalCount,
          hasMore: pageAlbums.length < totalCount
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
      // Reset the ref after filter change completes
      setTimeout(() => { isUpdatingFromUrlRef.current = false; }, 100);
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
        if (process.env.NODE_ENV === 'development') {
          console.log(`⚠️ loadAlbumsData called with ${filter} filter - this should be handled by handleFilterChange`);
        }
        return { albums: [], totalCount: 0 }; // Return empty array to prevent showing wrong data
      }

      // 'new' uses /api/feeds/recent — music-only feeds ordered by Feed.createdAt desc
      // (when added to the app). Server preserves rank order across pages via offset; do
      // not apply client-side sortType.
      if (filter === 'new') {
        const response = await fetch(`/api/feeds/recent?limit=${limit}&offset=${offset}`);
        if (!response.ok) {
          throw new Error(`/api/feeds/recent failed: ${response.status}`);
        }
        const data = await response.json();
        return { albums: data.albums || [], totalCount: data.total || 0 };
      }

      // Handle playlist filter separately - use fast endpoint for better performance
      if (filter === 'playlist') {
        if (process.env.NODE_ENV === 'development') {
          console.log('🎵 Loading playlists using fast endpoint...');
        }

        try {
          const response = await fetch('/api/playlists-fast', { signal: AbortSignal.timeout(15000) });
          
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.albums) {
              if (process.env.NODE_ENV === 'development') {
                console.log(`✅ Loaded ${data.albums.length} playlists from fast endpoint`);
              }
              return { albums: data.albums, totalCount: data.albums.length };
            }
          }
          
          console.warn('⚠️ Fast playlist endpoint failed, falling back to individual APIs');
          
          // Fallback to individual playlist APIs if fast endpoint fails
          // 15s timeout per playlist so one unreachable upstream can't hang the
          // whole fallback; a timeout rejects that entry in allSettled.
          const playlistFetch = (path: string) => fetch(path, { signal: AbortSignal.timeout(15000) });
          const [upbeatsResponse, b4tsResponse, itdvResponse, hghResponse, iamResponse, mmmResponse, mmtResponse, sasResponse, flowgnarResponse, ltResponse, tftResponse, greatestHitsResponse] = await Promise.allSettled([
            playlistFetch('/api/playlist/upbeats'),
            playlistFetch('/api/playlist/b4ts'),
            playlistFetch('/api/playlist/itdv'),
            playlistFetch('/api/playlist/hgh'),
            playlistFetch('/api/playlist/iam'),
            playlistFetch('/api/playlist/mmm'),
            playlistFetch('/api/playlist/mmt'),
            playlistFetch('/api/playlist/sas'),
            playlistFetch('/api/playlist/flowgnar'),
            playlistFetch('/api/playlist/lt'),
            playlistFetch('/api/playlist/tft'),
            playlistFetch('/api/playlist/greatest-hits')
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

          // Process LT playlist
          if (ltResponse.status === 'fulfilled' && ltResponse.value.ok) {
            const ltData = await ltResponse.value.json();
            if (ltData.success && ltData.albums) {
              allAlbums.push(...ltData.albums);
              console.log(`✅ Loaded ${ltData.albums.length} LT playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load LT playlist');
          }

          // Process TFT playlist
          if (tftResponse.status === 'fulfilled' && tftResponse.value.ok) {
            const tftData = await tftResponse.value.json();
            if (tftData.success && tftData.albums) {
              allAlbums.push(...tftData.albums);
              console.log(`✅ Loaded ${tftData.albums.length} TFT playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load TFT playlist');
          }

          // Process Greatest Hits playlist
          if (greatestHitsResponse.status === 'fulfilled' && greatestHitsResponse.value.ok) {
            const greatestHitsData = await greatestHitsResponse.value.json();
            if (greatestHitsData.success && greatestHitsData.albums) {
              allAlbums.push(...greatestHitsData.albums);
              console.log(`✅ Loaded ${greatestHitsData.albums.length} Greatest Hits playlist albums`);
            }
          } else {
            console.warn('⚠️ Failed to load Greatest Hits playlist');
          }

          return { albums: allAlbums, totalCount: allAlbums.length };
          
        } catch (error) {
          console.error('❌ Error loading playlists:', error);
          return { albums: [], totalCount: 0 };
        }
      }
      
      // Simplified caching - only cache the main 'all' request with no filtering
      if (typeof window !== 'undefined' && loadTier === 'all' && offset === 0 && filter === 'all' && sortType === 'name-asc') {
        const cached = localStorage.getItem(`cachedAlbums_${ALBUMS_PER_PAGE}_${API_VERSION}`);
        const timestamp = localStorage.getItem(`albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`);
        
        if (cached && timestamp) {
          const age = Date.now() - parseInt(timestamp);
          if (age < 15 * 60 * 1000) { // 15 minutes cache for better performance
            if (process.env.NODE_ENV === 'development') {
              console.log('📦 Using cached albums');
            }
            const cachedAlbums = JSON.parse(cached);
            // Restore publisher stats from cache to avoid redundant API call
            const cachedStats = localStorage.getItem(`cachedPublisherStats_${API_VERSION}`);
            if (cachedStats) {
              try {
                const stats = JSON.parse(cachedStats);
                if (stats.length > 0) setPublisherStats(stats);
              } catch { /* ignore parse errors */ }
            }
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
        filter: filter,
      });
      // Only send sort param for non-default sorts; 'name-asc' maps to the server's
      // default format+alpha sort (Albums → EPs → Singles, then A-Z within each)
      if (sortType !== 'name-asc') {
        params.set('sort', sortType);
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🌐 Fetching: /api/albums-fast?${params}`);
      }
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

      // Capture format counts for format-aware pagination (when "all" filter)
      if (data.metadata?.formatCounts && filter === 'all' && offset === 0) {
        setFormatCounts(data.metadata.formatCounts);
        setCurrentFormatPhase('albums'); // Reset to albums phase on new load
        if (process.env.NODE_ENV === 'development') {
          console.log(`📊 Format counts: ${data.metadata.formatCounts.albums} albums, ${data.metadata.formatCounts.eps} EPs, ${data.metadata.formatCounts.singles} singles`);
        }
      }

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
        dateAdded: album.dateAdded,
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
          endTime: track.endTime,
          // Include video fields
          mediaType: track.mediaType,
          alternateEnclosures: track.alternateEnclosures
        })),
        publisher: album.publisher,
        podroll: album.podroll,
        funding: album.funding,
        feedId: album.feedId,
        feedUrl: album.feedUrl,
        feedGuid: album.feedGuid,
        // Include V4V payment data for boost buttons
        ...(album.v4vRecipient && { v4vRecipient: album.v4vRecipient }),
        ...(album.v4vValue && { v4vValue: album.v4vValue }),
        // The feed's npubs. AlbumCard's boost turns these into the note's `p`
        // tags; dropped here, every boost from the grid tagged no artist.
        ...(album.persons && { persons: album.persons })
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
          localStorage.setItem(`cachedPublisherStats_${API_VERSION}`, JSON.stringify(publisherStatsFromAPI));
          console.log(`💾 Cached ${rssAlbums.length} albums with ${publisherStatsFromAPI.length} publisher stats`);
        } catch (error) {
          // Handle quota exceeded error by clearing old caches
          if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)) {
            console.warn('⚠️ Storage quota exceeded, clearing old caches...');
            // Clear old album caches (different versions/page sizes)
            const keysToRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && (key.startsWith('cachedAlbums_') || key.startsWith('albumsCacheTimestamp_'))) {
                keysToRemove.push(key);
              }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key));
            console.log(`🧹 Cleared ${keysToRemove.length} old cache entries`);
            // Try caching again after cleanup
            try {
              localStorage.setItem(`cachedAlbums_${ALBUMS_PER_PAGE}_${API_VERSION}`, JSON.stringify(rssAlbums));
              localStorage.setItem(`albumsCacheTimestamp_${ALBUMS_PER_PAGE}_${API_VERSION}`, Date.now().toString());
            } catch {
              // Still failing - cache is too large, skip caching
              console.warn('⚠️ Cache too large to store, skipping');
            }
          } else {
            console.warn('⚠️ Failed to cache albums:', error);
          }
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

  // Sort helper function for albums
  const sortAlbums = useCallback((albums: RSSAlbum[], sortBy: SortType): RSSAlbum[] => {
    const sorted = [...albums];
    switch (sortBy) {
      case 'name-asc':
        return sorted.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
      case 'name-desc':
        return sorted.sort((a, b) => b.title.toLowerCase().localeCompare(a.title.toLowerCase()));
      case 'year-desc':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.releaseDate || 0).getTime();
          const dateB = new Date(b.releaseDate || 0).getTime();
          return dateB - dateA; // Newest first
        });
      case 'year-asc':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.releaseDate || 0).getTime();
          const dateB = new Date(b.releaseDate || 0).getTime();
          return dateA - dateB; // Oldest first
        });
      case 'added-desc':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.dateAdded || a.releaseDate || 0).getTime();
          const dateB = new Date(b.dateAdded || b.releaseDate || 0).getTime();
          return dateB - dateA; // Newest added first
        });
      case 'added-asc':
        return sorted.sort((a, b) => {
          const dateA = new Date(a.dateAdded || a.releaseDate || 0).getTime();
          const dateB = new Date(b.dateAdded || b.releaseDate || 0).getTime();
          return dateA - dateB; // Oldest added first
        });
      case 'tracks-desc':
        return sorted.sort((a, b) => {
          const tracksA = a.tracks?.length || a.totalTracks || 0;
          const tracksB = b.tracks?.length || b.totalTracks || 0;
          return tracksB - tracksA; // Most tracks first
        });
      case 'tracks-asc':
        return sorted.sort((a, b) => {
          const tracksA = a.tracks?.length || a.totalTracks || 0;
          const tracksB = b.tracks?.length || b.totalTracks || 0;
          return tracksA - tracksB; // Least tracks first
        });
      default:
        return sorted;
    }
  }, []);

  // Albums are now sorted server-side, just use them directly
  const filteredAlbums = displayedAlbums.length > 0 ? displayedAlbums : (isEnhancedLoaded ? enhancedAlbums : criticalAlbums);

  // Memoize expensive filtering operations to prevent re-computation on every render
  const albumsWithMultipleTracks = useMemo(() =>
    sortAlbums(
      filteredAlbums.filter(album => (album.tracks?.length || album.totalTracks || 0) >= 6),
      sortType
    ),
    [filteredAlbums, sortType, sortAlbums]
  );

  const epsOnly = useMemo(() =>
    sortAlbums(
      filteredAlbums.filter(album => {
        const trackCount = album.tracks?.length || album.totalTracks || 0;
        return trackCount >= 2 && trackCount <= 5;
      }),
      sortType
    ),
    [filteredAlbums, sortType, sortAlbums]
  );

  const singlesOnly = useMemo(() =>
    sortAlbums(
      filteredAlbums.filter(album => (album.tracks?.length || album.totalTracks || 0) === 1),
      sortType
    ),
    [filteredAlbums, sortType, sortAlbums]
  );

  // Sorted version of filteredAlbums for individual filter views (Albums, EPs, Singles tabs)
  const sortedFilteredAlbums = useMemo(() =>
    sortAlbums(filteredAlbums, sortType),
    [filteredAlbums, sortType, sortAlbums]
  );

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
      {/* Data Saver skips it: 1.93 MB of decoration, and the z-0 gradient below
          is already the designed fallback. Gating the loader rather than the
          painted div is deliberate — `backgroundImageLoaded` then simply never
          turns true, which is the same path a failed load already takes. */}
      <div className="hidden">
        {isClient && isCriticalLoaded && !dataSaver && (
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
              {/* Mobile: Dropdown filter (hidden while the mobile search is open) */}
              <select
                value={activeFilter}
                onChange={(e) => handleFilterChange(e.target.value as FilterType)}
                disabled={isFilterLoading}
                className={`md:hidden bg-gray-800 text-white px-3 py-2 rounded text-sm border border-gray-600 focus:outline-none focus:border-stablekraft-teal ${searchExpanded ? 'hidden' : ''}`}
              >
                <option value="all">All</option>
                <option value="new">New</option>
                <option value="albums">Albums</option>
                <option value="eps">EPs</option>
                <option value="singles">Singles</option>
                <option value="publishers">Publishers</option>
                <option value="playlist">Playlists</option>
                <option value="podcasts">Podcasts</option>
                <option value="videos">Videos</option>
              </select>

              {/* Desktop: Button tabs */}
              <div className="hidden md:flex gap-1">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'new', label: 'New' },
                  { value: 'albums', label: 'Albums' },
                  { value: 'eps', label: 'EPs' },
                  { value: 'singles', label: 'Singles' },
                  { value: 'publishers', label: 'Publishers' },
                  { value: 'playlist', label: 'Playlists' },
                  { value: 'podcasts', label: 'Podcasts' },
                  { value: 'videos', label: 'Videos' },
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
              <div className={`flex items-center gap-2 min-w-0 ${searchExpanded ? 'flex-1' : ''}`}>
                {/* Search Button */}
                <SearchBar onExpandedChange={setSearchExpanded} className="sm:w-auto md:min-w-[200px] lg:min-w-[300px]" />

                {/* Sibling controls — hidden on mobile while the search is expanded */}
                <div className={`items-center gap-2 flex-shrink-0 ${searchExpanded ? 'hidden' : 'flex'}`}>
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
                  className="bg-stablekraft-teal hover:bg-stablekraft-orange text-white p-2 rounded-lg transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center"
                  title="Random Shuffle"
                  aria-label="Random Shuffle"
                  style={{ minWidth: '36px', minHeight: '36px' }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display: 'block' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>

                {/* Downloads Button */}
                <Link
                  href="/downloads"
                  className="flex bg-amber-500 hover:bg-amber-600 text-white p-2 rounded-lg transition-all shadow-lg hover:shadow-xl active:scale-95 items-center justify-center flex-shrink-0"
                  title="Downloads"
                  aria-label="Downloads"
                  style={{ minWidth: '36px', minHeight: '36px' }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display: 'block' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </Link>

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
                    aria-label="Grid view"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 6v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
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
                    aria-label="List view"
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
        </div>
        {/* Main Content */}
        <div className="container mx-auto px-3 sm:px-6 py-6 sm:py-8">
          

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
              <SkeletonGrid count={12} />
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
          ) : filteredAlbums.length > 0 || activeFilter === 'new' ? (
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

              {/* Controls Bar - Sort only (other controls in main menu); options vary by filter.
                  'new' opts out — server ranks by max-track-or-feed createdAt, client sort wouldn't apply. */}
              {(activeFilter === 'all' || activeFilter === 'albums' || activeFilter === 'eps' || activeFilter === 'singles' || activeFilter === 'publishers' || activeFilter === 'playlist' || activeFilter === 'podcasts') && (
                <ControlsBar
                  activeFilter={activeFilter}
                  onFilterChange={handleFilterChange}
                  sortType={sortType}
                  onSortChange={setSortType}
                  sortOptions={currentSortOptions}
                  showFilters={false}
                  showSort={true}
                  viewType={viewType}
                  onViewChange={setViewType}
                  showViewToggle={false}
                  showShuffle={false}
                  className="mb-8"
                />
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
                          key={album.feedId || album.feedGuid || album.title}
                          album={album}
                          onPlay={playAlbum}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ) : activeFilter === 'new' ? (
                // 'New' filter — music-only feeds ordered by Feed.createdAt desc, paginated
                // via /api/feeds/recent. Render in server order (no client sort) so pages
                // stitch together correctly as infinite scroll fetches them.
                filteredAlbums.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                    {filteredAlbums.map((album) => (
                      <AlbumCard
                        key={`new-${album.feedId || album.feedGuid || album.title}`}
                        album={album}
                        onPlay={playAlbum}
                      />
                    ))}
                  </div>
                ) : (
                  <SkeletonGrid count={12} />
                )
              ) : activeFilter === 'all' ? (
                // Original sectioned layout for "All" filter
                <>
                  {/* Albums Grid */}
                  {albumsWithMultipleTracks.length > 0 && (
                      <div className="mb-12">
                        <h2 className="text-2xl font-bold mb-6 text-white">Albums</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {albumsWithMultipleTracks.map((album) => (
                              <AlbumCard
                                key={album.feedId || album.feedGuid || album.title}
                                album={album}
                                onPlay={playAlbum}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {albumsWithMultipleTracks.map((album) => (
                              <Link
                                key={album.feedId || album.feedGuid || album.title}
                                href={generateAlbumHref(album)}
                                className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                              >
                                <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                                  <ArtworkImage
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
                                    <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} singleTrackData={singleTrackFavoriteData(album as any)} />
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

                  {/* EPs Grid - Only show after all albums have loaded */}
                  {epsOnly.length > 0 && (!formatCounts || albumsWithMultipleTracks.length >= formatCounts.albums) && (
                      <div className="mb-12">
                        <h2 className="text-2xl font-bold mb-6 text-white">EPs</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {epsOnly.map((album, index) => (
                              <AlbumCard
                                key={album.feedId || album.feedGuid || album.title}
                                album={album}
                                onPlay={playAlbum}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {epsOnly.map((album, index) => (
                              <Link
                                key={album.feedId || album.feedGuid || album.title}
                                href={generateAlbumHref(album)}
                                className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                              >
                                <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                                  <ArtworkImage
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
                                    <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} singleTrackData={singleTrackFavoriteData(album as any)} />
                                  </div>
                                  <div className="hidden sm:flex items-center gap-4 text-sm text-gray-200">
                                    <span className="font-medium">{new Date(album.releaseDate).getFullYear()}</span>
                                    <span className="font-medium">{album.tracks?.length || album.totalTracks || 0} tracks</span>
                                    <span className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white font-medium">EP</span>
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

                  {/* Singles Grid - Only show after all EPs have loaded */}
                  {singlesOnly.length > 0 && (!formatCounts || (albumsWithMultipleTracks.length >= formatCounts.albums && epsOnly.length >= formatCounts.eps)) && (
                      <div>
                        <h2 className="text-2xl font-bold mb-6 text-white">Singles</h2>
                        {viewType === 'grid' ? (
                          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                            {singlesOnly.map((album, index) => (
                              <AlbumCard
                                key={album.feedId || album.feedGuid || album.title}
                                album={album}
                                onPlay={playAlbum}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {singlesOnly.map((album, index) => (
                              <Link
                                key={album.feedId || album.feedGuid || album.title}
                                href={generateAlbumHref(album)}
                                className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                              >
                                <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                                  <ArtworkImage
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
                                    <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} singleTrackData={singleTrackFavoriteData(album as any)} />
                                  </div>
                                  <div className="hidden sm:flex items-center gap-4 text-sm text-gray-200">
                                    <span className="font-medium">{new Date(album.releaseDate).getFullYear()}</span>
                                    <span className="font-medium">{album.tracks?.length || album.totalTracks || 0} tracks</span>
                                    <span className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white font-medium">Single</span>
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
                    {(activeFilter === 'albums' ? albumsWithMultipleTracks :
                      activeFilter === 'eps' ? epsOnly :
                      activeFilter === 'singles' ? singlesOnly :
                      sortedFilteredAlbums)
                      .map((album) => (
                      <AlbumCard
                        key={album.feedId || album.feedGuid || album.title}
                        album={album}
                        onPlay={playAlbum}
                        linkFilter={activeFilter === 'videos' ? 'videos' : undefined}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(activeFilter === 'albums' ? albumsWithMultipleTracks :
                      activeFilter === 'eps' ? epsOnly :
                      activeFilter === 'singles' ? singlesOnly :
                      sortedFilteredAlbums)
                      .map((album) => (
                      <Link
                        key={album.feedId || album.feedGuid || album.title}
                        href={activeFilter === 'videos' ? `${generateAlbumHref(album)}?filter=videos` : generateAlbumHref(album)}
                        className="group flex items-center gap-4 p-4 bg-black/40 backdrop-blur-md rounded-xl hover:bg-black/50 transition-all duration-300 border border-gray-700/50 hover:border-cyan-400/30 shadow-lg hover:shadow-xl hover:shadow-cyan-400/10"
                      >
                        <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 relative">
                          <ArtworkImage
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
                            <FavoriteButton feedId={album.feedId || album.feedGuid} size={20} singleTrackData={singleTrackFavoriteData(album as any)} />
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
      {/* Fullscreen Now Playing Screen is mounted globally in app/layout.tsx — do not re-render here (two instances race on body scroll-lock) */}
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