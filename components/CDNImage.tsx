'use client';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';

// Mapping of large GIFs to their video conversions
const GIF_TO_VIDEO_MAP: Record<string, { mp4: string; webm: string }> = {
  'you-are-my-world.gif': { mp4: 'you-are-my-world.mp4', webm: 'you-are-my-world.webm' },
  'HowBoutYou.gif': { mp4: 'HowBoutYou.mp4', webm: 'HowBoutYou.webm' },
  'autumn.gif': { mp4: 'autumn.mp4', webm: 'autumn.webm' },
  'alandace.gif': { mp4: 'alandace.mp4', webm: 'alandace.webm' },
  'Polar-Embrace-Feed-art-hires.gif': { mp4: 'Polar-Embrace-Feed-art-hires.mp4', webm: 'Polar-Embrace-Feed-art-hires.webm' },
  'Subrero_pt3_art.gif': { mp4: 'Subrero_pt3_art.mp4', webm: 'Subrero_pt3_art.webm' },
  'Baiasilko_movie.gif': { mp4: 'Baiasilko_movie.mp4', webm: 'Baiasilko_movie.webm' },
  'the-satellite-skirmish-mku.gif': { mp4: 'the-satellite-skirmish-mku.mp4', webm: 'the-satellite-skirmish-mku.webm' },
  'Samurai_Holiday_Acoustic_art.gif': { mp4: 'Samurai_Holiday_Acoustic_art.mp4', webm: 'Samurai_Holiday_Acoustic_art.webm' },
  'ABD_Acoustic_artwork.gif': { mp4: 'ABD_Acoustic_artwork.mp4', webm: 'ABD_Acoustic_artwork.webm' },
  'Subrero_pt2_art.gif': { mp4: 'Subrero_pt2_art.mp4', webm: 'Subrero_pt2_art.webm' },
};

interface CDNImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'gif' | 'auto';
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  onError?: () => void;
  onLoad?: () => void;
  fallbackSrc?: string;
  sizes?: string;
  placeholder?: 'blur' | 'empty';
  style?: React.CSSProperties;
}

