import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const UPBEATS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Upbeats-music-playlist.xml';

// Fast-loading version of Upbeats playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast Upbeats playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('upbeats-playlist')) {
      const cachedData = playlistCache.getCachedData('upbeats-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached Upbeats playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('upbeats');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'upbeats-playlist',
        title: 'Upbeats Playlist',
        artist: 'Various Artists',
        album: 'Upbeats Playlist',
        description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/UpBEATs-music-playlist.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/UpBEATs-music-playlist.webp',
        url: UPBEATS_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'upbeats-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/upbeats',
        albumUrl: '/album/upbeats-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/upbeats', // URL to fetch full data
        link: 'https://upbeatspodcast.com/', // Playlist website link
        playlistContext: {
          source: 'upbeats-playlist-fast',
          originalUrl: UPBEATS_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Upbeats Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast Upbeats playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast Upbeats playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast Upbeats playlist' },
      { status: 500 }
    );
  }
}