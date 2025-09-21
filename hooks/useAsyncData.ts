import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/logger';

interface UseAsyncDataOptions<T> {
  initialData?: T;
  deps?: any[];
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  retryCount?: number;
  retryDelay?: number;
}

interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  isInitialLoad: boolean;
  lastUpdated: Date | null;
}

interface AsyncDataActions {
  refetch: () => Promise<void>;
  reset: () => void;
  retry: () => Promise<void>;
}

type UseAsyncDataReturn<T> = AsyncDataState<T> & AsyncDataActions;

/**
 * Custom hook for handling async data loading with consistent patterns
 * Standardizes loading states, error handling, and retry logic across components
 */
export function useAsyncData<T>(
  asyncFunction: () => Promise<T>,
  options: UseAsyncDataOptions<T> = {}
): UseAsyncDataReturn<T> {
  const {
    initialData = null,
    deps = [],
    onSuccess,
    onError,
    retryCount = 3,
    retryDelay = 1000
  } = options;

  const [state, setState] = useState<AsyncDataState<T>>({
    data: initialData,
    loading: false,
    error: null,
    isInitialLoad: true,
    lastUpdated: null
  });

  const [currentRetry, setCurrentRetry] = useState(0);

  const executeAsync = useCallback(async (isRetry = false) => {
    setState(prev => ({
      ...prev,
      loading: true,
      error: isRetry ? prev.error : null
    }));

    try {
      logger.debug(`Executing async function${isRetry ? ' (retry)' : ''}`);
      const result = await asyncFunction();

      setState(prev => ({
        ...prev,
        data: result,
        loading: false,
        error: null,
        isInitialLoad: false,
        lastUpdated: new Date()
      }));

      setCurrentRetry(0);
      onSuccess?.(result);
      logger.debug('Async function completed successfully');
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));

      setState(prev => ({
        ...prev,
        loading: false,
        error: errorObj,
        isInitialLoad: false
      }));

      onError?.(errorObj);
      logger.error('Async function failed:', errorObj);
    }
  }, [asyncFunction, onSuccess, onError]);

  const refetch = useCallback(async () => {
    await executeAsync(false);
  }, [executeAsync]);

  const retry = useCallback(async () => {
    if (currentRetry < retryCount) {
      setCurrentRetry(prev => prev + 1);

      // Add exponential backoff delay
      const delay = retryDelay * Math.pow(2, currentRetry);
      await new Promise(resolve => setTimeout(resolve, delay));

      await executeAsync(true);
    } else {
      logger.warn(`Max retries (${retryCount}) reached`);
    }
  }, [executeAsync, currentRetry, retryCount, retryDelay]);

  const reset = useCallback(() => {
    setState({
      data: initialData,
      loading: false,
      error: null,
      isInitialLoad: true,
      lastUpdated: null
    });
    setCurrentRetry(0);
  }, [initialData]);

  // Execute on mount and when dependencies change
  useEffect(() => {
    executeAsync();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...state,
    refetch,
    reset,
    retry
  };
}

/**
 * Specialized hook for loading data with caching
 */
export function useCachedAsyncData<T>(
  asyncFunction: () => Promise<T>,
  cacheKey: string,
  cacheDuration: number = 5 * 60 * 1000, // 5 minutes default
  options: UseAsyncDataOptions<T> = {}
): UseAsyncDataReturn<T> {
  const getCachedData = useCallback((): T | null => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (Date.now() - timestamp < cacheDuration) {
          logger.debug(`Using cached data for key: ${cacheKey}`);
          return data;
        } else {
          localStorage.removeItem(cacheKey);
          logger.debug(`Cache expired for key: ${cacheKey}`);
        }
      }
    } catch (error) {
      logger.error(`Error reading cache for key ${cacheKey}:`, error);
      localStorage.removeItem(cacheKey);
    }
    return null;
  }, [cacheKey, cacheDuration]);

  const setCachedData = useCallback((data: T) => {
    try {
      const cacheData = {
        data,
        timestamp: Date.now()
      };
      localStorage.setItem(cacheKey, JSON.stringify(cacheData));
      logger.debug(`Data cached for key: ${cacheKey}`);
    } catch (error) {
      logger.error(`Error caching data for key ${cacheKey}:`, error);
    }
  }, [cacheKey]);

  const wrappedAsyncFunction = useCallback(async (): Promise<T> => {
    // Check cache first
    const cachedData = getCachedData();
    if (cachedData) {
      return cachedData;
    }

    // Fetch fresh data
    const freshData = await asyncFunction();
    setCachedData(freshData);
    return freshData;
  }, [asyncFunction, getCachedData, setCachedData]);

  return useAsyncData(wrappedAsyncFunction, options);
}