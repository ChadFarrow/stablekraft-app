import { NextResponse } from 'next/server';
import { getAllPlaylistTrackCounts } from '@/lib/playlist-track-counts';

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
  isLoading?: boolean; // Optional flag for fast-loading playlists
  fullDataUrl?: string; // Optional URL for full data loading
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

    // Fetch dynamic track counts from playlist XMLs
    const trackCounts = await getAllPlaylistTrackCounts();

    // Create lightweight playlist summaries without expensive resolution
    // Top 100 V4V Music was removed on 2026-11-01: its source chart,
    // stats.podcastindex.org/v4vmusic.json, has been empty since 2026-08-21.
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
        totalTracks: trackCounts['upbeats'] || 0,
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
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/b4ts-playlist-art.webp',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/b4ts-playlist-art.webp',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml',
        feedId: 'b4ts-playlist',
        type: 'playlist',
        totalTracks: trackCounts['b4ts'] || 0,
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
        totalTracks: trackCounts['iam'] || 0,
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
        totalTracks: trackCounts['itdv'] || 0,
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
        totalTracks: trackCounts['hgh'] || 0,
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
        totalTracks: trackCounts['mmm'] || 0,
        tracks: [], // Add empty tracks array for compatibility
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/mmm',
        albumUrl: '/playlist/mmm',
        isLoading: true, // Flag for fast-loading
        fullDataUrl: '/api/playlist/mmm', // URL for full data
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
        totalTracks: trackCounts['mmt'] || 0,
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
        totalTracks: trackCounts['sas'] || 0,
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
        totalTracks: trackCounts['flowgnar'] || 0,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/flowgnar',
        albumUrl: '/playlist/flowgnar',
        playlistContext: {
          source: 'flowgnar-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist.xml'
        }
      },
      {
        id: 'tft-playlist',
        title: 'Two for Tunestr Music Playlist',
        artist: 'Various Artists',
        album: 'Two for Tunestr Music Playlist',
        description: 'Every music reference from Two for Tunestr',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-playlist-art.png',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-playlist-art.png',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-music-playlist.xml',
        feedId: 'tft-playlist',
        type: 'playlist',
        totalTracks: trackCounts['tft'] || 0,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/tft',
        albumUrl: '/playlist/tft',
        isLoading: true,
        fullDataUrl: '/api/playlist/tft',
        playlistContext: {
          source: 'tft-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/TFT-music-playlist.xml'
        }
      },
      {
        id: 'lt-playlist',
        title: 'Lightning Thrashes Music Playlist',
        artist: 'Various Artists',
        album: 'Lightning Thrashes Music Playlist',
        description: 'Curated playlist from Lightning Thrashes featuring Value4Value independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.png',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.png',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.xml',
        feedId: 'lt-playlist',
        type: 'playlist',
        totalTracks: trackCounts['lt'] || 0,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/lt',
        albumUrl: '/playlist/lt',
        isLoading: true,
        fullDataUrl: '/api/playlist/lt',
        playlistContext: {
          source: 'lt-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/LT-music-playlist.xml'
        }
      },
      {
        id: 'greatestHits-playlist',
        title: "ChadF's Greatest Hits Music Playlist",
        artist: 'Various Artists',
        album: "ChadF's Greatest Hits Music Playlist",
        description: 'Most frequently played tracks across all ChadF musicL playlists - songs appearing 2+ times, organized by play count',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/Greatest-Hits-music-playlist.png',
        coverArt: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/Greatest-Hits-music-playlist.png',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Greatest-Hits-music-playlist.xml',
        feedId: 'greatestHits-playlist',
        type: 'playlist',
        totalTracks: trackCounts['greatestHits'] || 0,
        tracks: [],
        publishedAt: new Date().toISOString(),
        isPlaylistCard: true,
        playlistUrl: '/playlist/greatest-hits',
        albumUrl: '/playlist/greatest-hits',
        isLoading: true,
        fullDataUrl: '/api/playlist/greatest-hits',
        playlistContext: {
          source: 'greatestHits-playlist',
          originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/Greatest-Hits-music-playlist.xml'
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