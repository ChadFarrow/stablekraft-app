import { NextResponse } from 'next/server';

// Fast playlist endpoint for filter UI - returns basic info only
// This avoids the expensive track resolution in individual playlist APIs

interface PlaylistSummary {
  id: string;
  title: string;
  artist: string;
  album: string;
  description: string;
  image: string;
  coverArt: string;
  url: string;
  feedId: string;
  type: 'playlist';
  totalTracks: number;
  tracks: any[]; // Add tracks array for compatibility
  publishedAt: string;
  isPlaylistCard: boolean;
  playlistUrl: string;
  albumUrl: string;
  playlistContext: {
    source: string;
    originalUrl: string;
  };
}

// Cache for fast responses
let fastPlaylistCache: { data: PlaylistSummary[]; timestamp: number } | null = null;
const CACHE_DURATION = 1000 * 60 * 10; // 10 minute cache

export async function GET() {
  try {
    console.log('🚀 Fast playlists API called');

    // Check cache first
    if (fastPlaylistCache && (Date.now() - fastPlaylistCache.timestamp) < CACHE_DURATION) {
      console.log('⚡ Using cached fast playlist data');
      return NextResponse.json({
        success: true,
        albums: fastPlaylistCache.data,
        totalCount: fastPlaylistCache.data.length
      });
    }

    // Create lightweight playlist summaries without expensive resolution
    const playlists: PlaylistSummary[] = [
      {
        id: 'iam-playlist',
        title: "It's A Mood Music Playlist",
        artist: 'Various Artists',
        album: "It's A Mood Music Playlist",
        description: 'Every music reference from the It\'s a Mood podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml',
        feedId: 'iam-playlist',
        type: 'playlist',
        totalTracks: 342,
        tracks: [], // Add empty tracks array for compatibility
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/iam',
        albumUrl: '/playlist/iam',
        playlistContext: {
          source: 'iam-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml'
        }
      },
      {
        id: 'itdv-playlist',
        title: 'Into the Valueverse Playlist',
        artist: 'Various Artists',
        album: 'Into the Valueverse Playlist',
        description: 'Music featured in Into the Valueverse podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml',
        feedId: 'itdv-playlist',
        type: 'playlist',
        totalTracks: 50, // Estimated count
        tracks: [], // Add empty tracks array for compatibility
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/itdv',
        albumUrl: '/playlist/itdv',
        playlistContext: {
          source: 'itdv-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml'
        }
      },
      {
        id: 'hgh-playlist',
        title: 'Homegrown Hits Playlist',
        artist: 'Various Artists',
        album: 'Homegrown Hits Playlist',
        description: 'Music featured in Homegrown Hits podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-playlist-art.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml',
        feedId: 'hgh-playlist',
        type: 'playlist',
        totalTracks: 75, // Estimated count
        tracks: [], // Add empty tracks array for compatibility
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/hgh',
        albumUrl: '/playlist/hgh',
        playlistContext: {
          source: 'hgh-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml'
        }
      },
      {
        id: 'mmm-playlist',
        title: 'Modern Music Movements Playlist',
        artist: 'Various Artists',
        album: 'Modern Music Movements Playlist',
        description: 'Music featured in Modern Music Movements podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-playlist-art.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml',
        feedId: 'mmm-playlist',
        type: 'playlist',
        totalTracks: 1468, // Actual count - 100% resolved with placeholders
        tracks: [], // Add empty tracks array for compatibility
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/mmm',
        albumUrl: '/playlist/mmm',
        playlistContext: {
          source: 'mmm-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml'
        }
      }
    ];

    console.log(`✅ Created ${playlists.length} fast playlist summaries`);

    // Cache the response
    fastPlaylistCache = {
      data: playlists,
      timestamp: Date.now()
    };

    return NextResponse.json({
      success: true,
      albums: playlists,
      totalCount: playlists.length
    });

  } catch (error) {
    console.error('❌ Error in fast playlists API:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}