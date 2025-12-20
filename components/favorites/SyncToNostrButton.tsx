'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { useNostr } from '@/contexts/NostrContext';
import { toast } from '@/components/Toast';
import { batchPublishFavoritesToNostr, BatchPublishItem } from '@/lib/nostr/favorites';

interface SyncToNostrButtonProps {
  className?: string;
  onSyncComplete?: () => void;
}

export default function SyncToNostrButton({
  className = '',
  onSyncComplete
}: SyncToNostrButtonProps) {
  const { user, isAuthenticated } = useNostr();
  const [unpublishedCount, setUnpublishedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [needsRepublishCount, setNeedsRepublishCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);

  // Don't show for NIP-05 (read-only) users
  const isNip05Login = user?.loginType === 'nip05';

  const fetchCounts = useCallback(async () => {
    if (!isAuthenticated || !user || isNip05Login) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch unpublished count
      const unpubResponse = await fetch('/api/favorites/unpublished-count', {
        headers: {
          'x-nostr-user-id': user.id
        }
      });

      if (unpubResponse.ok) {
        const data = await unpubResponse.json();
        if (data.success) {
          setUnpublishedCount(data.unpublished.total);
          setTotalCount(data.total || 0);
          setNeedsRepublishCount(data.needsRepublish?.total || 0);
        }
      }
    } catch (error) {
      console.error('Error fetching counts:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user, isNip05Login]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // forceMode: 'none' = unpublished only, 'nip51' = needs NIP-51 update, 'all' = everything
  const handleSync = async (forceMode: 'none' | 'nip51' | 'all' = 'none') => {
    if (!user || isSyncing) return;

    const countToSync = forceMode === 'all' ? totalCount : (forceMode === 'nip51' ? needsRepublishCount : unpublishedCount);
    if (countToSync === 0) return;

    setIsSyncing(true);
    setProgress({ completed: 0, total: countToSync });

    try {
      // Fetch favorites to sync
      let url = '/api/favorites/sync-to-nostr';
      if (forceMode === 'all') {
        url += '?force=all';
      } else if (forceMode === 'nip51') {
        url += '?force=true';
      }

      const response = await fetch(url, {
        headers: {
          'x-nostr-user-id': user.id
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch favorites');
      }

      const data = await response.json();
      if (!data.success || !data.items || data.items.length === 0) {
        toast.info('No favorites to sync');
        setIsSyncing(false);
        return;
      }

      const items: BatchPublishItem[] = data.items;
      setProgress({ completed: 0, total: items.length });

      // Get user's relays if available
      const userRelays = user.relays && user.relays.length > 0 ? user.relays : undefined;

      // Batch publish to Nostr
      const result = await batchPublishFavoritesToNostr(
        items,
        (completed, total) => {
          setProgress({ completed, total });
        },
        userRelays
      );

      // Update database with nostrEventIds in batches of 10 to avoid overwhelming connections
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
      const action = forceMode !== 'none' ? 'Republished' : 'Synced';
      if (result.successful.length > 0 && result.failed.length === 0) {
        toast.success(`${action} ${result.successful.length} favorites to Nostr`);
      } else if (result.successful.length > 0 && result.failed.length > 0) {
        toast.warning(`${action} ${result.successful.length} favorites, ${result.failed.length} failed`);
      } else if (result.failed.length > 0) {
        toast.error(`Failed to sync ${result.failed.length} favorites`);
      }

      // Refresh count
      await fetchCounts();

      // Notify parent
      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (error) {
      console.error('Error syncing favorites:', error);
      toast.error('Failed to sync favorites to Nostr');
    } finally {
      // Small delay before resetting state to prevent UI glitches
      await new Promise(resolve => setTimeout(resolve, 100));
      setIsSyncing(false);
      setProgress({ completed: 0, total: 0 });
    }
  };

  // Don't render if not authenticated or NIP-05
  if (!isAuthenticated || isNip05Login || isLoading) {
    return null;
  }

  // Show republish button even if no unpublished (for NIP-51 migration)
  if (unpublishedCount === 0 && totalCount === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Sync unpublished button */}
      {unpublishedCount > 0 && (
        <button
          onClick={() => handleSync('none')}
          disabled={isSyncing}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all
            ${isSyncing
              ? 'bg-purple-600/50 text-purple-200 cursor-wait'
              : 'bg-purple-600 hover:bg-purple-500 text-white cursor-pointer'
            }`}
          title={`Sync ${unpublishedCount} unpublished favorites to Nostr`}
        >
          <RefreshCw
            size={16}
            className={isSyncing ? 'animate-spin' : ''}
          />
          {isSyncing ? (
            <span>Syncing... ({progress.completed}/{progress.total})</span>
          ) : (
            <span>Sync ({unpublishedCount})</span>
          )}
        </button>
      )}

      {/* Republish all button (for NIP-51 migration) - show only if there are items needing republish */}
      {needsRepublishCount > 0 && unpublishedCount === 0 && (
        <button
          onClick={() => handleSync('nip51')}
          disabled={isSyncing}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all
            ${isSyncing
              ? 'bg-teal-600/50 text-teal-200 cursor-wait'
              : 'bg-teal-600 hover:bg-teal-500 text-white cursor-pointer'
            }`}
          title={`Republish ${needsRepublishCount} favorites with NIP-51 format`}
        >
          <Upload size={16} className={isSyncing ? 'animate-pulse' : ''} />
          {isSyncing ? (
            <span>Publishing... ({progress.completed}/{progress.total})</span>
          ) : (
            <span>Republish All ({needsRepublishCount})</span>
          )}
        </button>
      )}

      {/* Force republish button - for when data is out of sync (all marked published but not on relays) */}
      {unpublishedCount === 0 && needsRepublishCount === 0 && totalCount > 0 && (
        <button
          onClick={() => handleSync('all')}
          disabled={isSyncing}
          className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all
            ${isSyncing
              ? 'bg-orange-600/50 text-orange-200 cursor-wait'
              : 'bg-orange-600 hover:bg-orange-500 text-white cursor-pointer'
            }`}
          title={`Force republish all ${totalCount} favorites to Nostr`}
        >
          <Upload size={16} className={isSyncing ? 'animate-pulse' : ''} />
          {isSyncing ? (
            <span>Publishing... ({progress.completed}/{progress.total})</span>
          ) : (
            <span>Republish ({totalCount})</span>
          )}
        </button>
      )}
    </div>
  );
}
