'use client';

export const dynamic = 'force-dynamic';

export default function PlaylistIndexPage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Music Playlists</h1>
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  );
} 