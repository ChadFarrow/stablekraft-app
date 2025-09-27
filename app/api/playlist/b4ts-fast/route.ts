import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

const B4TS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml';

// Fast-loading version of B4TS playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast B4TS playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('b4ts-playlist')) {
      const cachedData = playlistCache.getCachedData('b4ts-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached B4TS playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'b4ts-playlist',
        title: 'Behind the Sch3m3s Music Playlist',
        artist: 'Various Artists',
        album: 'Behind the Sch3m3s Music Playlist',
        description: 'Curated playlist from Behind the Sch3m3s podcast featuring Value4Value independent artists',
        image: '/placeholder-podcast.jpg',
        coverArt: '/placeholder-podcast.jpg',
        url: B4TS_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'b4ts-playlist',
        type: 'playlist',
        totalTracks: 565, // Known count from fast endpoint data
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/b4ts',
        albumUrl: '/album/b4ts-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/b4ts', // URL to fetch full data
        link: 'https://music.behindthesch3m3s.com/', // Playlist website link
        playlistContext: {
          source: 'b4ts-playlist-fast',
          originalUrl: B4TS_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Behind the Sch3m3s Music Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast B4TS playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast B4TS playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast B4TS playlist' },
      { status: 500 }
    );
  }
}