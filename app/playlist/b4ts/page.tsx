'use client';

import dynamic from 'next/dynamic';

const B4TSPlaylistClient = dynamic(() => import('./B4TSPlaylistClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-white">Loading...</div></div>
});

export default function B4TSPlaylistPage() {
  return <B4TSPlaylistClient />;
}