'use client';

import React from 'react';
import { useNostr, NostrUser } from '@/contexts/NostrContext';

interface UserProfileProps {
  className?: string;
  showDetails?: boolean;
  user?: NostrUser;
}

export default function UserProfile({ className = '', showDetails = true, user: propUser }: UserProfileProps) {
  const { user: contextUser, isAuthenticated } = useNostr();
  const user = propUser || contextUser;

  if (!user) {
    return null;
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {user.avatar && (
        <img
          src={user.avatar}
          alt={user.displayName || 'User'}
          className="w-10 h-10 rounded-full"
        />
      )}
      <div className="flex-1">
        <div className="font-medium">{user.displayName || user.nostrNpub.slice(0, 16) + '...'}</div>
        {showDetails && (
          <div className="text-sm text-gray-500">
            {user.nostrNpub.slice(0, 16)}...
            {user.nip05Verified && (
              <span className="ml-2 text-green-600">✓ Verified</span>
            )}
          </div>
        )}
        {user.bio && showDetails && (
          <div className="text-sm text-gray-600 mt-1">{user.bio}</div>
        )}
      </div>
    </div>
  );
}

