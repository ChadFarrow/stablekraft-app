'use client';

import React from 'react';
import UserProfile from './UserProfile';

interface User {
  id: string;
  nostrNpub: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  followedAt?: string;
}

interface UserListProps {
  users: User[];
  title?: string;
  emptyMessage?: string;
  className?: string;
}

export default function UserList({
  users,
  title,
  emptyMessage = 'No users found',
  className = '',
}: UserListProps) {
  if (users.length === 0) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
      {users.map(user => (
        <div
          key={user.id}
          className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <UserProfile
            user={{
              id: user.id,
              nostrPubkey: '',
              nostrNpub: user.nostrNpub,
              displayName: user.displayName,
              avatar: user.avatar,
              bio: user.bio,
              relays: [],
            }}
            showDetails={true}
          />
          {user.followedAt && (
            <p className="text-xs text-gray-500 mt-2">
              Followed {new Date(user.followedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

