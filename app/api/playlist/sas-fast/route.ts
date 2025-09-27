import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

const SAS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml';

// Fast-loading version of SAS playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast SAS playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('sas-playlist')) {
      const cachedData = playlistCache.getCachedData('sas-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached SAS playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'sas-playlist',
        title: 'Sats and Sounds Music Playlist',
        artist: 'Various Artists',
        album: 'Sats and Sounds Music Playlist',
        description: 'Curated playlist from Sats and Sounds podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/SAS-playlist-art%20.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/SAS-playlist-art%20.webp',
        url: SAS_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'sas-playlist',
        type: 'playlist',
        totalTracks: 500, // Known count from fast endpoint data
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/sas',
        albumUrl: '/album/sas-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/sas', // URL to fetch full data
        playlistContext: {
          source: 'sas-playlist-fast',
          originalUrl: SAS_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Sats and Sounds Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast SAS playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast SAS playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast SAS playlist' },
      { status: 500 }
    );
  }
}