import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

// Fast-loading version of HGH playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast HGH playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('hgh-playlist')) {
      const cachedData = playlistCache.getCachedData('hgh-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached HGH playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'hgh-playlist',
        title: 'HGH Music Playlist',
        artist: 'Various Artists',
        album: 'HGH Music Playlist',
        description: 'Every music reference from Homegrown Hits podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-playlist-art.webp',
        url: HGH_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'hgh-playlist',
        type: 'playlist',
        totalTracks: 0,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/hgh',
        albumUrl: '/album/hgh-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/hgh', // URL to fetch full data
        link: 'https://homegrownhits.podbean.com/',
        playlistContext: {
          source: 'hgh-playlist-fast',
          originalUrl: HGH_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'HGH Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast HGH playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast HGH playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast HGH playlist' },
      { status: 500 }
    );
  }
}
