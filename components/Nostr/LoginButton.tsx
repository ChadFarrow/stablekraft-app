'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useNostr } from '@/contexts/NostrContext';
import Link from 'next/link';

// Lazy load LoginModal - only load when user clicks login button
const LoginModal = dynamic(() => import('./LoginModal'), {
  loading: () => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6">
        <div className="text-gray-700">Loading...</div>
      </div>
    </div>
  ),
  ssr: false // Client-side only
});

interface LoginButtonProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export default function LoginButton({
  className = '',
  variant = 'default',
  size = 'md',
}: LoginButtonProps) {
  const { user, isAuthenticated, logout } = useNostr();
  const [showModal, setShowModal] = useState(false);

  // Debug logging
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('🔐 LoginButton: State', {
        isAuthenticated,
        hasUser: !!user,
        userId: user?.id,
        npub: user?.nostrNpub?.slice(0, 16) + '...',
      });
    }
  }, [isAuthenticated, user]);

  if (isAuthenticated && user) {
    // Show displayName if available, otherwise show a friendly fallback
    const displayText = user.displayName || 'User';

    // Determine avatar size based on button size
    const avatarSize = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';

    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {user.avatar && (
          <img
            src={user.avatar}
            alt={displayText}
            className={`${avatarSize} rounded-full object-cover flex-shrink-0`}
            onError={(e) => {
              // Hide image if it fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <span className="text-sm text-white">{displayText}</span>
        <Link
          href="/settings"
          className={`p-2 rounded-md text-sm font-medium transition-colors text-gray-400 hover:text-white hover:bg-gray-700 ${
            size === 'sm' ? 'p-1' : size === 'lg' ? 'p-3' : ''
          }`}
          title="Settings"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </Link>
        <button
          onClick={logout}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            variant === 'outline'
              ? 'border border-gray-300 hover:bg-gray-50'
              : variant === 'ghost'
              ? 'hover:bg-gray-100 text-gray-700'
              : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
          } ${size === 'sm' ? 'px-3 py-1 text-xs' : size === 'lg' ? 'px-6 py-3' : ''}`}
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          variant === 'outline'
            ? 'border border-gray-300 hover:bg-gray-50'
            : variant === 'ghost'
            ? 'hover:bg-gray-100'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        } ${size === 'sm' ? 'px-3 py-1 text-xs' : size === 'lg' ? 'px-6 py-3' : ''} ${className}`}
      >
        Sign in with Nostr
      </button>
      {showModal && <LoginModal onClose={() => setShowModal(false)} />}
    </>
  );
}

