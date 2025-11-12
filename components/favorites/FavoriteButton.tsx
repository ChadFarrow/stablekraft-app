'use client';

import { useState, useEffect } from 'react';
import { Heart } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { getSessionId } from '@/lib/session-utils';
import { toast } from '@/components/Toast';
import { publishFavoriteTrackToNostr, publishFavoriteAlbumToNostr } from '@/lib/nostr/favorites';

interface FavoriteButtonProps {
  trackId?: string;
  feedId?: string;
  className?: string;
  size?: number;
  onToggle?: (isFavorite: boolean) => void;
  isFavorite?: boolean; // Optional prop to set initial favorite state (useful on favorites page)
}

export default function FavoriteButton({
  trackId,
  feedId,
  className = '',
  size = 24,
  onToggle,
  isFavorite: initialIsFavorite
}: FavoriteButtonProps) {
  const { sessionId, isLoading } = useSession();
  const { user, isAuthenticated: isNostrAuthenticated } = useNostr();
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite ?? false);
  const [isLoadingState, setIsLoadingState] = useState(initialIsFavorite === undefined);
  const [isToggling, setIsToggling] = useState(false);

  // Determine the API endpoint and ID
  const itemId = trackId || feedId;
  const isTrack = !!trackId;
  const apiBase = isTrack ? '/api/favorites/tracks' : '/api/favorites/albums';

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

    const checkFavorite = async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        // Use Nostr user ID if authenticated, otherwise use session ID
        if (currentUserId) {
          headers['x-nostr-user-id'] = currentUserId;
        } else if (currentSessionId) {
          headers['x-session-id'] = currentSessionId;
        }

        const response = await fetch('/api/favorites/check', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            trackIds: isTrack ? [trackId] : [],
            feedIds: !isTrack ? [feedId] : []
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            const favoriteStatus = isTrack
              ? data.data.tracks[trackId!] || false
              : data.data.albums[feedId!] || false;
            setIsFavorite(favoriteStatus);
          }
        }
      } catch (error) {
        console.error('Error checking favorite status:', error);
        // If tables don't exist yet, just show as not favorited
        setIsFavorite(false);
      } finally {
        setIsLoadingState(false);
      }
    };

    checkFavorite();
  }, [sessionId, itemId, trackId, feedId, isTrack, isLoading, isNostrAuthenticated, user]);

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

    // Optimistic update
    setIsFavorite(newFavoriteState);
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

        // Publish to Nostr first to get the event ID, then create favorite with it
        // Skip Nostr publishing for NIP-05 users (read-only mode, no signing)
        let nostrEventId: string | null = null;
        if (isNostrAuthenticated && user && !isNip05Login) {
          try {
            // Use extension-based signing (no private key needed)
            const userRelays = user.relays && user.relays.length > 0 ? user.relays : undefined;
            
            if (isTrack && trackId) {
              nostrEventId = await publishFavoriteTrackToNostr(
                trackId,
                null, // No private key - use extension
                undefined, // Track title - could be fetched if needed
                undefined, // Artist name - could be fetched if needed
                userRelays
              );
            } else if (feedId) {
              nostrEventId = await publishFavoriteAlbumToNostr(
                feedId,
                null, // No private key - use extension
                undefined, // Album title - could be fetched if needed
                undefined, // Artist name - could be fetched if needed
                userRelays
              );
            }
          } catch (nostrError) {
            // Don't fail the favorite action if Nostr publish fails
            // We'll still create the favorite in the database
            console.warn('Failed to publish favorite to Nostr:', nostrError);
          }
        }

        const response = await fetch(apiBase, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            [isTrack ? 'trackId' : 'feedId']: itemId,
            ...(nostrEventId ? { nostrEventId } : {})
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
          // Store status in error for better handling
          (error as any).status = response.status;
          throw error;
        }

        // Parse response data
        const responseData = await response.json().catch(() => ({}));

        // If we published to Nostr but didn't have the event ID when creating,
        // try to update it now (fallback for race conditions)
        if (isNostrAuthenticated && user && nostrEventId) {
          try {
            // Only update if the favorite was created without nostrEventId
            if (responseData.data && !responseData.data.nostrEventId) {
              const updateResponse = await fetch(apiBase, {
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
              
              if (!updateResponse.ok) {
                const errorData = await updateResponse.json().catch(() => ({}));
                console.warn('Failed to update favorite with Nostr event ID:', errorData);
              }
            }
          } catch (updateError) {
            // Non-critical - event was published to Nostr, just couldn't update DB
            console.warn('Failed to update favorite with Nostr event ID:', updateError);
          }
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
        const response = await fetch(apiBase, {
          method: 'DELETE',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            [isTrack ? 'trackId' : 'feedId']: itemId
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

        // If deletion succeeded and user is authenticated with Nostr, publish deletion event
        // Skip Nostr publishing for NIP-05 users (read-only mode, no signing)
        if (isNostrAuthenticated && user && !isNip05Login) {
          try {
            const responseData = await response.json().catch(() => ({}));
            const nostrEventId = responseData.nostrEventId;
            
            if (nostrEventId) {
              const { deleteFavoriteFromNostr } = await import('@/lib/nostr/favorites');
              const userRelays = user.relays && user.relays.length > 0 ? user.relays : undefined;
              
              await deleteFavoriteFromNostr(
                nostrEventId,
                null, // No private key - use extension
                userRelays
              );
              
              console.log('✅ Published favorite deletion to Nostr');
            }
          } catch (nostrError) {
            // Don't fail the unfavorite action if Nostr deletion fails
            // Database deletion already succeeded above
            console.warn('Failed to publish favorite deletion to Nostr:', nostrError);
          }
        }
      }
    } catch (error) {
      // Revert optimistic update on error
      setIsFavorite(!newFavoriteState);
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
      // Small delay to ensure it's a deliberate tap, not accidental during scroll
      await toggleFavorite();
    }
  };

  if (isLoadingState || !itemId) {
    return null;
  }

  return (
    <button
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
            : 'fill-transparent text-gray-400 hover:text-red-400'
        }`}
      />
    </button>
  );
}

