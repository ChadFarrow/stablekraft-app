import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const MMT_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml';

// Fast-loading version of MMT playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast MMT playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('mmt-playlist')) {
      const cachedData = playlistCache.getCachedData('mmt-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached MMT playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('mmt');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'mmt-playlist',
        title: "Mike's Mix Tape Music Playlist",
        artist: 'Various Artists',
        album: "Mike's Mix Tape Music Playlist",
        description: 'Curated playlist from Mike\'s Mix Tape podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/MMT-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/MMT-playlist-art.webp',
        url: MMT_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'mmt-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/mmt',
        albumUrl: '/album/mmt-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/mmt', // URL to fetch full data
        link: 'https://mikesmixtape.com/', // Playlist website link
        playlistContext: {
          source: 'mmt-playlist-fast',
          originalUrl: MMT_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: "Mike's Mix Tape Music Playlist",
        items: []
      }
    };

    console.log('⚡ Returning fast MMT playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast MMT playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast MMT playlist' },
      { status: 500 }
    );
  }
}