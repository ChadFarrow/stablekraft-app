'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useNostr } from '@/contexts/NostrContext';
import { toast } from '@/components/Toast';
import { batchPublishFavoritesToNostr, BatchPublishItem } from '@/lib/nostr/favorites';

interface UseAutoSyncFavoritesOptions {
  enabled?: boolean;
  onSyncComplete?: () => void;
}

/**
 * Hook to auto-sync unpublished favorites to Nostr when authenticated.
 * Runs once per session when the Favorites page loads.
 */
export function useAutoSyncFavorites(options: UseAutoSyncFavoritesOptions = {}) {
  const { enabled = true, onSyncComplete } = options;
  const { user, isAuthenticated } = useNostr();

  // Track if we've already synced in this session to prevent repeated syncs
  const hasSyncedRef = useRef(false);
  const isSyncingRef = useRef(false);

  // Don't sync for NIP-05 (read-only) users
  const isNip05Login = user?.loginType === 'nip05';

  const performSync = useCallback(async () => {
    if (!user || isSyncingRef.current) return;

    isSyncingRef.current = true;

    try {
      // Check unpublished count first
      const countResponse = await fetch('/api/favorites/unpublished-count', {
        headers: {
          'x-nostr-user-id': user.id
        }
      });

      if (!countResponse.ok) {
        return;
      }

      const countData = await countResponse.json();
      const unpublishedCount = countData.success ? countData.unpublished?.total || 0 : 0;

      if (unpublishedCount === 0) {
        // Nothing to sync
        return;
      }

      // Fetch favorites to sync
      const response = await fetch('/api/favorites/sync-to-nostr', {
        headers: {
          'x-nostr-user-id': user.id
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch favorites');
      }

      const data = await response.json();
      if (!data.success || !data.items || data.items.length === 0) {
        return;
      }

      const items: BatchPublishItem[] = data.items;

      // Show syncing toast
      toast.info(`Syncing ${items.length} favorites to Nostr...`);

      // Get user's relays if available
      const userRelays = user.relays && user.relays.length > 0 ? user.relays : undefined;

      // Batch publish to Nostr
      const result = await batchPublishFavoritesToNostr(
        items,
        undefined, // No progress callback needed for auto-sync
        userRelays
      );

      // Update database with nostrEventIds in batches
      const batchSize = 10;
      for (let i = 0; i < result.successful.length; i += batchSize) {
        const batch = result.successful.slice(i, i + batchSize);
        const batchPromises = batch.map(async (item) => {
          const originalItem = items.find(it => it.id === item.id);
          if (originalItem) {
            try {
              await fetch('/api/favorites/sync-to-nostr', {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'x-nostr-user-id': user.id
                },
                body: JSON.stringify({
                  type: originalItem.type,
                  id: item.id,
                  nostrEventId: item.nostrEventId
                })
              });
            } catch (error) {
              console.error('Failed to update database with nostrEventId:', error);
            }
          }
        });
        await Promise.allSettled(batchPromises);
      }

      // Show results
      if (result.successful.length > 0 && result.failed.length === 0) {
        toast.success(`Synced ${result.successful.length} favorites to Nostr`);
      } else if (result.successful.length > 0 && result.failed.length > 0) {
        toast.warning(`Synced ${result.successful.length} favorites, ${result.failed.length} failed`);
      } else if (result.failed.length > 0) {
        toast.error(`Failed to sync ${result.failed.length} favorites`);
      }

      // Notify parent
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (error) {
      console.error('Auto-sync favorites error:', error);
      // Silent fail for auto-sync - user can still use manual Sync button
    } finally {
      isSyncingRef.current = false;
    }
  }, [user, onSyncComplete]);

  useEffect(() => {
    // Skip if disabled, not authenticated, NIP-05, or already synced this session
    if (!enabled || !isAuthenticated || !user || isNip05Login || hasSyncedRef.current) {
      return;
    }

    // Mark as synced to prevent repeated attempts
    hasSyncedRef.current = true;

    // Small delay to ensure signer is initialized
    const timer = setTimeout(() => {
      performSync();
    }, 1500);

    return () => clearTimeout(timer);
  }, [enabled, isAuthenticated, user, isNip05Login, performSync]);
}
