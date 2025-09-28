'use client';

import { useState } from 'react';
import { Download, Music, Share2, Copy, Check, Loader2 } from 'lucide-react';

export default function ExportPlaylistPage() {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<any>(null);
  
  const feedUrl = 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml';
  const playlistUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/generate-playlist-rss?feedUrl=${encodeURIComponent(feedUrl)}`;

  const downloadPlaylist = async () => {
    setDownloading(true);
    try {
      // First get stats
      const statsResponse = await fetch(`/api/generate-playlist-rss?feedUrl=${encodeURIComponent(feedUrl)}&format=json`);
      const statsData = await statsResponse.json();
      setStats(statsData);
      
      // Then download the RSS
      const response = await fetch(`/api/generate-playlist-rss?feedUrl=${encodeURIComponent(feedUrl)}`);
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'itdv-music-playlist.xml';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download playlist:', error);
      alert('Failed to download playlist. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(playlistUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Music className="w-8 h-8 text-green-400" />
          <div>
            <h1 className="text-3xl font-bold">Export ITDV Music Playlist</h1>
            <p className="text-gray-400">Share the music with any podcast app</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-8 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Download className="w-5 h-5" />
            Download RSS Playlist
          </h2>
          
          <p className="text-gray-300 mb-6">
            Download an RSS feed containing all the music tracks from Into The Doerfel Verse. 
            This playlist can be imported into any podcast app that supports RSS feeds.
          </p>

          {stats && (
            <div className="bg-gray-700/50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold mb-2">Playlist Contents:</h3>
              <ul className="space-y-1 text-sm text-gray-300">
                <li>• {stats.totalTracks} music tracks</li>
                <li>• From {stats.episodeCount} episodes</li>
                <li>• All V4V-tagged music with track references</li>
              </ul>
            </div>
          )}

          <button
            onClick={downloadPlaylist}
            disabled={downloading}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Generating playlist...
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Download Playlist RSS
              </>
            )}
          </button>
        </div>

        <div className="bg-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            Share Playlist URL
          </h2>
          
          <p className="text-gray-300 mb-6">
            Share this URL with others or add it directly to a podcast app:
          </p>

          <div className="bg-gray-900 rounded-lg p-4 mb-4">
            <code className="text-sm text-green-400 break-all">
              {playlistUrl}
            </code>
          </div>

          <button
            onClick={copyToClipboard}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-5 h-5" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" />
                Copy URL to Clipboard
              </>
            )}
          </button>
        </div>

        <div className="mt-8 bg-blue-900/20 border border-blue-500/20 rounded-xl p-6">
          <h3 className="font-semibold mb-3 text-blue-300">How to Use This Playlist</h3>
          <ol className="space-y-2 text-sm text-gray-300">
            <li>
              <strong>1. In Podcast Apps:</strong> Add the URL above as a new podcast subscription
            </li>
            <li>
              <strong>2. Download XML:</strong> Save the file and import it into your media player
            </li>
            <li>
              <strong>3. Share:</strong> Send the URL to friends so they can enjoy the music too
            </li>
          </ol>
          
          <p className="mt-4 text-xs text-gray-400">
            Note: This playlist contains references to the episode audio with timestamps. 
            For the best experience, use a podcast app that supports the Podcast 2.0 namespace.
          </p>
        </div>

        <div className="mt-6 flex gap-4 justify-center">
          <a
            href="/playlist/itdv"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            ← Back to Web Player
          </a>
          <a
            href="/playlist/itdv-music"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            View Music Library →
          </a>
        </div>
      </div>
    </div>
  );
}