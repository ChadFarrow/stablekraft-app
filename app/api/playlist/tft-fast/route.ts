import { NextRequest, NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const TFT_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-music-playlist.xml';

// Fast-loading version of TFT playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast TFT playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('tft-playlist')) {
      const cachedData = playlistCache.getCachedData('tft-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached TFT playlist data');
        return compressedJson(request, cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('tft');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'tft-playlist',
        title: 'Two for Tunestr Music Playlist',
        artist: 'Various Artists',
        album: 'Two for Tunestr Music Playlist',
        description: 'Every music reference from Two for Tunestr',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-playlist-art.png',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-playlist-art.png',
        url: TFT_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'tft-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/tft',
        albumUrl: '/album/tft-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/tft', // URL to fetch full data
        playlistContext: {
          source: 'tft-playlist-fast',
          originalUrl: TFT_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Two for Tunestr Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast TFT playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast TFT playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast TFT playlist' },
      { status: 500 }
    );
  }
}
