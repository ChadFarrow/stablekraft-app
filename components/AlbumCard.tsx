'use client';

import dynamic from 'next/dynamic';
import { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Pause, Music, Zap } from 'lucide-react';
import { RSSAlbum } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumHref, generateAlbumUrl } from '@/lib/url-utils';
// import CDNImage from './CDNImage'; // Replaced with direct Next.js Image for performance
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
/**
 * Lazily loaded, and it matters: BoostButton is ~1,700 lines and statically
 * imports canvas-confetti. It renders only when `showBoostModal` is true — i.e.
 * after a deliberate tap — but a static import put all of it in the initial
 * chunk of every page that renders a card, which is most of the app.
 * `ssr: false` because the modal is interaction-only and never needs to exist
 * in the server-rendered HTML.
 */
const BoostButton = dynamic(
  () => import('@/components/Lightning/BoostButton').then((m) => m.BoostButton),
  { ssr: false }
);
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { singleTrackFavoriteData } from '@/lib/favorite-target';
import DownloadButton from '@/components/downloads/DownloadButton';
import { hasV4V as checkHasV4V } from '@/lib/v4v-utils';
import { useDataSaver } from '@/hooks/useDataSaver';
import { artworkPlan } from '@/lib/data-saver';

// Hook to manage prefetch based on visibility and hover
function usePrefetchControl() {
  const [shouldPrefetch, setShouldPrefetch] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isIntersectingRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  /*
   * A ref, not the state value, because the observer below is created once with
   * an empty dep array. Reading `isHovered` directly inside that callback closes
   * over the value from the FIRST render, so it was permanently `false` — the
   * `entry.isIntersecting || isHovered` check could never see a hover. Nothing
   * broke, because the effect below already handles the hover case, but the read
   * was dead and the lint warning about it was correct.
   */
  const isHoveredRef = useRef(false);
  useEffect(() => {
    isHoveredRef.current = isHovered;
  }, [isHovered]);

  useEffect(() => {
    if (!cardRef.current) return;

    // Only prefetch if card is visible in viewport or hovered
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isIntersectingRef.current = entry.isIntersecting;
          // Enable prefetch if card is visible (within 200px of viewport) or hovered
          setShouldPrefetch(entry.isIntersecting || isHoveredRef.current);
        });
      },
      {
        rootMargin: '200px', // Start checking 200px before entering viewport
        threshold: 0
      }
    );

    observer.observe(cardRef.current);

    return () => {
      observer.disconnect();
    };
  }, []); // Empty deps - observer doesn't need to be recreated

  // Update prefetch state when hover changes
  useEffect(() => {
    setShouldPrefetch(isIntersectingRef.current || isHovered);
  }, [isHovered]);

  return { shouldPrefetch, setIsHovered, cardRef };
}

interface AlbumCardProps {
  album: RSSAlbum;
  isPlaying?: boolean;
  onPlay: (album: RSSAlbum, e: React.MouseEvent | React.TouchEvent) => void;
  className?: string;
  linkFilter?: string; // Optional filter param to append to album URL (e.g., 'videos')
}

