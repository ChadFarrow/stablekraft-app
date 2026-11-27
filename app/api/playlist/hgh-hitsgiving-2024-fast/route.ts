import { NextRequest, NextResponse } from 'next/server';
import { compressedJson } from '@/lib/compressed-json';
import { playlistCache } from '@/lib/playlist-cache';
import { getPlaylistTrackCount } from '@/lib/playlist-track-counts';

const HGH_HITSGIVING_2024_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-hitsgiving-2024-playlist.xml';

// Fast-loading version of HGH Hitsgiving 2024 playlist with minimal data
export async function GET(request: NextRequest) {
  try {
    console.log('🚀 Fast HGH Hitsgiving 2024 playlist endpoint called');

    // Check if we have cached full data to return quickly
    if (playlistCache.isCacheValid('hghHitsgiving2024-playlist')) {
      const cachedData = playlistCache.getCachedData('hghHitsgiving2024-playlist');
      if (cachedData) {
        console.log('⚡ Returning cached HGH Hitsgiving 2024 playlist data');
        return compressedJson(request, cachedData);
      }
    }

    // Get dynamic track count from XML
    const totalTracks = await getPlaylistTrackCount('hghHitsgiving2024');

    // Return lightweight placeholder data immediately while real data loads
    const placeholderPlaylist = {
      success: true,
      albums: [{
        id: 'hghHitsgiving2024-playlist',
        title: 'Homegrown Hits Hitsgiving 2024 Playlist',
        artist: 'Various Artists',
        album: 'Homegrown Hits Hitsgiving 2024 Playlist',
        description: 'The songs of Homegrown Hits Episode 62, the Hitsgiving 2024 special, in play order',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-hitsgiving-2024-playlist-art.jpg',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-hitsgiving-2024-playlist-art.jpg',
        url: HGH_HITSGIVING_2024_PLAYLIST_URL,
        tracks: [], // Start with empty tracks, will load via regular endpoint
        feedId: 'hghHitsgiving2024-playlist',
        type: 'playlist',
        totalTracks,
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/hgh-hitsgiving-2024',
        albumUrl: '/playlist/hgh-hitsgiving-2024',
        isLoading: true, // Flag to indicate this is fast-loading data
        fullDataUrl: '/api/playlist/hgh-hitsgiving-2024', // URL to fetch full data
        playlistContext: {
          source: 'hghHitsgiving2024-playlist-fast',
          originalUrl: HGH_HITSGIVING_2024_PLAYLIST_URL
        }
      }],
      totalCount: 1,
      playlist: {
        title: 'Homegrown Hits Hitsgiving 2024 Playlist',
        items: []
      }
    };

    console.log('⚡ Returning fast HGH Hitsgiving 2024 playlist placeholder');
    return NextResponse.json(placeholderPlaylist);

  } catch (error) {
    console.error('❌ Error in fast HGH Hitsgiving 2024 playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fast HGH Hitsgiving 2024 playlist' },
      { status: 500 }
    );
  }
}