export default function CDNImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
  quality = 85,
  onError,
  onLoad,
  fallbackSrc,
  sizes,
  placeholder = 'empty',
  style,
  ...props
}: CDNImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  const [retryCount, setRetryCount] = useState(0);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [isGif, setIsGif] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifLoaded, setGifLoaded] = useState(false);
  const [gifPlaceholder, setGifPlaceholder] = useState<string | null>(null);
  const [placeholderLoaded, setPlaceholderLoaded] = useState(false);
  const [useVideo, setUseVideo] = useState(false);
  const [videoFormats, setVideoFormats] = useState<{ mp4: string; webm: string } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Check if we're on mobile
  const [isMobile, setIsMobile] = useState(false);
  const [isTablet, setIsTablet] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  
  // Simplified src change handling - no forced re-renders
  useEffect(() => {
    if (src && src !== currentSrc) {
      setCurrentSrc(src);
      setHasError(false);
      setIsLoading(true);
    } else if (!src || src.trim() === '') {
      // Handle empty src by showing error state immediately
      setCurrentSrc('');
      setHasError(true);
      setIsLoading(false);
    }
  }, [src]);
  
  // Detect if the image is a GIF
  useEffect(() => {
    const isGifImage = Boolean((src && typeof src === 'string' && src.toLowerCase().includes('.gif')) ||
                      (currentSrc && typeof currentSrc === 'string' && currentSrc.toLowerCase().includes('.gif')));
    setIsGif(isGifImage);
  }, [src, currentSrc]);

  // Check if GIF has a video conversion available (static mapping or cached)
  useEffect(() => {
    if (!isGif || !currentSrc) {
      setUseVideo(false);
      setVideoFormats(null);
      return;
    }

    // First check static mapping for pre-converted GIFs
    const filename = currentSrc.split('/').pop()?.split('?')[0];
    // Try direct match first, then decoded/normalized match
    const decodedFilename = filename ? decodeURIComponent(filename).replace(/ /g, '-') : '';
    const matchedKey = filename && GIF_TO_VIDEO_MAP[filename] ? filename :
      (decodedFilename && GIF_TO_VIDEO_MAP[decodedFilename] ? decodedFilename : null);

    if (matchedKey && GIF_TO_VIDEO_MAP[matchedKey]) {
      const videos = GIF_TO_VIDEO_MAP[matchedKey];
      setVideoFormats({
        mp4: `/api/optimized-images/${videos.mp4}`,
        webm: `/api/optimized-images/${videos.webm}`,
      });
      setUseVideo(true);
      return;
    }

    // Then check dynamic cache for feed-parsed GIFs
    const checkCachedVideo = async () => {
      try {
        const response = await fetch(`/api/check-video?gif=${encodeURIComponent(currentSrc)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.hasVideo && data.mp4 && data.webm) {
            setVideoFormats({
              mp4: data.mp4,
              webm: data.webm,
            });
            setUseVideo(true);
            return;
          }
        }
      } catch (error) {
        // Silently fail - will use GIF instead
      }
      setUseVideo(false);
      setVideoFormats(null);
    };

    checkCachedVideo();
  }, [isGif, currentSrc]);
  
  useEffect(() => {
    setIsClient(true);
    const checkDevice = () => {
      const width = window.innerWidth;
      const ua = navigator.userAgent;
      setIsMobile(width <= 768);
      setIsTablet(width > 768 && width <= 1024);
      setUserAgent(ua);
      
      // Mobile detection without logging for performance
    };
    
    checkDevice();
    const handleResize = () => checkDevice();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load GIF placeholder (first frame) for faster initial render
  useEffect(() => {
    if (!isGif || !isClient || !currentSrc || placeholderLoaded) return;

    // Only fetch placeholder for external GIFs (not data URLs or API routes)
    if (currentSrc.startsWith('data:') || currentSrc.includes('/api/')) {
      setPlaceholderLoaded(true);
      return;
    }

    // Generate placeholder URL
    const placeholderUrl = `/api/gif-placeholder?url=${encodeURIComponent(currentSrc)}`;
    
    // Preload the placeholder - only in browser context
    if (typeof window !== 'undefined' && window.Image) {
      const img = new window.Image();
      img.onload = () => {
        setGifPlaceholder(placeholderUrl);
        setPlaceholderLoaded(true);
        
        // Once placeholder is loaded, start preloading the full GIF in the background
        // This ensures the full GIF is ready when we want to show it
        if (currentSrc && !gifLoaded) {
          const fullGifImg = new window.Image();
          fullGifImg.onload = () => {
            setGifLoaded(true);
          };
          fullGifImg.src = currentSrc;
        }
      };
      img.onerror = () => {
        // If placeholder fails, just proceed without it
        setPlaceholderLoaded(true);
      };
      img.src = placeholderUrl;
    } else {
      // Fallback if Image constructor is not available
      setPlaceholderLoaded(true);
    }
  }, [isGif, isClient, currentSrc, placeholderLoaded, gifLoaded]);

  // Intersection Observer for GIF lazy loading
  useEffect(() => {
    if (!isGif || !isClient || priority) {
      setShowGif(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShowGif(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before the image is visible
        threshold: 0.1
      }
    );

    if (imageRef.current) {
      observer.observe(imageRef.current);
    }

    return () => observer.disconnect();
  }, [isGif, isClient, priority]);

  // Generate optimized image URL
  const getOptimizedUrl = (originalUrl: string, targetWidth?: number, targetHeight?: number) => {
    // If it's already an optimized URL, return as is
    if (originalUrl.includes('/api/optimized-images/')) {
      return originalUrl;
    }
    
    // For large images, use optimized endpoint
    const largeImages = [
      'you-are-my-world.gif',
      'HowBoutYou.gif',
      'autumn.gif',
      'WIldandfreecover-copy-2.png',
      'alandace.gif',
      'doerfel-verse-idea-9.png',
      'SatoshiStreamer-track-1-album-art.png',
      'dvep15-art.png',
      'disco-swag.png',
      'first-christmas-art.jpg',
      'let-go-art.png',
      'Polar-Embrace-Feed-art-hires.gif',
      'Subrero_pt3_art.gif',
      'Baiasilko_movie.gif',
      'the-satellite-skirmish-mku.gif',
      'Samurai_Holiday_Acoustic_art.gif',
      'ABD_Acoustic_artwork.gif',
      'Subrero_pt2_art.gif',
    ];
    
    const filename = originalUrl.split('/').pop();
    // Decode URL and normalize spaces/hyphens for matching
    const decodedFilename = filename ? decodeURIComponent(filename).replace(/ /g, '-') : '';
    if (filename && largeImages.some(img => {
      const imgBase = img.replace(/\.(png|jpg|gif)$/, '');
      return decodedFilename.includes(imgBase) || filename.includes(imgBase);
    })) {
      const optimizedFilename = largeImages.find(img => {
        const imgBase = img.replace(/\.(png|jpg|gif)$/, '');
        return decodedFilename.includes(imgBase) || filename.includes(imgBase);
      });
      if (optimizedFilename) {
        let optimizedUrl = `https://stablekraft.app/api/optimized-images/${optimizedFilename}`;
        
        // Add size parameters for responsive loading
        if (targetWidth || targetHeight) {
          const params = new URLSearchParams();
          if (targetWidth) params.set('w', targetWidth.toString());
          if (targetHeight) params.set('h', targetHeight.toString());
          params.set('q', quality.toString());
          
          // Use WebP for better compression if supported (but not for GIFs)
          if (typeof window !== 'undefined' && window.navigator.userAgent.includes('Chrome') && !isGif) {
            params.set('f', 'webp');
          }
          
          optimizedUrl += `?${params.toString()}`;
        }
        
        return optimizedUrl;
      }
    }
    
    return originalUrl;
  };

  const getResponsiveSizes = () => {
    if (sizes) return sizes;
    
    // For GIFs, use smaller sizes to improve performance
    if (isGif) {
      if (isMobile) {
        return '(max-width: 768px) 200px, (max-width: 1024px) 300px, 400px';
      } else if (isTablet) {
        return '(max-width: 1024px) 300px, 400px';
      } else {
        return '(max-width: 768px) 200px, (max-width: 1024px) 300px, 400px';
      }
    }
    
    if (isMobile) {
      return '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw';
    } else if (isTablet) {
      return '(max-width: 1024px) 50vw, 33vw';
    } else {
      return '(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw';
    }
  };

  const getImageDimensions = () => {
    if (width && height) {
      return { width, height };
    }
    
    // For GIFs, use smaller dimensions to improve performance
    if (isGif) {
      if (isMobile) {
        return { width: 200, height: 200 };
      } else if (isTablet) {
        return { width: 300, height: 300 };
      } else {
        return { width: 400, height: 400 };
      }
    }
    
    // Default dimensions for mobile optimization
    if (isMobile) {
      return { width: 300, height: 300 };
    } else if (isTablet) {
      return { width: 400, height: 400 };
    } else {
      return { width: 500, height: 500 };
    }
  };

  const getOriginalUrl = (imageUrl: string) => {
    if (imageUrl.includes('/api/optimized-images/')) {
      // Extract original URL from optimized URL
      const filename = imageUrl.split('/').pop()?.split('?')[0];
      if (filename) {
        // This is a simplified fallback - in practice, you'd need a mapping
        return fallbackSrc || imageUrl;
      }
    }
    return fallbackSrc || imageUrl;
  };

  const handleError = () => {
    // Prevent recursion by checking if component is unmounted or src changed
    if (!src || hasError) return;
    
    // Minimal error handling for performance
    setIsLoading(false);
    
    // Clear timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    
    // First try the fallback URL if provided and different
    if (retryCount === 0 && fallbackSrc && fallbackSrc !== currentSrc) {
      setCurrentSrc(fallbackSrc);
      setHasError(false);
      setIsLoading(true);
      setRetryCount(1);
      return;
    }
    
    // If fallbackSrc is the same as currentSrc, skip to proxy attempt
    if (retryCount === 0 && fallbackSrc === currentSrc) {
      setRetryCount(1);
      return;
    }
    
    // Try image proxy for CORS errors (all devices)
    if (retryCount === 1 && !currentSrc.includes('/api/') && !currentSrc.startsWith('data:')) {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(currentSrc)}`;
      setCurrentSrc(proxyUrl);
      setHasError(false);
      setIsLoading(true);
      setRetryCount(2);
      return;
    }
    
    // Then try without optimization
    if (retryCount === 2 && currentSrc.includes('/api/optimized-images/')) {
      const originalUrl = getOriginalUrl(currentSrc);
      if (originalUrl && originalUrl !== currentSrc) {
        setCurrentSrc(originalUrl);
        setHasError(false);
        setIsLoading(true);
        setRetryCount(3);
        return;
      }
    }
    
    // All retry attempts have failed - only now call onError and show placeholder
    setHasError(true);
    // Don't call onError to prevent recursion - just show placeholder
  };

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
    setGifLoaded(true);
    
    // Clear timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    
    onLoad?.();
  };

  // Reset state when src changes
  useEffect(() => {
    if (!src) return;
    
    const dims = getImageDimensions();
    let imageSrc = src;
    
    // Never proxy data URLs - they're self-contained
    if (src.startsWith('data:')) {
      imageSrc = src;
    }
    // Only use proxy for known problematic URLs, try direct loading first
    // These domains don't return CORS headers, causing OpaqueResponseBlocking
    else if (src && (
      src.includes('static.wixstatic.com') ||
      src.includes('f4.bcbits.com') ||
      src.includes('thebearsnare.com') ||
      src.includes('f.strangetextures.com')
    )) {
      imageSrc = `/api/proxy-image?url=${encodeURIComponent(src)}`;
    } else {
      // Try direct loading first for better performance
      imageSrc = getOptimizedUrl(src, dims.width, dims.height);
    }
    
    setCurrentSrc(imageSrc);
    setIsLoading(true);
    setHasError(false);
    setRetryCount(0);
    setGifLoaded(false);
    setGifPlaceholder(null);
    setPlaceholderLoaded(false);
    
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
  }, [src, width, height, isClient, isMobile]); // Only run when src prop changes

  // Separate effect for handling timeouts to prevent recursion
  useEffect(() => {
    if (hasError || !isLoading || !currentSrc) return;
    
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }
    
    // Set timeout based on retry count and whether it's a GIF or proxy URL
    let timeout: NodeJS.Timeout;
    const isProxyUrl = currentSrc.includes('/api/proxy-image');
    const isCloudFrontProxy = isProxyUrl && currentSrc.includes('cloudfront.net');
    
    if (retryCount === 0) {
      // Initial load timeout - shorter for better UX
      const timeoutMs = isProxyUrl ? 8000 : (isGif ? 8000 : 10000);
      timeout = setTimeout(() => {
        if (!hasError) handleError();
      }, timeoutMs);
    } else if (retryCount === 1) {
      // Fallback/proxy timeout
      timeout = setTimeout(() => {
        if (!hasError) handleError();
      }, isGif ? 8000 : 10000);
    } else if (retryCount === 2) {
      // Proxy timeout
      timeout = setTimeout(() => {
        if (!hasError) handleError();
      }, isGif ? 10000 : 12000);
    } else if (retryCount === 3) {
      // Original URL timeout
      timeout = setTimeout(() => {
        if (!hasError) handleError();
      }, isGif ? 12000 : 15000);
    } else {
      // No more retries
      return;
    }
    
    setTimeoutId(timeout);
    
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [currentSrc, retryCount, isLoading, hasError, isGif]); // Run when retry state changes

  const dims = getImageDimensions();

  return (
    <div className={`relative ${className || ''}`} ref={imageRef}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-800/50 animate-pulse rounded flex items-center justify-center">
          <div className="w-6 h-6 bg-white/20 rounded-full animate-spin"></div>
          {isGif && (
            <div className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded">
              🎬 GIF
            </div>
          )}
        </div>
      )}
      
      {hasError && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-700 to-gray-800 rounded flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 mx-auto mb-2 text-gray-400">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <div className="text-white/60 text-xs">No artwork</div>
          </div>
        </div>
      )}

      {/* Video rendering for converted GIFs - much smaller file sizes */}
      {useVideo && videoFormats && !hasError && (
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          poster={gifPlaceholder || undefined}
          className={`${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
          style={{
            objectFit: 'cover',
            width: '100%',
            height: '100%',
            display: 'block',
            ...style
          }}
          onLoadedData={() => {
            setIsLoading(false);
            setGifLoaded(true);
            onLoad?.();
          }}
          onError={() => {
            // Fallback to original GIF if video fails
            console.warn('Video failed to load, falling back to GIF');
            setUseVideo(false);
            setVideoFormats(null);
          }}
        >
          <source src={videoFormats.webm} type="video/webm" />
          <source src={videoFormats.mp4} type="video/mp4" />
        </video>
      )}

      {/* Only render image/GIF elements when not using video */}
      {!useVideo && (isClient && isMobile ? (
        // Enhanced mobile image handling with GIF placeholder support
        <>
          {/* Show placeholder first for GIFs */}
          {isGif && placeholderLoaded && gifPlaceholder && !gifLoaded && (
            <img
              src={gifPlaceholder}
              alt={alt}
              width={dims.width}
              height={dims.height}
              className={`opacity-100 transition-opacity duration-300 ${className || ''}`}
              loading={priority ? 'eager' : 'lazy'}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              style={{ 
                objectFit: 'cover',
                width: '100%',
                height: '100%',
                display: 'block',
                ...style
              }}
              {...props}
            />
          )}
          {/* Show full GIF when loaded or if no placeholder */}
          {(!isGif || !placeholderLoaded || !gifPlaceholder || gifLoaded) && (
            <img
              src={showGif && currentSrc ? currentSrc : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}
              alt={alt}
              width={dims.width}
              height={dims.height}
              className={`${isLoading && !(isGif && placeholderLoaded) ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300 ${className || ''}`}
              onError={handleError}
              onLoad={() => {
                // If this is the full GIF loading, mark it as loaded
                if (isGif) {
                  setGifLoaded(true);
                }
                handleLoad();
              }}
              loading={priority ? 'eager' : 'lazy'}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              style={{ 
                objectFit: 'cover',
                width: '100%',
                height: '100%',
                display: 'block',
                ...style
              }}
              {...props}
            />
          )}
        </>
      ) : (
        // Use Next.js Image for desktop with full optimization and GIF placeholder support
        <>
          {/* Show placeholder first for GIFs */}
          {isGif && placeholderLoaded && gifPlaceholder && !gifLoaded && (
            <Image
              src={gifPlaceholder}
              alt={alt}
              width={dims.width}
              height={dims.height}
              className={`opacity-100 transition-opacity duration-300`}
              priority={priority}
              quality={quality}
              sizes={getResponsiveSizes()}
              unoptimized
              style={style}
              {...props}
            />
          )}
          {/* Show full GIF when loaded or if no placeholder */}
          {(!isGif || !placeholderLoaded || !gifPlaceholder || gifLoaded) && (
            <Image
              src={showGif && currentSrc ? currentSrc : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}
              alt={alt}
              width={dims.width}
              height={dims.height}
              className={`${isLoading && !(isGif && placeholderLoaded) ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
              priority={priority}
              quality={quality}
              sizes={getResponsiveSizes()}
              onError={handleError}
              onLoad={() => {
                // If this is the full GIF loading, mark it as loaded
                if (isGif) {
                  setGifLoaded(true);
                }
                handleLoad();
              }}
              placeholder={placeholder}
              unoptimized={currentSrc.includes('/api/optimized-images/') || currentSrc.includes('/api/placeholder-image/') || isGif} // Don't optimize API images, SVG placeholders, or GIFs
              style={style}
              {...props}
            />
          )}
        </>
      ))}

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-1 left-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded opacity-0 hover:opacity-100 transition-opacity">
          {useVideo ? '🎥 Video' : currentSrc.includes('/api/optimized-images/') ? '🖼️ Optimized' : '📡 Original'}
          {isMobile && ' 📱'}
          {isGif && !useVideo && ' 🎬'}
        </div>
      )}
    </div>
  );
}