function AlbumCard({ album, isPlaying = false, onPlay, className = '', linkFilter }: AlbumCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(null);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const { shouldPreventClick } = useScrollDetectionContext();
  
  // Prefetch control - only prefetch visible or hovered cards
  const { shouldPrefetch, setIsHovered, cardRef } = usePrefetchControl();

  // Minimum swipe/scroll distance (in px)
  const minSwipeDistance = 50;
  const minScrollDistance = 10; // Much lower threshold for detecting scroll intent

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    setTouchEnd({
      x: e.targetTouches[0].clientX,
      y: e.targetTouches[0].clientY
    });
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart || !touchEnd) return;

    const deltaX = touchStart.x - touchEnd.x;
    const deltaY = touchStart.y - touchEnd.y;

    // Calculate absolute distances
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);

    // If user scrolled vertically (even slightly), don't trigger any action
    if (verticalDistance > minScrollDistance) {
      return; // User was scrolling, not tapping
    }

    // Check for horizontal swipes
    const isLeftSwipe = deltaX > minSwipeDistance;
    const isRightSwipe = deltaX < -minSwipeDistance;

    if (isLeftSwipe) {
      // Left swipe - play next track (future enhancement)
    } else if (isRightSwipe) {
      // Right swipe - play previous track (future enhancement)
    } else if (horizontalDistance <= minScrollDistance) {
      // Tap (minimal movement in any direction) - play/pause, but check scroll detection first
      if (!shouldPreventClick()) {
        onPlay(album, e);
      }
    }
  }, [touchStart, touchEnd, shouldPreventClick, onPlay, album]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    setImageError(false);
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoaded(false);
  }, []);

  // Let Next.js handle lazy loading natively - much simpler and faster

  /*
   * These are read out of `album` into locals BEFORE the memos below.
   *
   * `(album as any).image` inside a dependency array is a "complex expression"
   * that the exhaustive-deps rule cannot check statically — it warns and then
   * verifies nothing, so the arrays it was supposed to be guarding were
   * unguarded. Naming the values first makes the deps plain identifiers, which
   * the rule can check, and the behaviour is identical: the same values, read at
   * the same time, compared the same way.
   */
  const albumImage = (album as any).image as string | undefined;
  const isPlaylistCardProp = (album as any).isPlaylistCard as boolean | undefined;
  const playlistUrlProp = (album as any).playlistUrl as string | undefined;
  const albumUrlProp = (album as any).albumUrl as string | undefined;
  const isPublisherCardProp = (album as any).isPublisherCard as boolean | undefined;
  const publisherUrlProp = (album as any).publisherUrl as string | undefined;
  const isPodcastProp = (album as any).isPodcast as boolean | undefined;
  const albumCoverArt = album.coverArt;
  const albumTitle = album.title;
  const albumId = album.id;

  const artworkUrl = useMemo(() =>
    getAlbumArtworkUrl(albumCoverArt || albumImage || '', 'large'), // Use larger images for better quality
    [albumCoverArt, albumImage]
  );

  /**
   * `unoptimized` below is hardcoded TODAY, and on purpose: 271a6ba8 added it to
   * fix artwork that looked blurry. The cost is that `width`, `height` and
   * `sizes` on the same element do nothing — Next never resizes — so a
   * 1400x1400 / 1.26 MB cover is downloaded into a 180px box. That is the
   * single largest transfer on the home grid, and this card draws the grid,
   * search, favorites, publisher and playlist pages.
   *
   * Data Saver is the user electing to take the softer image. With it off this
   * resolves to exactly the values that were here before.
   */
  const dataSaver = useDataSaver();
  const artwork = useMemo(
    () => artworkPlan({
      src: artworkUrl,
      dataSaver,
      baseline: { quality: 75, unoptimized: true }, // 75 is Next's own default.
    }),
    [artworkUrl, dataSaver]
  );
  
  // Check if this is a playlist card, publisher card, and use appropriate URL
  const { isPlaylistCard, isPublisherCard, albumUrl } = useMemo(() => {
    const isPlaylistCard = isPlaylistCardProp;
    const isPublisherCard = isPublisherCardProp;
    let albumUrl: string;

    if (isPublisherCard) {
      albumUrl = publisherUrlProp || `/publisher/${albumId}`;
    } else if (isPlaylistCard) {
      albumUrl = playlistUrlProp || (albumUrlProp as string);
    } else if (isPodcastProp) {
      albumUrl = generateAlbumUrl(albumTitle, 'podcast');
    } else {
      albumUrl = generateAlbumHref(album);
    }

    // Append filter param if provided (e.g., ?filter=videos for video albums)
    if (linkFilter && !isPublisherCard && !isPlaylistCard) {
      albumUrl = `${albumUrl}?filter=${linkFilter}`;
    }

    return { isPlaylistCard, isPublisherCard, albumUrl };
    // albumFeedId is in the deps because it now drives the href — without it a recycled
    // card can keep a stale link across two feeds sharing a title (the #183 collision).
    // `album` is listed because generateAlbumHref() reads the whole object. It
    // is a prop, so this costs nothing: AlbumCard's custom memo comparator is
    // what decides whether a new album identity re-renders the card at all.
    //
    // It also subsumes the explicit `album.feedId` dep that used to be here for
    // the #183 collision — a recycled card keeping a stale link across two feeds
    // that share a title. A changed feedId means a changed `album`, so the
    // protection is still exact.
  }, [album, albumTitle, albumId, isPlaylistCardProp, playlistUrlProp, albumUrlProp, isPublisherCardProp, publisherUrlProp, isPodcastProp, linkFilter]);

  const hasV4V = checkHasV4V(album as any);
  

  return (
    <>
    <div ref={cardRef}>
    <Link 
      href={albumUrl}
      prefetch={shouldPrefetch}
      className={`group relative bg-gray-900/95 rounded-xl border border-gray-700/50 overflow-hidden transition-all duration-300 hover:bg-gray-900 hover:border-cyan-400/30 hover:scale-[1.02] active:scale-[0.98] block shadow-lg hover:shadow-xl hover:shadow-cyan-400/10 ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        // Prevent navigation if user was scrolling
        if (shouldPreventClick()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }}
      aria-label={isPublisherCard ? `View artist page for ${album.title}` : `View album details for ${album.title} by ${album.artist}`}
    >
      {/* Album Artwork */}
      <div 
        className="relative w-full aspect-square overflow-hidden"
        onTouchStart={(e) => {
          // Only handle touch events on the artwork area, not on the play button
          if (!(e.target as HTMLElement).closest('button')) {
            onTouchStart(e);
          }
        }}
        onTouchMove={(e) => {
          if (!(e.target as HTMLElement).closest('button')) {
            onTouchMove(e);
          }
        }}
        onTouchEnd={(e) => {
          if (!(e.target as HTMLElement).closest('button')) {
            onTouchEnd(e);
          }
        }}
        onClick={(e) => {
          // Prevent navigation when clicking on the artwork area (play button handles its own clicks)
          if (!(e.target as HTMLElement).closest('button')) {
            // Let the Link handle the navigation
          }
        }}
      >
        <Image
          src={artworkUrl}
          alt={`${album.title} by ${album.artist}`}
          width={300}
          height={300}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ aspectRatio: '1/1' }}
          onLoad={handleImageLoad}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = getPlaceholderImageUrl('thumbnail');
            handleImageError();
          }}
          priority={false}
          loading="lazy"
          sizes="(max-width: 768px) 160px, (max-width: 1200px) 180px, 300px"
          placeholder="empty"
          quality={artwork.quality}
          unoptimized={artwork.unoptimized}
        />
        
        {/* Loading placeholder */}
        {(!imageLoaded && !imageError) && (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
            <Music className="w-8 h-8 text-gray-400 animate-pulse" />
          </div>
        )}
        
        {/* Error placeholder */}
        {imageError && (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
            <Music className="w-8 h-8 text-gray-400" />
          </div>
        )}

        {/* Play/Pause Overlay - Always visible on mobile, hover-based on desktop */}
        <div className="absolute inset-0 bg-black/20 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center pointer-events-none">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              // Use scroll detection context to prevent accidental clicks
              if (!shouldPreventClick()) {
                onPlay(album, e);
              }
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              // Mark that we're interacting with button
              (e.currentTarget as HTMLElement).dataset.touched = 'true';
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
              
              const button = e.currentTarget as HTMLElement;
              if (button.dataset.touched === 'true') {
                delete button.dataset.touched;
                // Increased delay to ensure it's a deliberate tap, not accidental during scroll
                setTimeout(() => {
                  if (!shouldPreventClick()) {
                    onPlay(album, e);
                  }
                }, 150);
              }
            }}
            className="w-16 h-16 md:w-12 md:h-12 bg-cyan-500/40 rounded-full flex items-center justify-center hover:bg-cyan-400/50 active:bg-cyan-400/60 transition-colors duration-200 touch-manipulation pointer-events-auto border border-cyan-400/30 hover:border-cyan-400/50 shadow-lg shadow-cyan-400/20"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 text-white" />
            ) : (
              <Play className="w-6 h-6 text-white ml-1" />
            )}
          </button>
        </div>

        {/* Track count badge or album count for publishers */}
        {(((album as any).trackCount || album.tracks?.length || 0) > 0 || isPublisherCard) && (
          <div className="absolute top-1 right-1 sm:top-2 sm:right-2 bg-black/90 rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs text-white border border-gray-600">
            {isPublisherCard
              ? `${(album as any).albumCount || 0} ${((album as any).albumCount || 0) !== 1 ? 'releases' : 'release'}`
              : (() => {
                  const count = (album as any).trackCount || album.tracks?.length || 0;
                  const isPodcast = (album as any).isPodcast === true;
                  // `hasVideoTracks` is for callers that omit `album.tracks`
                  // — listing pages, which no longer ship a track list per
                  // album. When the tracks ARE present that answer is exact and
                  // still wins.
                  const hasVideo = album.tracks?.length
                    ? album.tracks.some((t: any) =>
                        t.mediaType === 'video' ||
                        (t.alternateEnclosures && t.alternateEnclosures.some((enc: any) => enc.type?.includes('video')))
                      )
                    : (album as any).hasVideoTracks === true;
                  const label = isPodcast
                    ? (count !== 1 ? 'episodes' : 'episode')
                    : hasVideo ? (count !== 1 ? 'videos' : 'video') : (count !== 1 ? 'tracks' : 'track');
                  return `${count} ${label}`;
                })()
            }
          </div>
        )}

        {/* Favorite Button - Heart icon in bottom-right corner */}
        {(album as any).feedId && (
          <div
            className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2 z-20 flex items-center gap-1.5"
            onClick={(e) => {
              // preventDefault is required (not just stopPropagation): taps on the
              // circular padding — or the empty circle when DownloadButton renders
              // null — would otherwise trigger the parent <Link>'s default anchor
              // navigation to the album page.
              e.preventDefault();
              e.stopPropagation();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {/* The `album.tracks?.length` gate this used to carry is gone on
                purpose: a listing page no longer sends a track list, so it hid
                the download button on every card. DownloadButton makes the
                decision itself now, from the track list when there is one and
                from `downloadableTrackCount` when there is not. */}
            {!isPublisherCard && !isPlaylistCard && (album as any).feedId ? (
              <div className="bg-black/80 rounded-full w-8 h-8 flex items-center justify-center pointer-events-auto touch-manipulation hover:bg-black/90 transition-colors">
                <DownloadButton
                  downloadTarget={{
                    type: 'album',
                    album: album as any,
                    downloadableTrackCount: (album as any).downloadableTrackCount,
                  }}
                  size={18}
                  className="text-white"
                />
              </div>
            ) : null}
            <div className="bg-black/80 rounded-full w-8 h-8 flex items-center justify-center pointer-events-auto touch-manipulation hover:bg-black/90 transition-colors">
              <FavoriteButton
                feedId={(album as any).feedId}
                size={18}
                className="text-white"
                singleTrackData={singleTrackFavoriteData(album as any)}
                favoriteType={isPublisherCard ? 'publisher' : isPlaylistCard ? 'playlist' : 'album'}
              />
            </div>
          </div>
        )}

        {/* HGH Music badge - positioned below boost button if both exist */}
        {(album as any).isHGHMusic && (
          <div className={`absolute ${hasV4V ? 'top-10 sm:top-12' : 'top-1 sm:top-2'} left-1 sm:left-2 bg-green-600 rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs text-white font-semibold border border-green-500/50 z-10`}>
            HGH
          </div>
        )}

        {/* Boost Button - Lightning bolt in top-left corner */}
        {hasV4V && (
          <div
            className="absolute top-1 left-1 sm:top-2 sm:left-2 z-20"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowBoostModal(true);
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowBoostModal(true);
              }}
              className="w-8 h-8 sm:w-9 sm:h-9 bg-yellow-500 hover:bg-yellow-400 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg border border-yellow-400/50 pointer-events-auto touch-manipulation"
              aria-label="Boost this album"
              title="Send a Lightning boost"
            >
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-black fill-black" />
            </button>
          </div>
        )}
      </div>

      {/* Album Info */}
      <div className="p-2 sm:p-3 bg-gray-900/95">
        <h3 className="font-bold text-white text-xs sm:text-sm leading-tight line-clamp-2 group-hover:text-cyan-400 transition-colors duration-200">
          {album.title}
        </h3>
        <p className="text-gray-300 text-[10px] sm:text-xs mt-0.5 sm:mt-1 line-clamp-1 font-medium">
          {album.artist}
        </p>

        {/* Release date or episode date */}
        {(album.releaseDate || (album as any).isMusicTrackAlbum) && (
          <p className="text-gray-300 text-[10px] sm:text-xs mt-0.5 sm:mt-1 font-medium">
            {(album as any).isMusicTrackAlbum
              ? new Date(album.releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : new Date(album.releaseDate).getFullYear()
            }
          </p>
        )}
      </div>

      {/* Mobile touch feedback */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-white/5 opacity-0 group-active:opacity-100 transition-opacity duration-150" />
      </div>
    </Link>
    </div>

    {showBoostModal && (
      <BoostButton
        feedId={(album as any).feedId}
        trackTitle={album.title}
        artistName={album.artist}
        lightningAddress={(album as any).v4vRecipient}
        valueSplits={(album as any).v4vValue?.recipients || (album as any).v4vValue?.destinations || []}
        autoOpen={true}
        onClose={() => setShowBoostModal(false)}
        feedUrl={(album as any).feedUrl || album.link}
        // No `|| album.id` fallback. `album.id` is a StableKraft slug, and
        // this prop becomes `podcast:item:guid:<slug>` on a public boost note
        // — an identifier no other app can resolve (#242). An absent item
        // guid is dropped by `podcastIdentifierTags`, so the note names the
        // show only, which is true rather than misleading.
        episodeGuid={(album as any).guid || undefined}
        remoteFeedGuid={(album as any).feedGuid}
        albumName={album.title}
        publisherGuid={(album as any).publisher?.feedGuid}
        persons={(album as any).persons || []}
      />
    )}
  </>
  );
}

// Memoize the component to prevent unnecessary re-renders
// Only re-render if album id, title, isPlaying status, or className changes
export default memo(AlbumCard, (prevProps, nextProps) => {
  return (
    prevProps.album.id === nextProps.album.id &&
    prevProps.album.title === nextProps.album.title &&
    prevProps.album.artist === nextProps.album.artist &&
    prevProps.album.coverArt === nextProps.album.coverArt &&
    prevProps.isPlaying === nextProps.isPlaying &&
    prevProps.className === nextProps.className &&
    (prevProps.album.tracks?.length || 0) === (nextProps.album.tracks?.length || 0) &&
    // Listing pages send this instead of a track list, so on those pages the
    // line above compares 0 to 0 and would never notice a change.
    (prevProps.album as any).downloadableTrackCount ===
      (nextProps.album as any).downloadableTrackCount &&
    (prevProps.album as any).v4vRecipient === (nextProps.album as any).v4vRecipient &&
    (prevProps.album as any).v4vValue === (nextProps.album as any).v4vValue
  );
});