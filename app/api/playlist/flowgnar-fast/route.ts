import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

// Fast-loading version of Flowgnar playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast Flowgnar playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('flowgnar-playlist')) {
      const cachedData = playlistCache.getCachedData('flowgnar-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached Flowgnar playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('flowgnar');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'flowgnar-playlist',
        title: 'Flowgnar Music Playlist',
        artist: 'Various Artists',
        album: 'Flowgnar Music Playlist',
        description: 'Curated playlist from Flowgnar podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-playlist-art.webp',
        url: '/playlist/flowgnar',
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'flowgnar-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/flowgnar',
        albumUrl: '/playlist/flowgnar',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/flowgnar', // URL to fetch full data
        link: 'https://flowgnar.com/',
        playlistContext: {
          source: 'flowgnar-playlist-fast',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-music-playlist.xml'
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Flowgnar Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast Flowgnar playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast Flowgnar playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast Flowgnar playlist' },
      { status: 500 }
    );
  }
}
