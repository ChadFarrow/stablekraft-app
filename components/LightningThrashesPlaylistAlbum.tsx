'use client';

import { useState, useEffect } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import { Play, Pause, Music, ExternalLink, Download } from 'lucide-react';
import { BoostButton } from '@/components/Lightning/BoostButton';

interface LightningThrashesTrack {
  id: string;
  title: string;
  artist: string;
  episodeTitle: string;
  duration: number;
  audioUrl?: string;
  startTime?: number;
  endTime?: number;
  valueForValue?: {
    resolved?: boolean;
    resolvedTitle?: string;
    resolvedArtist?: string;
    resolvedImage?: string;
    resolvedAudioUrl?: string;
  };
}

export default function LightningThrashesPlaylistAlbum() {
  const [tracks, setTracks] = useState<LightningThrashesTrack[]>([]);
  const [totalTracks, setTotalTracks] = useState(383);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null);
  const [isClient, setIsClient] = useState(false);
  const { playTrack, isPlaying, pause, resume, playAlbum } = useAudio();
  const { shouldPreventClick } = useScrollDetectionContext();

  useEffect(() => {
    setIsClient(true);
    loadLightningThrashesTracks();
  }, []);

  const loadLightningThrashesTracks = async () => {
    try {
      console.log('🔄 Loading Lightning Thrashes tracks...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      // Try different API endpoints to find tracks
      let response;
      let isApiData = true;
      let dataSource = '';
      
      // Try the main API without filters first
      try {
        response = await fetch('/api/music-tracks/database?pageSize=1000', { signal: controller.signal });
        dataSource = 'API (no filter)';
        
        if (!response.ok || (await response.clone().json()).data?.tracks?.length === 0) {
          // Try with different source filter
          response = await fetch('/api/music-tracks/database?pageSize=1000&feedUrl=lightning-thrashes', { signal: controller.signal });
          dataSource = 'API (feedUrl filter)';
          
          if (!response.ok || (await response.clone().json()).data?.tracks?.length === 0) {
            // Fall back to static file
            console.log('API endpoints returned no data, trying static file...');
            response = await fetch('/music-tracks.json', { signal: controller.signal });
            dataSource = 'Static file';
            isApiData = false;
          }
        }
      } catch (error) {
        console.log('API failed, trying static data...', error);
        response = await fetch('/music-tracks.json', { signal: controller.signal });
        dataSource = 'Static file (fallback)';
        isApiData = false;
      }
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to load tracks: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const allTracks = isApiData ? (data.data?.tracks || []) : (data.musicTracks || []);
      
      console.log('📊 Data source:', dataSource);
      console.log('📊 Raw data structure:', Object.keys(data));
      
      console.log('📊 Total tracks fetched:', allTracks.length);
      console.log('🔍 Sample track for debugging:', allTracks[0]);
      
      // More comprehensive filtering for Lightning Thrashes tracks
      const lightningThrashesTracks = allTracks.filter((track: any) => {
        const hasLightningThrashesInFeed = track.feedUrl?.toLowerCase().includes('lightning-thrashes');
        const hasLightningThrashesInSource = track.playlistInfo?.source?.toLowerCase().includes('lightning thrashes') ||
                                           track.playlistInfo?.source === 'Lightning Thrashes RSS Playlist';
        const hasLightningThrashesInArtist = track.artist?.toLowerCase().includes('lightning thrashes');
        const hasLightningThrashesInTitle = track.title?.toLowerCase().includes('lightning thrashes');
        const hasLightningThrashesInEpisode = track.episodeTitle?.toLowerCase().includes('lightning thrashes');
        
        const isLightningThrashes = hasLightningThrashesInFeed || hasLightningThrashesInSource || 
                                  hasLightningThrashesInArtist || hasLightningThrashesInTitle || 
                                  hasLightningThrashesInEpisode;
        
        // Track found (removed verbose logging for performance)
        
        return isLightningThrashes;
      });
      
      console.log('📊 Lightning Thrashes tracks found:', lightningThrashesTracks.length);
      console.log('🎵 First few Lightning Thrashes tracks:', lightningThrashesTracks.slice(0, 3));
      
      if (lightningThrashesTracks.length === 0) {
        console.warn('⚠️ No Lightning Thrashes tracks found. Showing sample of all tracks:');
        console.log('Sample tracks:', allTracks.slice(0, 5).map((t: any) => ({
          id: t.id,
          title: t.title, 
          artist: t.artist,
          feedUrl: t.feedUrl,
          source: t.playlistInfo?.source
        })));
        
        // For debugging, show some tracks anyway with a note
        const debugTracks = allTracks.slice(0, 10).map((track: any, index: number) => ({
          ...track,
          title: `[DEBUG] ${track.title || 'Unknown Title'}`,
          artist: `[DEBUG] ${track.artist || 'Unknown Artist'}`
        }));
        
        setTotalTracks(debugTracks.length);
        setTracks(debugTracks);
        console.log('🔧 Showing debug tracks:', debugTracks.length);
      } else {
        setTotalTracks(lightningThrashesTracks.length);
        setTracks(lightningThrashesTracks); // Show all tracks
      }
    } catch (error) {
      console.error('❌ Error loading Lightning Thrashes tracks:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Request timed out');
      }
      // Set some fallback data so the page doesn't look completely broken
      setTotalTracks(0);
      setTracks([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayTrack = async (track: LightningThrashesTrack, index: number) => {
    // Prevent accidental clicks while scrolling
    if (shouldPreventClick()) {
      console.log('🚫 Prevented accidental click while scrolling');
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
    
    // Create album object for the audio context
    const playlistAlbum = {
      title: 'Lightning Thrashes Playlist',
      artist: 'Lightning Thrashes',
      description: 'Music playlist from Lightning Thrashes podcast',
      coverArt: "https://cdn.kolomona.com/podcasts/lightning-thrashes/060/060-Lightning-Thrashes-1000.jpg",
      releaseDate: new Date().toISOString(),
      tracks: tracks.map(t => ({
        title: t.valueForValue?.resolved && t.valueForValue?.resolvedTitle ? t.valueForValue.resolvedTitle : t.title,
        url: t.valueForValue?.resolved && t.valueForValue?.resolvedAudioUrl ? t.valueForValue.resolvedAudioUrl : t.audioUrl || '',
        startTime: t.valueForValue?.resolved ? 0 : (t.startTime || 0), // No startTime for resolved V4V tracks
        duration: t.duration ? t.duration.toString() : '300',
        image: t.valueForValue?.resolvedImage || "https://cdn.kolomona.com/podcasts/lightning-thrashes/060/060-Lightning-Thrashes-1000.jpg"
      }))
    };
    
    // Play the album starting from the selected track
    await playAlbum(playlistAlbum, index);
  };

  const formatDuration = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Don't render anything until client-side hydration is complete
  if (!isClient) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-white">Loading Lightning Thrashes Playlist...</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="text-sm text-gray-400">Loading Lightning Thrashes tracks...</div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4 bg-white/5 rounded-lg">
            <div className="w-12 h-12 bg-gray-700 rounded"></div>
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-700 rounded w-3/4"></div>
              <div className="h-3 bg-gray-700 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="text-center py-8 space-y-4">
        <div className="text-lg text-gray-300">⚠️ No Lightning Thrashes tracks found</div>
        <div className="text-sm text-gray-400">
          The Lightning Thrashes playlist tracks may be loading or temporarily unavailable.
        </div>
        <div className="text-xs text-gray-500">
          Check the browser console for more details or try refreshing the page.
        </div>
      </div>
    );
  }

  if (!isClient) {
    return (
      <div className="text-center py-8">
        <div className="text-sm text-gray-400">Initializing...</div>
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
        const displayTitle = track.valueForValue?.resolved && track.valueForValue?.resolvedTitle
          ? track.valueForValue.resolvedTitle
          : track.title;
        const displayArtist = track.valueForValue?.resolved && track.valueForValue?.resolvedArtist
          ? track.valueForValue.resolvedArtist
          : track.artist;
        const displayImage = track.valueForValue?.resolved && track.valueForValue?.resolvedImage
          ? track.valueForValue.resolvedImage
          : "https://cdn.kolomona.com/podcasts/lightning-thrashes/060/060-Lightning-Thrashes-1000.jpg";
        
        return (
          <div 
            key={track.id} 
            className={`flex items-center justify-between p-4 hover:bg-white/10 rounded-lg transition-colors group cursor-pointer ${
              isCurrentTrack ? 'bg-white/20' : ''
            }`}
            onClick={() => handlePlayTrack(track, index)}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="relative w-10 h-10 md:w-12 md:h-12 flex-shrink-0 overflow-hidden rounded">
                <img 
                  src={displayImage}
                  alt={displayTitle}
                  className="w-full h-full object-cover"
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
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate text-sm md:text-base text-white">{displayTitle}</p>
                <p className="text-xs md:text-sm text-gray-400 truncate">
                  {displayArtist} • {track.episodeTitle || 'Lightning Thrashes'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
              <BoostButton
                trackId={track.id}
                trackTitle={displayTitle}
                artistName={displayArtist}
                className="text-xs"
              />
              <span className="text-xs md:text-sm text-gray-400">
                {formatDuration(track.duration)}
              </span>
            </div>
          </div>
        );
      })}
      
      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <p className="text-sm text-gray-400">
          Lightning Thrashes playlist with Value for Value support. 
          <a href="https://lightningthrashes.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 ml-1">
            Visit Lightning Thrashes
          </a>
        </p>
      </div>
    </div>
  );
} 