'use client';

import React, { useState, useEffect } from 'react';
import { useNostr } from '@/contexts/NostrContext';

interface FollowButtonProps {
  userId: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export default function FollowButton({
  userId,
  className = '',
  variant = 'default',
  size = 'md',
}: FollowButtonProps) {
  const { user, isAuthenticated } = useNostr();
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user || user.id === userId) {
      setIsLoading(false);
      return;
    }

    // Check follow status
    const checkFollow = async () => {
      try {
        const response = await fetch(`/api/nostr/follow?followingId=${userId}`, {
          headers: {
            'x-nostr-user-id': user.id,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setIsFollowing(data.isFollowing);
        }
      } catch (error) {
        console.error('Error checking follow status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkFollow();
  }, [isAuthenticated, user, userId]);

  const toggleFollow = async () => {
    if (!isAuthenticated || !user || isToggling) {
      return;
    }

    setIsToggling(true);
    const newState = !isFollowing;

    // Optimistic update
    setIsFollowing(newState);

    try {
      const response = await fetch('/api/nostr/follow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-nostr-user-id': user.id,
        },
        body: JSON.stringify({
          followingId: userId,
          action: newState ? 'follow' : 'unfollow',
        }),
      });

      if (!response.ok) {
        // Revert on error
        setIsFollowing(!newState);
        const data = await response.json();
        throw new Error(data.error || 'Failed to follow/unfollow');
      }
    } catch (error) {
      console.error('Follow/unfollow error:', error);
      // Revert on error
      setIsFollowing(!newState);
    } finally {
      setIsToggling(false);
    }
  };

  if (!isAuthenticated || !user || user.id === userId) {
    return null;
  }

  if (isLoading) {
    return (
      <button
        disabled
        className={`px-4 py-2 rounded-md text-sm font-medium opacity-50 cursor-not-allowed ${className}`}
      >
        Loading...
      </button>
    );
  }

  return (
    <button
      onClick={toggleFollow}
      disabled={isToggling}
      className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
        variant === 'outline'
          ? 'border border-gray-300 hover:bg-gray-50'
          : variant === 'ghost'
          ? 'hover:bg-gray-100'
          : isFollowing
          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      } ${size === 'sm' ? 'px-3 py-1 text-xs' : size === 'lg' ? 'px-6 py-3' : ''} ${
        isToggling ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      {isToggling ? '...' : isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}

