'use client';

import { useState, useEffect } from 'react';
import { Play, Pause, Music, Loader2, ExternalLink, AlertCircle } from 'lucide-react';

interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  episodeTitle: string;
  audioUrl: string;
  feedGuid?: string;
  itemGuid?: string;
  resolved?: boolean;
  resolvedAudioUrl?: string;
  resolvedTitle?: string;
  resolvedArtist?: string;
  image?: string;
}

export default function ITDVMusicPlaylistPage() {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<string | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [resolvingTracks, setResolvingTracks] = useState<Set<string>>(new Set());
  const [resolvedCount, setResolvedCount] = useState(0);

  useEffect(() => {
    loadTracks();
  }, []);

  const loadTracks = async () => {
    try {
      const response = await fetch('/api/music-tracks?feedUrl=https://www.doerfelverse.com/feeds/intothedoerfelverse.xml');
      const data = await response.json();
      
      if (data.success && data.data.tracks) {
        // Filter only V4V value-split tracks with remoteItem references
        const v4vTracks = data.data.tracks.filter((track: any) => 
          track.source === 'value-split' && 
          track.valueForValue?.feedGuid && 
          track.valueForValue?.itemGuid
        );
        
        // Convert to our MusicTrack interface
        const formattedTracks = v4vTracks.map((track: any) => ({
          id: track.id,
          title: track.title,
          artist: track.artist || 'Unknown Artist',
          episodeTitle: track.episodeTitle,
          audioUrl: track.url || track.audioUrl,
          feedGuid: track.valueForValue?.feedGuid,
          itemGuid: track.valueForValue?.itemGuid,
          resolved: false
        }));
        
        setTracks(formattedTracks);
        
        // Start resolving tracks in batches
        resolveTracksInBatches(formattedTracks);
      }
    } catch (error) {
      console.error('Failed to load tracks:', error);
    } finally {
      setLoading(false);
    }
  };

  const resolveTracksInBatches = async (tracksToResolve: MusicTrack[]) => {
    const batchSize = 5; // Resolve 5 tracks at a time
    
    for (let i = 0; i < tracksToResolve.length; i += batchSize) {
      const batch = tracksToResolve.slice(i, i + batchSize);
      
      await Promise.all(batch.map(track => resolveTrack(track)));
      
      // Small delay between batches to avoid overwhelming the API
      if (i + batchSize < tracksToResolve.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  };

  const resolveTrack = async (track: MusicTrack) => {
    if (!track.feedGuid || !track.itemGuid || track.resolved) return;
    
    setResolvingTracks(prev => new Set(prev).add(track.id));
    
    try {
      const response = await fetch(
        `/api/resolve-music-track?feedGuid=${track.feedGuid}&itemGuid=${track.itemGuid}`
      );
      const data = await response.json();
      
      if (data.success && data.track) {
        setTracks(prev => prev.map(t => 
          t.id === track.id 
            ? {
                ...t,
                resolved: true,
                resolvedAudioUrl: data.track.audioUrl,
                resolvedTitle: data.track.title,
                resolvedArtist: data.track.artist,
                image: data.track.image
              }
            : t
        ));
        setResolvedCount(prev => prev + 1);
      }
    } catch (error) {
      console.error(`Failed to resolve track ${track.id}:`, error);
    } finally {
      setResolvingTracks(prev => {
        const newSet = new Set(prev);
        newSet.delete(track.id);
        return newSet;
      });
    }
  };

  const playTrack = (track: MusicTrack) => {
    if (audio) {
      audio.pause();
    }

    // Use resolved audio URL if available, otherwise fall back to episode segment
    const audioUrl = track.resolvedAudioUrl || track.audioUrl;
    const newAudio = new Audio(audioUrl);
    
    newAudio.play();
    setAudio(newAudio);
    setCurrentTrack(track.id);
    
    newAudio.addEventListener('ended', () => {
      setCurrentTrack(null);
    });
  };

  const stopTrack = () => {
    if (audio) {
      audio.pause();
      setCurrentTrack(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading playlist...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Music className="w-8 h-8 text-green-400" />
          <div>
            <h1 className="text-3xl font-bold">ITDV Music Library</h1>
            <p className="text-gray-400">Original music tracks from Into The Doerfel Verse</p>
          </div>
        </div>
        
        {/* Status bar */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">
                {tracks.length} V4V music tracks found
              </p>
              {resolvedCount > 0 && (
                <p className="text-xs text-green-400 mt-1">
                  {resolvedCount} tracks resolved to original audio
                </p>
              )}
            </div>
            {resolvingTracks.size > 0 && (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Resolving {resolvingTracks.size} tracks...
              </div>
            )}
          </div>
        </div>

        {/* Info message */}
        <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-blue-300 font-semibold mb-1">About This Playlist</p>
              <p className="text-gray-300">
                This playlist uses V4V (Value for Value) metadata to identify and play the original music tracks 
                featured in ITDV episodes. When available, it plays the actual song files instead of the episode audio.
              </p>
              <p className="text-gray-400 mt-2 text-xs">
                Note: Track resolution requires Podcast Index API access. Add PODCAST_INDEX_API_KEY and PODCAST_INDEX_SECRET 
                to your .env.local file for full functionality.
              </p>
            </div>
          </div>
        </div>

        {/* Track list */}
        <div className="space-y-2">
          {tracks.map((track) => (
            <div 
              key={track.id} 
              className={`bg-gray-800 rounded-lg p-4 flex items-center gap-4 hover:bg-gray-700 transition-colors ${
                resolvingTracks.has(track.id) ? 'opacity-75' : ''
              }`}
            >
              {/* Album art */}
              <div className="w-16 h-16 bg-gray-700 rounded-lg flex items-center justify-center flex-shrink-0">
                {track.image ? (
                  <img 
                    src={track.image} 
                    alt={track.resolvedTitle || track.title}
                    className="w-full h-full object-cover rounded-lg"
                  />
                ) : (
                  <Music className="w-8 h-8 text-gray-500" />
                )}
              </div>
              
              {/* Track info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">
                  {track.resolved && track.resolvedTitle ? track.resolvedTitle : track.title}
                  {track.resolved && (
                    <span className="ml-2 text-xs text-green-400">✓ Original</span>
                  )}
                </h3>
                <p className="text-gray-400 text-sm truncate">
                  {track.resolved && track.resolvedArtist ? track.resolvedArtist : track.artist}
                </p>
                <p className="text-gray-500 text-xs truncate">
                  From: {track.episodeTitle}
                </p>
              </div>
              
              {/* Status indicators */}
              {resolvingTracks.has(track.id) && (
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              )}
              
              {/* Play button */}
              <button
                onClick={() => currentTrack === track.id ? stopTrack() : playTrack(track)}
                disabled={resolvingTracks.has(track.id)}
                className="p-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-full transition-colors"
              >
                {currentTrack === track.id ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </button>
            </div>
          ))}
        </div>

        {tracks.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Music className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No V4V music tracks found</p>
          </div>
        )}
      </div>
    </div>
  );
}