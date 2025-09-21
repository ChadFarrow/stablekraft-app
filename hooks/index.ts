// Custom hooks for common patterns
export { useAsyncData, useCachedAsyncData } from './useAsyncData';
export { useAudioPlayer } from './useAudioPlayer';
export { useImageLoader, useAvatarLoader } from './useImageLoader';
export { useLocalStorage, useCachedStorage, usePreferences } from './useLocalStorage';
export { useDebounce, useDebouncedCallback, useDebouncedSearch } from './useDebounce';

// Type exports
export type { AudioTrack, AudioPlayerState, AudioPlayerActions } from './useAudioPlayer';
export type { ImageLoaderState, ImageLoaderOptions } from './useImageLoader';

/**
 * Custom Hooks Library
 *
 * This library provides reusable hooks that standardize common patterns
 * across the application, reducing code duplication and improving consistency.
 *
 * Available hooks:
 *
 * Data Management:
 * - useAsyncData: Standardized async data loading with retry logic
 * - useCachedAsyncData: Async data with automatic caching
 * - useLocalStorage: Type-safe localStorage management
 * - useCachedStorage: localStorage with expiration
 * - usePreferences: User preferences management
 *
 * Media & UI:
 * - useAudioPlayer: Comprehensive audio player functionality
 * - useImageLoader: Image loading with error handling and fallbacks
 * - useAvatarLoader: Avatar images with auto-generated fallbacks
 *
 * Performance:
 * - useDebounce: Value debouncing for performance
 * - useDebouncedCallback: Function debouncing
 * - useDebouncedSearch: Complete search functionality with debouncing
 */