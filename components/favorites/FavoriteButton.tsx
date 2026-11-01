'use client';

import { useState, useEffect } from 'react';
import { Heart } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { getSessionId } from '@/lib/session-utils';
import { toast } from '@/components/Toast';
import { queueFavoritePublish, queueFavoriteDeletion } from '@/lib/nostr/publish-queue';
import { requestSharedFavoritesSync } from '@/lib/nostr/favorites-sync-client';
import { FAVORITES_PRIVACY_ASK_EVENT } from '@/components/favorites/FavoritesPrivacyPrompt';
import { useBatchedFavorites } from '@/contexts/BatchedFavoritesContext';
import type { FavoriteKind } from '@/lib/favorite-status-cache';

// Helper hook that safely uses batched favorites, with fallback
function useBatchedFavoritesSafe() {
  try {
    return useBatchedFavorites();
  } catch (error) {
    // Context not available, return fallback functions
    return {
      checkFavorites: async (trackIds: string[], feedIds: string[]) => {
        // Fallback to individual check (shouldn't happen if provider is set up correctly)
        const currentSessionId = getSessionId();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (currentSessionId) {
          headers['x-session-id'] = currentSessionId;
        }
        const response = await fetch('/api/favorites/check', {
          method: 'POST',
          headers,
          body: JSON.stringify({ trackIds, feedIds })
        });
        if (response.ok) {
          const data = await response.json();
          return data.success ? data.data : { tracks: {}, albums: {} };
        }
        return { tracks: {}, albums: {} };
      },
      getFavoriteStatus: () => undefined,
      // No shared cache to keep honest outside the provider.
      setFavoriteStatus: () => {}
    };
  }
}

interface FavoriteButtonProps {
  trackId?: string;
  feedId?: string;
  className?: string;
  /** Classes for the heart itself when NOT favorited. The icon carries its own
      text colour, so a `text-*` on `className` can never reach it — pass it here. */
  iconClassName?: string;
  size?: number;
  onToggle?: (isFavorite: boolean) => void;
  isFavorite?: boolean; // Optional prop to set initial favorite state (useful on favorites page)
  // When feedId is provided and album has only 1 track, pass the track data here
  // The component will save as a track favorite instead of album favorite
  singleTrackData?: {
    id: string;        // Track ID (guid, url, or composite)
    title?: string;    // For Nostr publishing
    artist?: string;   // For Nostr publishing
  };
  // Determines which favorites tab the item appears in
  // Only 'publisher' if favoriting from the publishers filter page
  favoriteType?: 'album' | 'publisher' | 'playlist';
  // Feed GUID for auto-importing album when track not in database
  // Used for playlist tracks that are resolved at runtime
  feedGuidForImport?: string;
}

