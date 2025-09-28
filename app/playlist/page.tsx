'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAudio } from '@/contexts/AudioContext';
import LoadingSpinner from '@/components/LoadingSpinner';
import { toast } from '@/components/Toast';
import CDNImage from '@/components/CDNImage';

export const dynamic = 'force-dynamic';

interface PlaylistTrack {
  title: string;
  duration: string;
  url: string;
  trackNumber: number;
  subtitle?: string;
  summary?: string;
  image?: string;
  explicit: boolean;
  keywords?: string[];
  albumTitle: string;
  albumArtist: string;
  albumCoverArt?: string;
  feedId: string;
  globalTrackNumber: number;
}

interface PlaylistData {
  title: string;
  description: string;
  tracks: PlaylistTrack[];
  totalTracks: number;
  feedId: string | null;
}

function PlaylistContent() {
  const searchParams = useSearchParams();
  const feedId = searchParams?.get('feedId');
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number>(0);
  const { playAlbum, currentPlayingAlbum, isPlaying, pause, resume, currentTrackIndex: audioCurrentTrackIndex } = useAudio();

  useEffect(() => {
    loadPlaylist();
  }, [feedId]);

  const loadPlaylist = async () => {
    try {
      setIsLoading(true);
      const url = feedId 
        ? `/api/playlist?format=json&feedId=${feedId}`
        : '/api/playlist?format=json';
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load playlist');
      
      const data: PlaylistData = await response.json();
      setPlaylist(data);
    } catch (error) {
      console.error('Error loading playlist:', error);
      toast.error('Failed to load playlist');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayTrack = async (track: PlaylistTrack, index: number) => {
    setCurrentTrackIndex(index);
    
    // Create a minimal album object for the audio player
    const album = {
      id: track.feedId,
      title: track.albumTitle,
      artist: track.albumArtist,
      description: `Playlist track from ${track.albumTitle}`,
      coverArt: track.albumCoverArt || track.image || '',
      releaseDate: new Date().toISOString(),
      tracks: (playlist?.tracks || []).map(t => ({
        title: t.title,
        duration: t.duration,
        url: t.url,
        trackNumber: t.globalTrackNumber,
        subtitle: t.subtitle,
        summary: t.summary,
        image: t.image,
        explicit: t.explicit,
        keywords: t.keywords
      }))
    };

    try {
      await playAlbum(album, index);
    } catch (error) {
      console.error('Error playing track:', error);
      toast.error('Failed to play track');
    }
  };

  const playNext = () => {
    if (!playlist || !playlist.tracks || currentTrackIndex >= playlist.tracks.length - 1) return;
    const nextIndex = currentTrackIndex + 1;
    handlePlayTrack(playlist.tracks[nextIndex], nextIndex);
  };

  const togglePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const playPrevious = () => {
    if (!playlist || !playlist.tracks || currentTrackIndex <= 0) return;
    const prevIndex = currentTrackIndex - 1;
    handlePlayTrack(playlist.tracks[prevIndex], prevIndex);
  };

  const shufflePlaylist = () => {
    if (!playlist || !playlist.tracks) return;

    const shuffledTracks = [...playlist.tracks];
    for (let i = shuffledTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
    }

    setPlaylist({ ...playlist, tracks: shuffledTracks });
    toast.success('Playlist shuffled!');
  };

  const copyPlaylistUrl = () => {
    const url = feedId 
      ? `${window.location.origin}/api/playlist?feedId=${feedId}`
      : `${window.location.origin}/api/playlist`;
    navigator.clipboard.writeText(url);
    toast.success('RSS feed URL copied to clipboard!');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <LoadingSpinner size="large" text="Loading playlist..." />
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Playlist not found</h1>
          <Link href="/" className="text-blue-400 hover:text-blue-300 underline">
            Return to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b backdrop-blur-sm bg-black/30 pt-safe-plus pt-12" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/" className="flex items-center gap-4 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 relative border border-gray-700 rounded-lg overflow-hidden">
                <Image 
                  src="/logo.webp" 
                  alt="VALUE Logo" 
                  width={40} 
                  height={40}
                  className="object-cover"
                  priority
                />
              </div>
              <h1 className="text-2xl font-bold">Project StableKraft</h1>
            </Link>
          </div>
        </div>
      </header>

      {/* Playlist Info */}
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">{playlist.title}</h1>
          <p className="text-gray-400 mb-4">{playlist.description}</p>
          
          {/* Playlist Controls */}
          <div className="flex flex-wrap gap-4 mb-6">
            <button
              onClick={shufflePlaylist}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
              </svg>
              Shuffle
            </button>
            
            <button
              onClick={() => playlist.tracks && playlist.tracks.length > 0 && handlePlayTrack(playlist.tracks[0], 0)}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Play All
            </button>
            
            <button
              onClick={copyPlaylistUrl}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg transition-colors font-medium"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
              </svg>
              Copy RSS Feed
            </button>
          </div>
          
          <p className="text-sm text-gray-500">
            {playlist.totalTracks} tracks • Podcasting 2.0 musicL playlist
          </p>
        </div>

        {/* Track List */}
        <div className="space-y-2 pb-32">
          {(playlist.tracks || []).map((track, index) => {
            const isCurrentTrack = currentPlayingAlbum && 
              currentPlayingAlbum.tracks[audioCurrentTrackIndex]?.url === track.url;
            const isActiveIndex = index === currentTrackIndex;
            
            return (
              <div
                key={`${track.feedId}-${track.globalTrackNumber}`}
                className={`group flex items-center gap-4 p-4 rounded-lg transition-all cursor-pointer ${
                  isCurrentTrack 
                    ? 'bg-purple-900/30 border border-purple-500/30' 
                    : 'bg-gray-900/30 hover:bg-gray-800/50'
                }`}
                onClick={() => handlePlayTrack(track, index)}
              >
                {/* Track Number / Play Icon */}
                <div className="w-10 h-10 flex items-center justify-center text-gray-400">
                  {isCurrentTrack && isPlaying ? (
                    <svg className="w-6 h-6 text-purple-400 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                    </svg>
                  ) : (
                    <span className="group-hover:hidden">{index + 1}</span>
                  )}
                  <svg className={`w-6 h-6 hidden group-hover:block ${isCurrentTrack ? 'text-purple-400' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
                
                {/* Track Image */}
                <div className="w-12 h-12 flex-shrink-0">
                  <CDNImage 
                    src={track.image || track.albumCoverArt || ''}
                    alt={track.title}
                    width={64}
                    height={64}
                    className="w-full h-full object-cover rounded"
                  />
                </div>
                
                {/* Track Info */}
                <div className="flex-1 min-w-0">
                  <h3 className={`font-medium truncate ${isCurrentTrack ? 'text-purple-300' : 'text-white'}`}>
                    {track.title}
                  </h3>
                  <p className="text-sm text-gray-400 truncate">
                    {track.albumArtist} • {track.albumTitle}
                  </p>
                </div>
                
                {/* Duration */}
                <div className="text-sm text-gray-400">
                  {track.duration}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PlaylistPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PlaylistContent />
    </Suspense>
  );
} 