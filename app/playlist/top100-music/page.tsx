'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

// Import Top 100 Music Playlist component
const Top100MusicPlaylist = dynamic(() => import('@/components/Top100MusicPlaylist'), {
  loading: () => (
    <div className="bg-black/40 backdrop-blur-sm rounded-lg p-6">
      <div className="text-white">Loading Top 100 Music Playlist...</div>
    </div>
  ),
  ssr: false
});

export default function Top100MusicPage() {
  // Dark theme background with StableKraft gradient matching other playlists
  const backgroundStyle = {
    background: 'linear-gradient(rgba(0,0,0,0.8), rgba(0,0,0,0.9)), linear-gradient(135deg, #4ECDC4 0%, #FF6B35 50%, #FFD700 100%)',
    backgroundAttachment: 'fixed'
  };

  return (
    <div 
      className="min-h-screen text-white relative"
      style={backgroundStyle}
    >
      <div className="container mx-auto px-4 sm:px-6 pt-16 md:pt-12 pb-40">
        {/* Back button */}
        <Link 
          href="/" 
          className="inline-flex items-center text-gray-400 hover:text-white mb-8 transition-colors"
        >
          <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Albums
        </Link>

        {/* Playlist Header - Album Style */}
        <div className="flex flex-col gap-6 mb-8">
          {/* Playlist Art */}
          <div className="relative group mx-auto w-[200px] h-[200px] sm:w-[240px] sm:h-[240px] md:w-[280px] md:h-[280px]">
            <div className="rounded-lg object-cover shadow-2xl w-full h-full bg-gradient-to-br from-yellow-400 via-orange-500 to-cyan-400 flex items-center justify-center">
              <div className="text-center text-white">
                <img 
                  src="https://podcastindex.org/images/brand-icon.svg" 
                  alt="Podcast Index Logo"
                  className="w-16 h-16 md:w-20 md:h-20 mx-auto mb-2 filter brightness-0 invert"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    // Fallback to star icon if logo fails to load
                    target.style.display = 'none';
                    const fallback = document.createElement('svg');
                    fallback.className = 'w-16 h-16 md:w-20 md:h-20 mx-auto mb-2';
                    fallback.setAttribute('fill', 'currentColor');
                    fallback.setAttribute('viewBox', '0 0 24 24');
                    fallback.innerHTML = '<path d="M12 2L13.09 8.26L22 9L13.09 9.74L12 16L10.91 9.74L2 9L10.91 8.26L12 2Z" />';
                    target.parentNode?.insertBefore(fallback, target);
                  }}
                />
                <div className="text-lg font-bold">TOP 100</div>
              </div>
            </div>
          </div>
          
          {/* Playlist Info */}
          <div className="text-center space-y-4">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight">Top 100 Music</h1>
            <p className="text-lg sm:text-xl text-gray-300">Value for Value Music Charts</p>
            <p className="text-base sm:text-lg text-gray-300 italic">By Podcast Index</p>
            
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-sm text-gray-400">
              <span>Updated Daily</span>
              <span>100 tracks</span>
              <span className="bg-yellow-600 text-white px-2 py-1 rounded text-xs">V4V CHART</span>
            </div>
            
            <p className="text-gray-300 text-center max-w-xs sm:max-w-lg mx-auto leading-relaxed text-sm sm:text-base px-4">
              The top 100 music tracks by value received in sats (satoshis), showcasing the most supported Value for Value music content.
            </p>

            {/* Badges */}
            <div className="flex flex-wrap justify-center gap-2">
              <span className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded border border-yellow-500/30">
                Podcast Index
              </span>
              <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded border border-green-500/30">
                Value for Value
              </span>
              <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded border border-blue-500/30">
                Bitcoin Lightning
              </span>
            </div>
          </div>
        </div>

        {/* Track List */}
        <div className="bg-black/40 backdrop-blur-sm rounded-lg p-4 md:p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Top 100 Tracks</h2>
          <Top100MusicPlaylist />
        </div>

        {/* Info Section */}
        <div className="bg-black/40 backdrop-blur-sm rounded-lg p-4 md:p-6">
          <h3 className="text-lg font-semibold text-white mb-4">About Value for Value Music</h3>
          <div className="space-y-3 text-sm">
            <p className="text-gray-300">
              This chart represents the top 100 music tracks by value received through the Bitcoin Lightning Network, 
              showcasing the most supported content in the Value for Value (V4V) ecosystem.
            </p>
            <div>
              <span className="text-gray-400">Data Source:</span>
              <span className="ml-2 text-white">Podcast Index API</span>
            </div>
            <div>
              <span className="text-gray-400">Update Frequency:</span>
              <span className="ml-2 text-white">Daily</span>
            </div>
            <div>
              <span className="text-gray-400">Currency:</span>
              <span className="ml-2 text-white">Bitcoin (satoshis)</span>
            </div>
            <div className="pt-2">
              <a 
                href="https://github.com/Podcastindex-org/top100_music" 
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}