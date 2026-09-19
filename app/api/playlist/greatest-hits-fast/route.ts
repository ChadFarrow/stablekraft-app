import { NextRequest, NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const GREATEST_HITS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Greatest-Hits-music-playlist.xml';

// Fast-loading version of Greatest Hits playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast Greatest Hits playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('greatestHits-playlist')) {
      const cachedData = playlistCache.getCachedData('greatestHits-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached Greatest Hits playlist data');
        return compressedJson(request, cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('greatestHits');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'greatestHits-playlist',
        title: "ChadF's Greatest Hits Music Playlist",
        artist: 'Various Artists',
        album: "ChadF's Greatest Hits Music Playlist",
        description: 'Most frequently played tracks across all ChadF musicL playlists - songs appearing 2+ times, organized by play count',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/Greatest-Hits-music-playlist.png',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/Greatest-Hits-music-playlist.png',
        url: GREATEST_HITS_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'greatestHits-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/greatest-hits',
        albumUrl: '/album/greatest-hits-playlist',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/greatest-hits', // URL to fetch full data
        playlistContext: {
          source: 'greatestHits-playlist-fast',
          originalUrl: GREATEST_HITS_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: "ChadF's Greatest Hits Music Playlist",
        items: []
      }
    };

    console.log('⚡ Returning fast Greatest Hits playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast Greatest Hits playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast Greatest Hits playlist' },
      { status: 500 }
    );
  }
}
