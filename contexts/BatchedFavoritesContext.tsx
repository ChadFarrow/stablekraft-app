'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { getSessionId } from '@/lib/session-utils';

interface BatchedFavoritesContextType {
  checkFavorites: (trackIds: string[], feedIds: string[]) => Promise<{ tracks: Record<string, boolean>; albums: Record<string, boolean> }>;
  getFavoriteStatus: (trackId?: string, feedId?: string) => boolean | undefined;
}

const BatchedFavoritesContext = createContext<BatchedFavoritesContextType | null>(null);

export function BatchedFavoritesProvider({ children }: { children: React.ReactNode }) {
  const { sessionId, isLoading: sessionLoading } = useSession();
  const { user, isAuthenticated: isNostrAuthenticated } = useNostr();
  const [favoriteStatuses, setFavoriteStatuses] = useState<{
    tracks: Record<string, boolean>;
    albums: Record<string, boolean>;
  }>({ tracks: {}, albums: {} });
  
  const pendingChecks = useRef<{
    trackIds: Set<string>;
    feedIds: Set<string>;
    resolvers: Array<{
      resolve: (value: { tracks: Record<string, boolean>; albums: Record<string, boolean> }) => void;
      reject: (error: Error) => void;
    }>;
  }>({ trackIds: new Set(), feedIds: new Set(), resolvers: [] });
  
  const batchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCheckingRef = useRef(false);

  const executeBatchCheck = useCallback(async () => {
    if (isCheckingRef.current || pendingChecks.current.trackIds.size === 0 && pendingChecks.current.feedIds.size === 0) {
      return;
    }

    isCheckingRef.current = true;
    const { trackIds, feedIds, resolvers } = pendingChecks.current;
    
    // Clear pending checks
    pendingChecks.current = { trackIds: new Set(), feedIds: new Set(), resolvers: [] };
    
    if (batchTimeoutRef.current) {
      clearTimeout(batchTimeoutRef.current);
      batchTimeoutRef.current = null;
    }

    const currentSessionId = sessionId || getSessionId();
    const currentUserId = isNostrAuthenticated && user ? user.id : null;

    if (!currentSessionId && !currentUserId) {
      // No session, resolve all with false
      const emptyResult = {
        tracks: Object.fromEntries(Array.from(trackIds).map(id => [id, false])),
        albums: Object.fromEntries(Array.from(feedIds).map(id => [id, false]))
      };
      resolvers.forEach(({ resolve }) => resolve(emptyResult));
      isCheckingRef.current = false;
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (currentUserId) {
        headers['x-nostr-user-id'] = currentUserId;
      } else if (currentSessionId) {
        headers['x-session-id'] = currentSessionId;
      }

      const response = await fetch('/api/favorites/check', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          trackIds: Array.from(trackIds),
          feedIds: Array.from(feedIds)
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Update state with new favorite statuses
          setFavoriteStatuses(prev => ({
            tracks: { ...prev.tracks, ...data.data.tracks },
            albums: { ...prev.albums, ...data.data.albums }
          }));
          
          // Resolve all pending promises
          resolvers.forEach(({ resolve }) => resolve(data.data));
        } else {
          throw new Error('Failed to check favorites');
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Error checking favorites:', error);
      // Resolve all with false on error
      const errorResult = {
        tracks: Object.fromEntries(Array.from(trackIds).map(id => [id, false])),
        albums: Object.fromEntries(Array.from(feedIds).map(id => [id, false]))
      };
      resolvers.forEach(({ resolve }) => resolve(errorResult));
    } finally {
      isCheckingRef.current = false;
    }
  }, [sessionId, isNostrAuthenticated, user]);

  const checkFavorites = useCallback((trackIds: string[], feedIds: string[]): Promise<{ tracks: Record<string, boolean>; albums: Record<string, boolean> }> => {
    return new Promise((resolve, reject) => {
      // Filter out IDs we already have in state
      const newTrackIds = trackIds.filter(id => !(id in favoriteStatuses.tracks));
      const newFeedIds = feedIds.filter(id => !(id in favoriteStatuses.albums));

      // If we already have all the statuses, return immediately
      if (newTrackIds.length === 0 && newFeedIds.length === 0) {
        const result = {
          tracks: Object.fromEntries(trackIds.map(id => [id, favoriteStatuses.tracks[id] || false])),
          albums: Object.fromEntries(feedIds.map(id => [id, favoriteStatuses.albums[id] || false]))
        };
        resolve(result);
        return;
      }

      // Add to pending checks
      newTrackIds.forEach(id => pendingChecks.current.trackIds.add(id));
      newFeedIds.forEach(id => pendingChecks.current.feedIds.add(id));
      pendingChecks.current.resolvers.push({ resolve, reject });

      // Clear existing timeout
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }

      // Set new timeout to batch requests (50ms debounce)
      batchTimeoutRef.current = setTimeout(() => {
        executeBatchCheck();
      }, 50);
    });
  }, [favoriteStatuses, executeBatchCheck]);

  const getFavoriteStatus = useCallback((trackId?: string, feedId?: string): boolean | undefined => {
    if (trackId && trackId in favoriteStatuses.tracks) {
      return favoriteStatuses.tracks[trackId];
    }
    if (feedId && feedId in favoriteStatuses.albums) {
      return favoriteStatuses.albums[feedId];
    }
    return undefined;
  }, [favoriteStatuses]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, []);

  return (
    <BatchedFavoritesContext.Provider value={{ checkFavorites, getFavoriteStatus }}>
      {children}
    </BatchedFavoritesContext.Provider>
  );
}

export function useBatchedFavorites() {
  const context = useContext(BatchedFavoritesContext);
  if (!context) {
    throw new Error('useBatchedFavorites must be used within BatchedFavoritesProvider');
  }
  return context;
}

