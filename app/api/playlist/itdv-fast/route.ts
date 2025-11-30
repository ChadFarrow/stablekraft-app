import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

const ITDV_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';

// Fast-loading version of ITDV playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast ITDV playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('itdv-playlist')) {
      const cachedData = playlistCache.getCachedData('itdv-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached ITDV playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'itdv-playlist',
        title: 'ITDV Music Playlist',
        artist: 'Various Artists',
        album: 'ITDV Music Playlist',
        description: 'Every music reference from Into The Doerfel-Verse podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-playlist-art.webp',
        url: ITDV_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'itdv-playlist',
        type: 'playlist',
        totalTracks: 0,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/itdv',
        albumUrl: '/album/itdv-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/itdv', // URL to fetch full data
        link: 'https://doerfelverse.com/',
        playlistContext: {
          source: 'itdv-playlist-fast',
          originalUrl: ITDV_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'ITDV Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast ITDV playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast ITDV playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast ITDV playlist' },
      { status: 500 }
    );
  }
}