export default function FavoriteButton({
  trackId,
  feedId,
  className = '',
  iconClassName = 'text-gray-400 hover:text-red-400',
  size = 24,
  onToggle,
  isFavorite: initialIsFavorite,
  singleTrackData,
  favoriteType = 'album',
  feedGuidForImport
}: FavoriteButtonProps) {
  const { sessionId, isLoading } = useSession();
  const { user, isAuthenticated: isNostrAuthenticated } = useNostr();
  const { checkFavorites, getFavoriteStatus, setFavoriteStatus } = useBatchedFavoritesSafe();
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite ?? false);
  const [isLoadingState, setIsLoadingState] = useState(initialIsFavorite === undefined);
  const [isToggling, setIsToggling] = useState(false);
  const [touchHandled, setTouchHandled] = useState(false);

  // Determine the API endpoint and ID
  // If singleTrackData is provided, treat this as a track favorite (for single-track albums)
  const effectiveTrackId = singleTrackData?.id || trackId;
  const itemId = effectiveTrackId || feedId;
  const isTrack = !!effectiveTrackId;

  /**
   * Which store the favorite was actually found in, once checked.
   *
   * A single-track album can be filed EITHER way, because whether a surface
   * passes `singleTrackData` is a property of that surface rather than of the
   * item: the home list rows pass only `feedId` (album favorite) while
   * `AlbumCard` and the album page pass track data for a one-track release
   * (track favorite). Favorite from a list row, open the album page, and it
   * read as unfavorited — the row existed, under the other kind.
   *
   * The call sites are unified now, but rows written before that still exist,
   * so the check below looks in both stores and this records the answer. The
   * DELETE must target wherever the row actually is; targeting the kind this
   * surface would have written removes nothing and the heart comes back on
   * the next load.
   */
  const [favoriteSource, setFavoriteSource] = useState<'track' | 'album' | null>(null);

  const removeAsTrack = favoriteSource ? favoriteSource === 'track' : isTrack;
  const apiBase = isTrack ? '/api/favorites/tracks' : '/api/favorites/albums';
  const removeApiBase = removeAsTrack ? '/api/favorites/tracks' : '/api/favorites/albums';
  const removeItemId = removeAsTrack ? effectiveTrackId ?? itemId : feedId ?? itemId;

  // Check if item is favorited on mount (skip if isFavorite prop is provided)
  useEffect(() => {
    // If isFavorite prop is provided, skip the API check
    if (initialIsFavorite !== undefined) {
      setIsLoadingState(false);
      return;
    }

    const currentSessionId = sessionId || getSessionId();
    const currentUserId = isNostrAuthenticated && user ? user.id : null;
    
    if (isLoading || !itemId || (!currentSessionId && !currentUserId)) {
      setIsLoadingState(false);
      return;
    }

    // Check if we already have the status cached. Read the two stores
    // separately rather than through the combined lookup, so a hit also tells
    // us WHICH one it came from — that is what the DELETE needs.
    const cachedTrack = effectiveTrackId ? getFavoriteStatus(effectiveTrackId, undefined) : undefined;
    const cachedAlbum = feedId ? getFavoriteStatus(undefined, feedId) : undefined;
    if (cachedTrack || cachedAlbum) {
      setFavoriteSource(cachedTrack ? 'track' : 'album');
      setIsFavorite(true);
      setIsLoadingState(false);
      return;
    }
    if (cachedTrack !== undefined && cachedAlbum !== undefined) {
      setFavoriteSource(null);
      setIsFavorite(false);
      setIsLoadingState(false);
      return;
    }

    // Use batched favorites check. Both ids go out when we have both: this is
    // one item that may be filed either way, so asking about only the kind
    // this surface would write is what produced the mismatched heart.
    const checkFavorite = async () => {
      try {
        const result = await checkFavorites(
          effectiveTrackId ? [effectiveTrackId] : [],
          feedId ? [feedId] : []
        );

        const trackHit = effectiveTrackId ? result.tracks[effectiveTrackId] || false : false;
        const albumHit = feedId ? result.albums[feedId] || false : false;
        setFavoriteSource(trackHit ? 'track' : albumHit ? 'album' : null);
        setIsFavorite(trackHit || albumHit);
      } catch (error) {
        console.error('Error checking favorite status:', error);
        // If tables don't exist yet, just show as not favorited
        setIsFavorite(false);
      } finally {
        setIsLoadingState(false);
      }
    };

    checkFavorite();
  }, [sessionId, itemId, effectiveTrackId, feedId, isTrack, isLoading, isNostrAuthenticated, user, checkFavorites, getFavoriteStatus]);

  const toggleFavorite = async () => {
    if (isToggling || isLoadingState || !itemId) {
      return;
    }

    // Get session ID or user ID
    const currentSessionId = sessionId || getSessionId();
    const currentUserId = isNostrAuthenticated && user ? user.id : null;
    
    if (!currentSessionId && !currentUserId) {
      toast.error('Unable to save favorite. Please refresh the page.');
      return;
    }

    // Check if user is logged in via NIP-05 (read-only mode)
    const isNip05Login = user?.loginType === 'nip05';
    const isAddingFavorite = !isFavorite;

    // NIP-05 users are read-only - they can view favorites but not add/remove them
    if (isNip05Login) {
      toast.error('NIP-05 login is read-only. To add or remove favorites, please use the extension login method.');
      return;
    }

    setIsToggling(true);
    const newFavoriteState = !isFavorite;

    /**
     * The store this request actually mutates, resolved once so the cache
     * write and its rollback can never disagree with the row. An add lands
     * under `itemId` in the kind this surface writes; a remove targets
     * wherever the check FOUND it, which is what `removeAsTrack` carries.
     */
    const mutatedKind: FavoriteKind = newFavoriteState
      ? (isTrack ? 'track' : 'album')
      : (removeAsTrack ? 'track' : 'album');
    const mutatedId = newFavoriteState ? itemId : removeItemId;

    // Optimistic update. The source moves with it, so an unfavorite right
    // after a favorite deletes the row this surface just wrote rather than
    // whichever kind an earlier check happened to find.
    setIsFavorite(newFavoriteState);
    setFavoriteSource(newFavoriteState ? (isTrack ? 'track' : 'album') : null);
    // Write through to the shared cache, not just this component's state.
    // Skipping this was issue #190: the `false` cached when the card first
    // mounted survived the favorite, and because a cached `false` is a KNOWN
    // answer, the next surface to render this item short-circuited on it and
    // drew an unfilled heart without ever asking the server. The provider
    // lives in the root layout, so it outlives client-side navigation and
    // only a hard reload cleared it.
    setFavoriteStatus(mutatedKind, mutatedId, newFavoriteState);
    // On removal, clear the sibling store too. The check ORs the two together,
    // so a stale `true` left under the other kind — legacy rows can be filed
    // either way, which is what `favoriteSource` exists for — would make the
    // next surface draw a filled heart for something just unfavorited.
    if (!newFavoriteState) {
      if (effectiveTrackId) setFavoriteStatus('track', effectiveTrackId, false);
      if (feedId) setFavoriteStatus('album', feedId, false);
    }
    if (onToggle) {
      onToggle(newFavoriteState);
    }

    let responseStatus: number | undefined;
    
    try {
      if (newFavoriteState) {
        // Add to favorites
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (currentUserId) {
          headers['x-nostr-user-id'] = currentUserId;
        } else if (currentSessionId) {
          headers['x-session-id'] = currentSessionId;
        }

        // Save to DB immediately (without nostrEventId), then queue Nostr publish
        const response = await fetch(apiBase, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            [isTrack ? 'trackId' : 'feedId']: itemId,
            // Include type for album favorites to determine which tab it appears in
            ...(!isTrack ? { type: favoriteType } : {}),
            // Include feedGuid for auto-importing album when track not in database
            ...(isTrack && feedGuidForImport ? { feedGuidForImport } : {})
          })
        });

        responseStatus = response.status;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error || 'Failed to add to favorites';
          const errorDetails = errorData.details || errorData.debug || '';
          const fullErrorMsg = errorDetails ? `${errorMsg}: ${errorDetails}` : errorMsg;
          console.error('Favorite API error:', {
            status: response.status,
            error: errorMsg,
            details: errorDetails,
            debug: errorData.debug
          });
          const error = new Error(fullErrorMsg);
          (error as any).status = response.status;
          throw error;
        }

        // Queue Nostr publish in background — PATCH eventId when it resolves
        if (isNostrAuthenticated && user && !isNip05Login) {
          const userRelays = user.relays && user.relays.length > 0 ? user.relays : undefined;
          const publishType = isTrack ? 'track' as const : 'album' as const;
          const publishId = isTrack ? effectiveTrackId! : feedId!;
          const publishTitle = isTrack ? singleTrackData?.title : undefined;
          const publishArtist = isTrack ? singleTrackData?.artist : undefined;

          // Second, independent channel: the cross-app kind:30078 list. It
          // republishes the whole list from the DB rather than this one item,
          // so it doesn't need the ids above — and it must not be folded into
          // the per-item queue, whose batching resolves a promise per item.
          // See the PC20-Nostr spec, specs/pc20-favorites.md.
          requestSharedFavoritesSync({
            userId: user.id,
            pubkey: user.nostrPubkey,
            relays: userRelays,
          });

          // Ask where the shared list should put this, if the user has never
          // said. AFTER the favorite is saved and the heart is filled, never
          // before: a dialog between the tap and the result makes a favorite
          // feel like a transaction. Safe in this order only because nothing
          // has been published yet — the sync above writes nothing to the
          // shared list while the question is unanswered. The prompt itself
          // decides whether to appear; a page can hold hundreds of these
          // buttons and the question belongs to the account, not to a row.
          window.dispatchEvent(new Event(FAVORITES_PRIVACY_ASK_EVENT));

          queueFavoritePublish(publishType, publishId, publishTitle, publishArtist, userRelays)
            .then(async (nostrEventId) => {
              if (!nostrEventId) return;
              try {
                const patchRes = await fetch(apiBase, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(currentUserId ? { 'x-nostr-user-id': currentUserId } : {}),
                    ...(currentSessionId ? { 'x-session-id': currentSessionId } : {}),
                  },
                  body: JSON.stringify({
                    [isTrack ? 'trackId' : 'feedId']: itemId,
                    nostrEventId
                  })
                });
                if (patchRes.ok) {
                  // The row may have already held an event id published under a
                  // different `d` tag. Kind 30001 is addressable, so that one is
                  // NOT replaced by this publish — delete it explicitly or it
                  // stays live and keeps showing in the Community tab.
                  const patchData = await patchRes.json().catch(() => ({}));
                  if (patchData?.supersededEventId) {
                    queueFavoriteDeletion(patchData.supersededEventId, userRelays)
                      .catch((err) => console.warn('Failed to delete superseded favorite event:', err));
                  }
                  window.dispatchEvent(new Event('favorites-synced'));
                }
              } catch (updateError) {
                console.warn('Failed to update favorite with Nostr event ID:', updateError);
              }
            })
            .catch((err) => console.warn('Failed to publish favorite to Nostr:', err));
        }
      } else {
        // Remove from favorites
        const headers: Record<string, string> = {};
        
        if (currentUserId) {
          headers['x-nostr-user-id'] = currentUserId;
        } else if (currentSessionId) {
          headers['x-session-id'] = currentSessionId;
        }

        // For DELETE, send trackId/feedId in the body instead of URL path
        // This handles cases where the ID is a full URL (https://...)
        const response = await fetch(removeApiBase, {
          method: 'DELETE',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            [removeAsTrack ? 'trackId' : 'feedId']: removeItemId
          })
        });

        responseStatus = response.status;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error || 'Failed to remove from favorites';
          const error = new Error(errorMsg);
          // Store status in error for better handling
          (error as any).status = response.status;
          throw error;
        }

        // Queue Nostr deletion fire-and-forget
        if (isNostrAuthenticated && user && !isNip05Login) {
          const responseData = await response.json().catch(() => ({}));
          // The DELETE removes every row in the feedId equivalence set, so it
          // can return more than one published event. Publishing a kind-5 for
          // only the first would leave the others live on relays and still
          // surfacing in the Community tab. `nostrEventIds` is the complete
          // set; fall back to the single-id shape for an older response.
          const nostrEventIds: string[] = Array.isArray(responseData.nostrEventIds)
            ? responseData.nostrEventIds.filter(Boolean)
            : (responseData.nostrEventId ? [responseData.nostrEventId] : []);

          const userRelays = user.relays && user.relays.length > 0 ? user.relays : undefined;

          // Outside the nostrEventIds guard on purpose. A kind-5 needs the id of
          // the event it deletes, so a favorite whose publish once failed can
          // never be unfavorited on the 30001 channel. The shared list has no
          // such dependency — removal is just absence from the next revision —
          // so it must still run.
          requestSharedFavoritesSync({
            userId: user.id,
            pubkey: user.nostrPubkey,
            relays: userRelays,
          });

          for (const eventId of nostrEventIds) {
            queueFavoriteDeletion(eventId, userRelays)
              .catch((err) => console.warn('Failed to publish favorite deletion to Nostr:', err));
          }
        }
      }
    } catch (error) {
      // Revert optimistic update on error — including in the shared cache, or
      // the failed toggle would be the stale entry every other surface reads.
      setIsFavorite(!newFavoriteState);
      setFavoriteStatus(mutatedKind, mutatedId, !newFavoriteState);
      if (onToggle) {
        onToggle(!newFavoriteState);
      }

      console.error('Error toggling favorite:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update favorite';
      const status = (error instanceof Error && (error as any).status) || responseStatus;
      
      // Check if it's a database table error (503 = Service Unavailable = tables not initialized)
      const isTableError = status === 503 ||
                          errorMessage.includes('does not exist') || 
                          errorMessage.includes('Unknown model') ||
                          errorMessage.includes('not initialized') ||
                          errorMessage.includes('migration') ||
                          (error instanceof Error && error.message.includes('P2001'));
      
      // Don't show error toast if tables don't exist yet
      if (!isTableError) {
        toast.error(errorMessage);
      } else {
        // Silently fail - user can't do anything about missing tables
        console.warn('Favorites tables not initialized. Migration needed.');
      }
    } finally {
      setIsToggling(false);
    }
  };

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Skip if this click was triggered by a touch event (already handled)
    if (touchHandled) {
      setTouchHandled(false);
      return;
    }
    await toggleFavorite();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    // Mark that we're interacting with button
    (e.currentTarget as HTMLElement).dataset.touched = 'true';
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const button = e.currentTarget as HTMLElement;
    if (button.dataset.touched === 'true') {
      delete button.dataset.touched;
      // Mark that touch handled this - prevents duplicate onClick
      setTouchHandled(true);
      await toggleFavorite();
    }
  };

  if (isLoadingState || !itemId) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`favorite-button ${className} transition-all duration-200 hover:scale-110 active:scale-95 flex items-center justify-center touch-manipulation ${
        isToggling ? 'opacity-50 cursor-wait' : 'cursor-pointer'
      }`}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      disabled={isToggling}
    >
      <Heart
        size={size}
        className={`transition-colors duration-200 flex-shrink-0 ${
          isFavorite
            ? 'fill-red-500 text-red-500'
            : `fill-transparent ${iconClassName}`
        }`}
      />
    </button>
  );
}

