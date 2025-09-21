'use client';

import { useState, useEffect } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import { logger } from '@/lib/logger';
import { Play, Pause, Music, ExternalLink, Download } from 'lucide-react';

interface Top100Track {
  id: string;
  title: string;
  artist: string;
  episodeTitle: string;
  duration: number;
  audioUrl?: string;
  startTime?: number;
  endTime?: number;
  position: number;
  sats: string;
  podcastLink: string;
  artwork: string;
}

export default function Top100MusicPlaylist() {
  const [tracks, setTracks] = useState<Top100Track[]>([]);
  const [totalTracks, setTotalTracks] = useState(100);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null);
  const [isClient, setIsClient] = useState(false);
  const { playTrack, isPlaying, pause, resume, playAlbum } = useAudio();
  const { shouldPreventClick } = useScrollDetectionContext();

  useEffect(() => {
    setIsClient(true);
    loadTop100Tracks();
  }, []);

  const loadTop100Tracks = async () => {
    try {
      setIsLoading(true);
      
      // Fetch real Top 100 data from our API endpoint
      logger.info('🎵 Loading Top 100 V4V Music data...');
      const response = await fetch('/api/top100-music', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load Top 100 data');
      }
      
      // Convert API data to our component format
      const apiTracks = data.data?.tracks || [];
      const formattedTracks: Top100Track[] = apiTracks.map((track: any) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        episodeTitle: `From Top 100 V4V Music`,
        duration: Math.floor(Math.random() * 300) + 120, // Estimated duration since not in source
        audioUrl: track.audioUrl || undefined, // Use resolved audio URL from API
        position: track.position,
        sats: track.sats,
        podcastLink: track.podcastLink,
        artwork: track.artwork
      }));
      
      logger.info(`✅ Loaded ${formattedTracks.length} real Top 100 tracks`);
      
      setTracks(formattedTracks);
      setTotalTracks(data.data?.totalTracks || formattedTracks.length);
      
    } catch (err) {
      console.error('❌ Error loading Top 100 tracks:', err);
      
      // Fallback to sample data if real data fails
      logger.info('🔄 Falling back to sample data...');
      const sampleTracks: Top100Track[] = Array.from({ length: 10 }, (_, i) => ({
        id: `sample-${i + 1}`,
        title: `Sample Track ${i + 1}`,
        artist: `Sample Artist ${i + 1}`,
        episodeTitle: `V4V Music Episode ${i + 1}`,
        duration: Math.floor(Math.random() * 300) + 120,
        audioUrl: undefined,
        position: i + 1,
        sats: (50000 - (i * 3000)).toLocaleString(),
        podcastLink: `https://podcastindex.org`,
        artwork: `https://picsum.photos/300/300?random=${i + 1}`
      }));
      
      setTracks(sampleTracks);
      setTotalTracks(sampleTracks.length);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayTrack = async (track: Top100Track, index: number) => {
    // Prevent accidental clicks while scrolling
    if (shouldPreventClick()) {
      logger.debug('🚫 Prevented accidental click while scrolling');
      return;
    }

    // If this is the current track and it's playing, pause it
    if (currentTrackIndex === index && isPlaying) {
      pause();
      return;
    }
    
    // If this is the current track and it's paused, resume it
    if (currentTrackIndex === index && !isPlaying) {
      resume();
      return;
    }
    
    // Otherwise, play this track and set up the playlist
    setCurrentTrackIndex(index);
    
    // Create album object for the audio context with only playable tracks
    const playableTracks = tracks.filter(t => t.audioUrl && t.audioUrl.trim() !== '');
    const playlistAlbum = {
      title: 'Top 100 V4V Music',
      artist: 'Various Artists',
      description: 'Top 100 Value for Value music tracks by sats received',
      coverArt: "https://picsum.photos/400/400?random=top100",
      releaseDate: new Date().toISOString(),
      tracks: playableTracks.map(t => ({
        title: t.title,
        url: t.audioUrl!,
        startTime: t.startTime || 0,
        duration: t.duration.toString()
      }))
    };
    
    // Find the correct index in the playable tracks array
    const playableIndex = playableTracks.findIndex(t => t.id === track.id);
    if (playableIndex === -1) {
      console.warn(`⚠️ Track "${track.title}" is not playable (no audio URL)`);
      return;
    }
    
    // Play the album starting from the selected track (use playable index)
    await playAlbum(playlistAlbum, playableIndex);
  };

  const formatDuration = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatSats = (sats: string) => {
    return `${sats} sats`;
  };

  // Don't render anything until client-side hydration is complete
  if (!isClient) {
    return (
      <div className="bg-black/40 backdrop-blur-sm rounded-lg p-6">
        <div className="text-white">Loading Top 100 Music Playlist...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="text-sm text-gray-400">Loading Top 100 music tracks...</div>
        {[...Array(10)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4 bg-white/5 rounded-lg">
            <div className="w-8 h-8 bg-yellow-500 rounded text-center flex items-center justify-center">
              <span className="text-xs font-bold text-black">{i + 1}</span>
            </div>
            <div className="w-12 h-12 bg-gray-700 rounded"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-700 rounded w-3/4"></div>
              <div className="h-3 bg-gray-700 rounded w-1/2"></div>
            </div>
            <div className="h-4 bg-gray-700 rounded w-20"></div>
          </div>
        ))}
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="text-lg text-gray-300">⚠️ No Top 100 tracks found</div>
        <div className="text-sm text-gray-400">
          The Top 100 music playlist tracks may be loading or temporarily unavailable.
        </div>
        <div className="text-xs text-gray-500">
          Check the browser console for more details or try refreshing the page.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-400 mb-3">
        Showing {tracks.length} of {totalTracks} tracks
      </div>
      {tracks.filter(track => track && track.id && track.title).map((track, index) => {
        const isCurrentTrack = currentTrackIndex === index;
        
        return (
          <div 
            key={track.id} 
            className={`flex items-center justify-between p-4 hover:bg-white/10 rounded-lg transition-colors group cursor-pointer ${
              isCurrentTrack ? 'bg-white/20' : ''
            }`}
            onClick={() => handlePlayTrack(track, index)}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Chart Position */}
              <div className="w-8 h-8 bg-yellow-500 text-black rounded text-center flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold">{track.position}</span>
              </div>
              
              {/* Track Artwork */}
              <div className="relative w-10 h-10 md:w-12 md:h-12 flex-shrink-0 overflow-hidden rounded">
                <img 
                  src={track.artwork}
                  alt={track.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    // Only set fallback if we haven't already tried it
                    if (!target.src.includes('picsum.photos')) {
                      console.warn(`⚠️ Failed to load artwork for "${track.title}" - using fallback`);
                      target.src = `https://picsum.photos/150/150?random=${track.position}`;
                    }
                  }}
                />
                {/* Play Button Overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity duration-200">
                  <button 
                    className="bg-white text-black rounded-full p-1 transform hover:scale-110 transition-all duration-200 shadow-lg"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayTrack(track, index);
                    }}
                  >
                    {isCurrentTrack && isPlaying ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </button>
                </div>
              </div>
              
              {/* Track Info */}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate text-sm md:text-base text-white">{track.title}</p>
                <p className="text-xs md:text-sm text-gray-400 truncate">
                  {track.artist} • {formatSats(track.sats)} earned
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
              {/* Duration */}
              <span className="text-xs md:text-sm text-gray-400">
                {formatDuration(track.duration)}
              </span>
              
              {/* External Link */}
              <a 
                href={track.podcastLink}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-gray-400 hover:text-white transition-colors"
                title="View source podcast"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        );
      })}
      
      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <p className="text-sm text-gray-400">
          Top 100 V4V music tracks by value received. 
          <a href="https://github.com/Podcastindex-org/top100_music" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 ml-1">
            Learn more about Value for Value
          </a>
        </p>
      </div>
    </div>
  );
}