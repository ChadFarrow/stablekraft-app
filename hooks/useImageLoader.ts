import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@/lib/logger';

export interface ImageLoaderState {
  src: string | null;
  loading: boolean;
  error: boolean;
  loaded: boolean;
}

export interface ImageLoaderOptions {
  fallbackSrc?: string;
  timeout?: number;
  lazy?: boolean;
  retryCount?: number;
  retryDelay?: number;
  onLoad?: (src: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Custom hook for handling image loading with error handling and fallbacks
 * Standardizes image loading patterns across components
 */
export function useImageLoader(
  initialSrc: string | undefined | null,
  options: ImageLoaderOptions = {}
) {
  const {
    fallbackSrc,
    timeout = 10000,
    lazy = false,
    retryCount = 2,
    retryDelay = 1000,
    onLoad,
    onError
  } = options;

  const [state, setState] = useState<ImageLoaderState>({
    src: null,
    loading: false,
    error: false,
    loaded: false
  });

  const [currentRetry, setCurrentRetry] = useState(0);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const clearImageTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const loadImage = useCallback(
    async (src: string, isRetry = false): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (!src) {
          reject(new Error('No image source provided'));
          return;
        }

        setState(prev => ({
          ...prev,
          loading: true,
          error: isRetry ? prev.error : false
        }));

        const img = new Image();
        imageRef.current = img;

        // Set up timeout
        timeoutRef.current = setTimeout(() => {
          reject(new Error(`Image load timeout: ${src}`));
        }, timeout);

        img.onload = () => {
          clearImageTimeout();
          setState(prev => ({
            ...prev,
            src,
            loading: false,
            error: false,
            loaded: true
          }));

          setCurrentRetry(0);
          onLoad?.(src);
          logger.debug(`Image loaded successfully: ${src}`);
          resolve();
        };

        img.onerror = () => {
          clearImageTimeout();
          const error = new Error(`Failed to load image: ${src}`);
          reject(error);
        };

        // Start loading
        img.src = src;
      });
    },
    [timeout, clearImageTimeout, onLoad]
  );

  const retryLoad = useCallback(async (src: string) => {
    if (currentRetry < retryCount) {
      setCurrentRetry(prev => prev + 1);

      // Add exponential backoff delay
      const delay = retryDelay * Math.pow(2, currentRetry);
      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        await loadImage(src, true);
      } catch (error) {
        logger.warn(`Image retry ${currentRetry + 1} failed:`, error);

        if (currentRetry + 1 >= retryCount) {
          // Final retry failed, try fallback
          if (fallbackSrc && fallbackSrc !== src) {
            logger.info(`Trying fallback image: ${fallbackSrc}`);
            try {
              await loadImage(fallbackSrc);
            } catch (fallbackError) {
              setState(prev => ({
                ...prev,
                loading: false,
                error: true,
                src: fallbackSrc
              }));
              onError?.(fallbackError as Error);
              logger.error('Fallback image also failed:', fallbackError);
            }
          } else {
            setState(prev => ({
              ...prev,
              loading: false,
              error: true
            }));
            onError?.(error as Error);
          }
        } else {
          // Continue retrying
          retryLoad(src);
        }
      }
    }
  }, [currentRetry, retryCount, retryDelay, loadImage, fallbackSrc, onError]);

  const startLoading = useCallback(
    async (src: string) => {
      try {
        await loadImage(src);
      } catch (error) {
        logger.warn('Initial image load failed, starting retry process:', error);
        await retryLoad(src);
      }
    },
    [loadImage, retryLoad]
  );

  // Set up intersection observer for lazy loading
  useEffect(() => {
    if (lazy && elementRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && initialSrc) {
              startLoading(initialSrc);
              observerRef.current?.disconnect();
            }
          });
        },
        { threshold: 0.1 }
      );

      observerRef.current.observe(elementRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [lazy, initialSrc, startLoading]);

  // Load image when src changes (non-lazy)
  useEffect(() => {
    if (!lazy && initialSrc) {
      startLoading(initialSrc);
    }

    return () => {
      clearImageTimeout();
      if (imageRef.current) {
        imageRef.current.onload = null;
        imageRef.current.onerror = null;
      }
    };
  }, [initialSrc, lazy, startLoading, clearImageTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearImageTimeout();
      observerRef.current?.disconnect();
      if (imageRef.current) {
        imageRef.current.onload = null;
        imageRef.current.onerror = null;
      }
    };
  }, [clearImageTimeout]);

  const reset = useCallback(() => {
    setState({
      src: null,
      loading: false,
      error: false,
      loaded: false
    });
    setCurrentRetry(0);
    clearImageTimeout();
  }, [clearImageTimeout]);

  const reload = useCallback(() => {
    if (initialSrc) {
      reset();
      setCurrentRetry(0);
      startLoading(initialSrc);
    }
  }, [initialSrc, reset, startLoading]);

  return {
    ...state,
    displaySrc: state.error && fallbackSrc ? fallbackSrc : state.src,
    reload,
    reset,
    setRef: (element: HTMLElement | null) => {
      elementRef.current = element;
    }
  };
}

/**
 * Specialized hook for avatar/profile images with automatic fallback generation
 */
export function useAvatarLoader(
  src: string | undefined | null,
  name?: string,
  options: Omit<ImageLoaderOptions, 'fallbackSrc'> = {}
) {
  // Generate avatar fallback based on name
  const generateAvatarFallback = useCallback((name?: string): string => {
    if (!name) return '';

    const initials = name
      .split(' ')
      .map(word => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join('');

    // Generate a simple SVG avatar
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FCEA2B',
      '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43'
    ];

    const colorIndex = name.charCodeAt(0) % colors.length;
    const bgColor = colors[colorIndex];

    const svg = `
      <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" fill="${bgColor}"/>
        <text x="50" y="55" font-family="Arial, sans-serif" font-size="40"
              fill="white" text-anchor="middle" font-weight="bold">${initials}</text>
      </svg>
    `;

    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }, []);

  const fallbackSrc = generateAvatarFallback(name);

  return useImageLoader(src, {
    ...options,
    fallbackSrc
  });
}