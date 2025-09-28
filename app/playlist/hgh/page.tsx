'use client';

import dynamic from 'next/dynamic';

const HGHPlaylistClient = dynamic(() => import('./HGHPlaylistClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-white">Loading...</div></div>
});

export default function HGHPlaylistPage() {
  return <HGHPlaylistClient />;
} 