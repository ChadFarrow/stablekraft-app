import { NextRequest, NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const OBSH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/OBSH-music-playlist.xml';

// Fast-loading version of OBSH playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast OBSH playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('obsh-playlist')) {
      const cachedData = playlistCache.getCachedData('obsh-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached OBSH playlist data');
        return compressedJson(request, cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('obsh');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'obsh-playlist',
        title: 'The OnlyBoosts Social Hour Music Playlist',
        artist: 'Various Artists',
        album: 'The OnlyBoosts Social Hour Music Playlist',
        description: 'Every music reference from The OnlyBoosts Social Hour',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/OBSH-playlist-art.jpg',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/OBSH-playlist-art.jpg',
        url: OBSH_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'obsh-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/obsh',
        albumUrl: '/album/obsh-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/obsh', // URL to fetch full data
        playlistContext: {
          source: 'obsh-playlist-fast',
          originalUrl: OBSH_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'The OnlyBoosts Social Hour Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast OBSH playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast OBSH playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast OBSH playlist' },
      { status: 500 }
    );
  }
}
