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
        id: 'upbeats-playlist',
        title: 'Upbeats Playlist',
        artist: 'Various Artists',
        album: 'Upbeats Playlist',
        description: 'Curated playlist from Upbeats podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/UpBEATs-music-playlist.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/UpBEATs-music-playlist.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Upbeats-music-playlist.xml',
        feedId: 'upbeats-playlist',
        type: 'playlist',
        totalTracks: 554,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/upbeats',
        albumUrl: '/playlist/upbeats',
        playlistContext: {
          source: 'upbeats-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Upbeats-music-playlist.xml'
        }
      },
      {
        id: 'b4ts-playlist',
        title: 'Behind the Sch3m3s Music Playlist',
        artist: 'Various Artists',
        album: 'Behind the Sch3m3s Music Playlist',
        description: 'Curated playlist from Behind the Sch3m3s podcast featuring Value4Value independent artists',
        image: '/placeholder-podcast.jpg',
        coverArt: '/placeholder-podcast.jpg',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml',
        feedId: 'b4ts-playlist',
        type: 'playlist',
        totalTracks: 565,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/b4ts',
        albumUrl: '/playlist/b4ts',
        isLoading: true, // Flag for fast-loading
        fullDataUrl: '/api/playlist/b4ts', // URL for full data
        playlistContext: {
          source: 'b4ts-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml'
        }
      },
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
        title: 'ITDV Music Playlist',
        artist: 'Various Artists',
        album: 'ITDV Music Playlist',
        description: 'Every music reference from Into The Doerfel-Verse podcast',
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
        title: 'HGH Music Playlist',
        artist: 'Various Artists',
        album: 'HGH Music Playlist',
        description: 'Every music reference from Homegrown Hits podcast',
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
        title: 'Mutton, Mead & Music Playlist',
        artist: 'Various Artists',
        album: 'Mutton, Mead & Music Playlist',
        description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
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
      },
      {
        id: 'mmt-playlist',
        title: "Mike's Mix Tape Music Playlist",
        artist: 'Various Artists',
        album: "Mike's Mix Tape Music Playlist",
        description: 'Curated playlist from Mike\'s Mix Tape podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/MMT-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/MMT-playlist-art.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml',
        feedId: 'mmt-playlist',
        type: 'playlist',
        totalTracks: 146,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/mmt',
        albumUrl: '/playlist/mmt',
        isLoading: true, // Flag for fast-loading
        fullDataUrl: '/api/playlist/mmt', // URL for full data
        playlistContext: {
          source: 'mmt-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml'
        }
      },
      {
        id: 'sas-playlist',
        title: 'Sats and Sounds Music Playlist',
        artist: 'Various Artists',
        album: 'Sats and Sounds Music Playlist',
        description: 'Curated playlist from Sats and Sounds podcast featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/SAS-playlist-art%20.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/SAS-playlist-art%20.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml',
        feedId: 'sas-playlist',
        type: 'playlist',
        totalTracks: 500, // Estimated based on analysis
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/sas',
        albumUrl: '/playlist/sas',
        isLoading: true, // Flag for fast-loading
        fullDataUrl: '/api/playlist/sas', // URL for full data
        playlistContext: {
          source: 'sas-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml'
        }
      },
      {
        id: 'flowgnar-playlist',
        title: 'Flowgnar Music Playlist',
        artist: 'Various Artists',
        album: 'Flowgnar Music Playlist',
        description: 'Curated playlist from Flowgnar podcast featuring outdoor adventure music',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist-art.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist.xml',
        feedId: 'flowgnar-playlist',
        type: 'playlist',
        totalTracks: 200, // Estimated based on analysis
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/flowgnar',
        albumUrl: '/playlist/flowgnar',
        playlistContext: {
          source: 'flowgnar-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist.xml'
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