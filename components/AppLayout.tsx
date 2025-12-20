'use client';

import React, { ReactNode } from 'react';
import dynamic from 'next/dynamic';
import ShareLinkButton from './ShareLinkButton';

// Dynamically import UserMenu to avoid SSR issues
const UserMenu = dynamic(() => import('./UserMenu'), {
  ssr: false,
  loading: () => (
    <div className="w-10 h-10 bg-gray-800/50 rounded-lg animate-pulse" />
  )
});

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <>
      {/* User Menu - Top Right */}
      <div className="fixed top-[calc(1rem+env(safe-area-inset-top))] right-4 z-40">
        <UserMenu className="bg-gray-900/80 backdrop-blur-sm" />
      </div>

      {/* Share Link Button - Bottom Left */}
      <ShareLinkButton />

      {children}
    </>
  );
}
