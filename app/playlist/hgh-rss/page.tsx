'use client';

export const dynamic = 'force-dynamic';

export default function HGHPlaylistPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-white text-center">
        <h1 className="text-2xl font-bold mb-4">HGH Music Playlist</h1>
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  );
}