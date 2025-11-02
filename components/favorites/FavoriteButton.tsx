'use client';

import { useState, useEffect } from 'react';
import { Heart } from 'lucide-react';
import { useSession } from '@/contexts/SessionContext';
import { getSessionId } from '@/lib/session-utils';
import { toast } from '@/components/Toast';

interface FavoriteButtonProps {
  trackId?: string;
  feedId?: string;
  className?: string;
  size?: number;
  onToggle?: (isFavorite: boolean) => void;
}

export default function FavoriteButton({
  trackId,
  feedId,
  className = '',
  size = 24,
  onToggle
}: FavoriteButtonProps) {
  const { sessionId, isLoading } = useSession();
  const [isFavorite, setIsFavorite] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(true);
  const [isToggling, setIsToggling] = useState(false);

  // Determine the API endpoint and ID
  const itemId = trackId || feedId;
  const isTrack = !!trackId;
  const apiBase = isTrack ? '/api/favorites/tracks' : '/api/favorites/albums';

  // Check if item is favorited on mount
  useEffect(() => {
    if (isLoading || !itemId || !sessionId) {
      setIsLoadingState(false);
      return;
    }

    const checkFavorite = async () => {
      try {
        const response = await fetch('/api/favorites/check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': sessionId
          },
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
  }, [sessionId, itemId, trackId, feedId, isTrack, isLoading]);

  const toggleFavorite = async () => {
    if (isToggling || isLoadingState || !itemId) {
      return;
    }

    // Get session ID if not available in context
    const currentSessionId = sessionId || getSessionId();
    if (!currentSessionId) {
      toast.error('Unable to save favorite. Please refresh the page.');
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
        const response = await fetch(apiBase, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': currentSessionId
          },
          body: JSON.stringify({
            [isTrack ? 'trackId' : 'feedId']: itemId
          })
        });

        responseStatus = response.status;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData.error || 'Failed to add to favorites';
          const error = new Error(errorMsg);
          // Store status in error for better handling
          (error as any).status = response.status;
          throw error;
        }
      } else {
        // Remove from favorites
        const response = await fetch(`${apiBase}/${itemId}`, {
          method: 'DELETE',
          headers: {
            'x-session-id': currentSessionId
          }
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

