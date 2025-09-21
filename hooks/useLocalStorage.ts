import { useState, useEffect, useCallback } from 'react';
import { logger } from '@/lib/logger';

type SetValue<T> = T | ((val: T) => T);

interface UseLocalStorageOptions<T> {
  serializer?: {
    serialize: (value: T) => string;
    deserialize: (value: string) => T;
  };
  onError?: (error: Error) => void;
  syncAcrossTabs?: boolean;
}

/**
 * Custom hook for managing localStorage with type safety and error handling
 * Provides automatic serialization, error handling, and cross-tab synchronization
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {}
): [T, (value: SetValue<T>) => void, () => void] {
  const {
    serializer = {
      serialize: JSON.stringify,
      deserialize: JSON.parse
    },
    onError,
    syncAcrossTabs = true
  } = options;

  // Get value from localStorage or return initial value
  const getStoredValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      if (item === null) {
        return initialValue;
      }

      const parsedValue = serializer.deserialize(item);
      logger.debug(`Retrieved from localStorage: ${key}`, parsedValue);
      return parsedValue;
    } catch (error) {
      const errorMessage = `Error reading localStorage key "${key}":`;
      logger.error(errorMessage, error);
      onError?.(error as Error);
      return initialValue;
    }
  }, [key, initialValue, serializer, onError]);

  const [storedValue, setStoredValue] = useState<T>(getStoredValue);

  // Set value to localStorage
  const setValue = useCallback(
    (value: SetValue<T>) => {
      if (typeof window === 'undefined') {
        logger.warn('localStorage not available (SSR)');
        return;
      }

      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;

        setStoredValue(valueToStore);

        if (valueToStore === null || valueToStore === undefined) {
          window.localStorage.removeItem(key);
          logger.debug(`Removed from localStorage: ${key}`);
        } else {
          const serializedValue = serializer.serialize(valueToStore);
          window.localStorage.setItem(key, serializedValue);
          logger.debug(`Saved to localStorage: ${key}`, valueToStore);
        }

        // Dispatch storage event for cross-tab sync
        if (syncAcrossTabs) {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key,
              newValue: valueToStore ? serializer.serialize(valueToStore) : null,
              oldValue: null,
              storageArea: window.localStorage
            })
          );
        }
      } catch (error) {
        const errorMessage = `Error setting localStorage key "${key}":`;
        logger.error(errorMessage, error);
        onError?.(error as Error);
      }
    },
    [key, storedValue, serializer, onError, syncAcrossTabs]
  );

  // Remove value from localStorage
  const removeValue = useCallback(() => {
    setValue(initialValue);
  }, [setValue, initialValue]);

  // Listen for storage events for cross-tab synchronization
  useEffect(() => {
    if (!syncAcrossTabs || typeof window === 'undefined') {
      return;
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== key || e.storageArea !== window.localStorage) {
        return;
      }

      try {
        const newValue = e.newValue ? serializer.deserialize(e.newValue) : initialValue;
        setStoredValue(newValue);
        logger.debug(`Storage event received for key: ${key}`, newValue);
      } catch (error) {
        logger.error(`Error handling storage event for key "${key}":`, error);
        onError?.(error as Error);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, initialValue, serializer, onError, syncAcrossTabs]);

  // Initialize from localStorage on client-side
  useEffect(() => {
    setStoredValue(getStoredValue());
  }, [getStoredValue]);

  return [storedValue, setValue, removeValue];
}

/**
 * Specialized hook for caching data with expiration
 */
export function useCachedStorage<T>(
  key: string,
  initialValue: T,
  expirationMs: number = 1000 * 60 * 60 * 24, // 24 hours default
  options: Omit<UseLocalStorageOptions<T>, 'serializer'> = {}
) {
  interface CachedData {
    value: T;
    timestamp: number;
    expiresAt: number;
  }

  const serializer = {
    serialize: (data: CachedData) => JSON.stringify(data),
    deserialize: (str: string): CachedData => {
      const parsed = JSON.parse(str);

      // Check if data has expired
      if (Date.now() > parsed.expiresAt) {
        throw new Error('Cached data has expired');
      }

      return parsed;
    }
  };

  const [cachedData, setCachedData, removeCachedData] = useLocalStorage<CachedData>(
    key,
    {
      value: initialValue,
      timestamp: Date.now(),
      expiresAt: Date.now() + expirationMs
    },
    { ...options, serializer }
  );

  const setValue = useCallback(
    (value: SetValue<T>) => {
      const newValue = value instanceof Function ? value(cachedData.value) : value;
      const now = Date.now();

      setCachedData({
        value: newValue,
        timestamp: now,
        expiresAt: now + expirationMs
      });
    },
    [cachedData.value, setCachedData, expirationMs]
  );

  const isExpired = useCallback(() => {
    return Date.now() > cachedData.expiresAt;
  }, [cachedData.expiresAt]);

  const getRemainingTime = useCallback(() => {
    return Math.max(0, cachedData.expiresAt - Date.now());
  }, [cachedData.expiresAt]);

  const refresh = useCallback(
    (newExpirationMs?: number) => {
      const now = Date.now();
      const expiration = newExpirationMs || expirationMs;

      setCachedData(prev => ({
        ...prev,
        timestamp: now,
        expiresAt: now + expiration
      }));
    },
    [expirationMs, setCachedData]
  );

  return {
    value: cachedData.value,
    setValue,
    removeValue: removeCachedData,
    isExpired,
    getRemainingTime,
    refresh,
    timestamp: cachedData.timestamp,
    expiresAt: cachedData.expiresAt
  };
}

/**
 * Hook for managing user preferences with defaults
 */
export function usePreferences<T extends Record<string, any>>(
  defaults: T,
  storageKey = 'user-preferences'
): [T, (key: keyof T, value: T[keyof T]) => void, () => void] {
  const [preferences, setPreferences] = useLocalStorage(storageKey, defaults);

  const updatePreference = useCallback(
    (key: keyof T, value: T[keyof T]) => {
      setPreferences(prev => ({
        ...prev,
        [key]: value
      }));
      logger.info(`Preference updated: ${String(key)} = ${value}`);
    },
    [setPreferences]
  );

  const resetPreferences = useCallback(() => {
    setPreferences(defaults);
    logger.info('Preferences reset to defaults');
  }, [setPreferences, defaults]);

  return [preferences, updatePreference, resetPreferences];
}