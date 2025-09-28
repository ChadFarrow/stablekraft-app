'use client';

import dynamic from 'next/dynamic';

const IAMPlaylistClient = dynamic(() => import('./IAMPlaylistClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-white">Loading...</div></div>
});

export default function IAMPlaylistPage() {
  return <IAMPlaylistClient />;
}