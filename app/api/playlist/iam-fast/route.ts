import { NextRequest, NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const IAM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml';

// Fast-loading version of IAM playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast IAM playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('iam-playlist')) {
      const cachedData = playlistCache.getCachedData('iam-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached IAM playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('iam');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'iam-playlist',
        title: "It's A Mood Music Playlist",
        artist: 'Various Artists',
        album: "It's A Mood Music Playlist",
        description: "Every music reference from It's A Mood podcast",
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.webp',
        url: IAM_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'iam-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/iam',
        albumUrl: '/album/iam-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/iam', // URL to fetch full data
        link: 'https://itsamood.live/',
        playlistContext: {
          source: 'iam-playlist-fast',
          originalUrl: IAM_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: "It's A Mood Music Playlist",
        items: []
      }
    };

    console.log('⚡ Returning fast IAM playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast IAM playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast IAM playlist' },
      { status: 500 }
    );
  }
}
