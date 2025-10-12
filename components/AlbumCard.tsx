'use client';

import { useState, useRef, useEffect, memo, useCallback, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Pause, Music, Zap } from 'lucide-react';
import { RSSAlbum } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl } from '@/lib/url-utils';
// import CDNImage from './CDNImage'; // Replaced with direct Next.js Image for performance
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import { BoostButton } from '@/components/Lightning/BoostButton';

interface AlbumCardProps {
  album: RSSAlbum;
  isPlaying?: boolean;
  onPlay: (album: RSSAlbum, e: React.MouseEvent | React.TouchEvent) => void;
  className?: string;
}

function AlbumCard({ album, isPlaying = false, onPlay, className = '' }: AlbumCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [showBoostModal, setShowBoostModal] = useState(false);
  const { shouldPreventClick } = useScrollDetectionContext();

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      // Left swipe - play next track (future enhancement)
    } else if (isRightSwipe) {
      // Right swipe - play previous track (future enhancement)
    } else {
      // Tap - play/pause, but check scroll detection first
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

  const artworkUrl = useMemo(() => 
    getAlbumArtworkUrl(album.coverArt || (album as any).image || '', 'large'), // Use larger images for better quality
    [album.coverArt, (album as any).image]
  );
  
  // Check if this is a playlist card, publisher card, and use appropriate URL
  const { isPlaylistCard, isPublisherCard, albumUrl } = useMemo(() => {
    const isPlaylistCard = (album as any).isPlaylistCard;
    const isPublisherCard = (album as any).isPublisherCard;
    let albumUrl: string;

    if (isPublisherCard) {
      albumUrl = (album as any).publisherUrl || `/publisher/${album.id}`;
    } else if (isPlaylistCard) {
      albumUrl = (album as any).playlistUrl || (album as any).albumUrl;
    } else {
      albumUrl = generateAlbumUrl(album.title);
    }

    return { isPlaylistCard, isPublisherCard, albumUrl };
  }, [album.title, album.id, (album as any).isPlaylistCard, (album as any).playlistUrl, (album as any).isPublisherCard, (album as any).publisherUrl]);

  // Debug logging for V4V data - ALWAYS log first 3 albums
  const hasV4V = !!((album as any).v4vRecipient || (album as any).v4vValue);
  if (typeof window !== 'undefined' && Math.random() < 0.06) {  // ~3 out of 50 albums
    console.log(`[AlbumCard] "${album.title}":`, {
      hasV4V,
      v4vRecipient: (album as any).v4vRecipient,
      v4vValue: !!((album as any).v4vValue)
    });
  }
  

  return (
    <>
    <Link 
      href={albumUrl}
      className={`group relative bg-black/40 backdrop-blur-md rounded-xl border border-gray-700/50 overflow-hidden transition-all duration-300 hover:bg-black/50 hover:border-cyan-400/30 hover:scale-[1.02] active:scale-[0.98] block shadow-lg hover:shadow-xl hover:shadow-cyan-400/10 ${className}`}
      onClick={(e) => {
        // Navigation handled by Link component
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
          unoptimized
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
            className="w-16 h-16 md:w-12 md:h-12 bg-cyan-400/20 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-cyan-400/30 active:bg-cyan-400/40 transition-colors duration-200 touch-manipulation pointer-events-auto border border-cyan-400/30 hover:border-cyan-400/50 shadow-lg shadow-cyan-400/20"
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
        {((album.tracks?.length || 0) > 0 || isPublisherCard) && (
          <div className="absolute top-1 right-1 sm:top-2 sm:right-2 bg-black/80 backdrop-blur-sm rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs text-white border border-gray-600">
            {isPublisherCard 
              ? `${(album as any).albumCount || 0} ${((album as any).albumCount || 0) !== 1 ? 'releases' : 'release'}`
              : `${album.tracks?.length || 0} ${(album.tracks?.length || 0) !== 1 ? 'tracks' : 'track'}`
            }
          </div>
        )}

        {/* HGH Music badge - positioned below boost button if both exist */}
        {(album as any).isHGHMusic && (
          <div className={`absolute ${((album as any).v4vRecipient || (album as any).v4vValue) ? 'top-10 sm:top-12' : 'top-1 sm:top-2'} left-1 sm:left-2 bg-green-600/90 backdrop-blur-sm rounded-full px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs text-white font-semibold border border-green-500/50 z-10`}>
            HGH
          </div>
        )}

        {/* Boost Button - Lightning bolt in top-left corner */}
        {((album as any).v4vRecipient || (album as any).v4vValue) && (
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
              className="w-8 h-8 sm:w-9 sm:h-9 bg-yellow-500/90 hover:bg-yellow-400 backdrop-blur-sm rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 shadow-lg border border-yellow-400/50 pointer-events-auto touch-manipulation"
              aria-label="Boost this album"
              title="Send a Lightning boost"
            >
              <Zap className="w-4 h-4 sm:w-5 sm:h-5 text-black fill-black" />
            </button>
          </div>
        )}
      </div>

      {/* Album Info */}
      <div className="p-2 sm:p-3 bg-black/60 backdrop-blur-sm">
        <h3 className="font-bold text-white text-xs sm:text-sm leading-tight line-clamp-2 group-hover:text-cyan-400 transition-colors duration-200">
          {album.title}
        </h3>
        <p className="text-gray-300 text-[10px] sm:text-xs mt-0.5 sm:mt-1 line-clamp-1 font-medium">
          {album.artist}
        </p>

        {/* Release date or episode date */}
        {(album.releaseDate || (album as any).isMusicTrackAlbum) && (
          <p className="text-gray-400 text-[10px] sm:text-xs mt-0.5 sm:mt-1 font-medium">
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

    {showBoostModal && (
      <div
        className="fixed inset-0 z-[100]"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="relative max-w-md w-full">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowBoostModal(false);
              }}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors"
              aria-label="Close"
            >
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <BoostButton
              feedId={(album as any).feedId}
              trackTitle={album.title}
              artistName={album.artist}
              lightningAddress={(album as any).v4vRecipient}
              valueSplits={(album as any).v4vValue?.recipients}
            />
          </div>
        </div>
      </div>
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
    (prevProps.album as any).v4vRecipient === (nextProps.album as any).v4vRecipient &&
    (prevProps.album as any).v4vValue === (nextProps.album as any).v4vValue
  );
});