'use client';

import React, { useState, useEffect } from 'react';
import { useNostr } from '@/contexts/NostrContext';

interface ActivityFeedProps {
  userId?: string;
  limit?: number;
  className?: string;
}

interface Activity {
  type: 'boost' | 'share' | 'follow';
  id: string;
  createdAt: string;
  data: any;
}

export default function ActivityFeed({
  userId,
  limit = 20,
  className = '',
}: ActivityFeedProps) {
  const { user } = useNostr();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchActivities = async () => {
      const targetUserId = userId || user?.id;
      if (!targetUserId) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(
          `/api/nostr/activity?userId=${targetUserId}&limit=${limit}`,
          {
            headers: user?.id ? { 'x-nostr-user-id': user.id } : {},
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch activities');
        }

        const data = await response.json();
        if (data.success) {
          setActivities(data.data);
        } else {
          throw new Error(data.error || 'Failed to fetch activities');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch activities');
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
  }, [userId, user?.id, limit]);

  if (isLoading) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-gray-500">Loading activities...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-gray-500">No activities yet</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {activities.map(activity => (
        <div
          key={activity.id}
          className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          {activity.type === 'boost' && (
            <div className="flex items-start gap-3">
              <div className="text-2xl">⚡</div>
              <div className="flex-1">
                <p className="font-medium">
                  Boosted {activity.data.amount} sats
                  {activity.data.message && `: ${activity.data.message}`}
                </p>
                <p className="text-sm text-gray-500">
                  {new Date(activity.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {activity.type === 'share' && (
            <div className="flex items-start gap-3">
              <div className="text-2xl">📤</div>
              <div className="flex-1">
                <p className="font-medium">Shared {activity.data.trackId ? 'track' : 'album'}</p>
                <p className="text-sm text-gray-600 mt-1">{activity.data.content}</p>
                <p className="text-sm text-gray-500 mt-1">
                  {new Date(activity.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {activity.type === 'follow' && (
            <div className="flex items-start gap-3">
              <div className="text-2xl">👤</div>
              <div className="flex-1">
                <p className="font-medium">
                  Started following {activity.data.following?.displayName || activity.data.following?.nostrNpub.slice(0, 16) + '...'}
                </p>
                <p className="text-sm text-gray-500">
                  {new Date(activity.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

