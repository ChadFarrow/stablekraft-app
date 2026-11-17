import { NextRequest, NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const LT_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.xml';

// Fast-loading version of LT playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast LT playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('lt-playlist')) {
      const cachedData = playlistCache.getCachedData('lt-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached LT playlist data');
        return compressedJson(request, cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('lt');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'lt-playlist',
        title: 'Lightning Thrashes Music Playlist',
        artist: 'Various Artists',
        album: 'Lightning Thrashes Music Playlist',
        description: 'Curated playlist from Lightning Thrashes featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.png',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.png',
        url: LT_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'lt-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/lt',
        albumUrl: '/album/lt-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/lt', // URL to fetch full data
        playlistContext: {
          source: 'lt-playlist-fast',
          originalUrl: LT_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Lightning Thrashes Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast LT playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast LT playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast LT playlist' },
      { status: 500 }
    );
  }
}
