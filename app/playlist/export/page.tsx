'use client';

export const dynamic = 'force-dynamic';

export default function ExportPlaylistPage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-green-400 rounded"></div>
          <div>
            <h1 className="text-3xl font-bold">Export ITDV Music Playlist</h1>
            <p className="text-gray-400">Share the music with any podcast app</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-8 mb-6">
          <h2 className="text-xl font-semibold mb-4">Download RSS Playlist</h2>
          <p className="text-gray-300 mb-6">Loading...</p>
        </div>

        <div className="bg-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-semibold mb-4">Share Playlist URL</h2>
          <p className="text-gray-300 mb-6">Loading...</p>
        </div>
      </div>
    </div>
  );
}