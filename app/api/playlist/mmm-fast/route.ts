import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

// Fast-loading version of MMM playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast MMM playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('mmm-playlist')) {
      const cachedData = playlistCache.getCachedData('mmm-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached MMM playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'mmm-playlist',
        title: 'Mutton, Mead & Music Playlist',
        artist: 'Various Artists',
        album: 'Mutton, Mead & Music Playlist',
        description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-playlist-art.webp',
        url: MMM_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'mmm-playlist',
        type: 'playlist',
        totalTracks: 1468, // Known count from fast endpoint data
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/mmm',
        albumUrl: '/album/mmm-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/mmm', // URL to fetch full data
        playlistContext: {
          source: 'mmm-playlist-fast',
          originalUrl: MMM_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Mutton, Mead & Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast MMM playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast MMM playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast MMM playlist' },
      { status: 500 }
    );
  }
}