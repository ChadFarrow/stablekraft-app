'use client';

import { useState, useEffect, useRef } from 'react';
import { useAudio } from '@/contexts/AudioContext';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import { Play, Pause } from 'lucide-react';
import type { PlaylistTrack, PlaylistConfig } from './PlaylistAlbum';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';

interface PlaylistAlbumProgressiveProps {
  tracks: any[]; // Pre-enriched track data
  config: PlaylistConfig;
  onTrackResolved?: (track: PlaylistTrack) => void;
}

const BATCH_SIZE = 10; // Number of tracks to load per batch
const BATCH_DELAY = 100; // Milliseconds between batches

export default function PlaylistAlbumProgressive({ 
  tracks: rawTracks, 
  config, 
  onTrackResolved 
}: PlaylistAlbumProgressiveProps) {
  const [displayedTracks, setDisplayedTracks] = useState<PlaylistTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [currentTrackIndex, setCurrentTrackIndex] = useState<number | null>(null);
  const { isPlaying, pause, resume, playAlbum } = useAudio();
  const { shouldPreventClick } = useScrollDetectionContext();
  const batchTimeoutRef = useRef<NodeJS.Timeout>();

  // Generate realistic duration if not provided
  const generateRealisticDuration = (song: any, index: number): number => {
    if (song.duration && song.duration > 0) return song.duration;
    
    const baseDurations = [180, 210, 240, 195, 225, 165, 270, 200];
    const variation = (Math.random() - 0.5) * 60; // ±30 seconds variation
    return Math.max(120, baseDurations[index % baseDurations.length] + variation);
  };

  // Process tracks progressively in batches
  useEffect(() => {
    const processTracksProgressively = async () => {
      console.log(`✅ Starting progressive loading for playlist: ${config.name}`);
      setIsLoading(true);
      setDisplayedTracks([]);
      setLoadingProgress(0);

      // Filter and prepare all tracks first
      const allProcessedTracks = rawTracks
        .filter(song => song && song.feedGuid && song.itemGuid)
        .map((song, index) => ({
          id: `${config.name.toLowerCase().replace(/\s+/g, '-')}-${index + 1}-${song.feedGuid?.substring(0, 8) || 'unknown'}`,
          title: song.title || `Track ${index + 1}`,
          artist: song.artist || 'Unknown Artist',
          episodeTitle: song.feedTitle || config.name,
          duration: song.duration || generateRealisticDuration(song, index),
          audioUrl: song.audioUrl || '',
          artworkUrl: song.artworkUrl || config.coverArt,
          valueForValue: {
            feedGuid: song.feedGuid,
            itemGuid: song.itemGuid,
            resolved: true,
            resolvedTitle: song.title,
            resolvedArtist: song.artist,
            resolvedImage: song.artworkUrl || config.coverArt,
            resolvedAudioUrl: song.audioUrl,
            resolvedDuration: song.duration
          },
          v4vRecipient: song.v4vRecipient,
          v4vValue: song.v4vValue
        }));

      console.log(`📦 Processing ${allProcessedTracks.length} tracks in batches of ${BATCH_SIZE}`);

      // Load tracks in batches with delays for smooth progressive display
      let batchIndex = 0;
      const loadNextBatch = () => {
        const startIndex = batchIndex * BATCH_SIZE;
        const endIndex = Math.min(startIndex + BATCH_SIZE, allProcessedTracks.length);
        const batch = allProcessedTracks.slice(startIndex, endIndex);

        if (batch.length > 0) {
          setDisplayedTracks(prev => [...prev, ...batch]);
          setLoadingProgress(Math.min(100, Math.round((endIndex / allProcessedTracks.length) * 100)));
          
          console.log(`✅ Loaded batch ${batchIndex + 1}: tracks ${startIndex + 1}-${endIndex} of ${allProcessedTracks.length}`);
          
          // Call onTrackResolved for each track in the batch
          batch.forEach(track => onTrackResolved?.(track));

          batchIndex++;

          // Schedule next batch if there are more tracks
          if (endIndex < allProcessedTracks.length) {
            batchTimeoutRef.current = setTimeout(loadNextBatch, BATCH_DELAY);
          } else {
            // All tracks loaded
            setIsLoading(false);
            setLoadingProgress(100);
            console.log(`🎉 Progressive loading complete: ${allProcessedTracks.length} tracks loaded`);
          }
        } else {
          setIsLoading(false);
          setLoadingProgress(100);
        }
      };

      // Start loading the first batch
      loadNextBatch();
    };

    processTracksProgressively();

    // Cleanup timeout on unmount
    return () => {
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, [rawTracks, config.name, onTrackResolved]);

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePlayTrack = async (trackIndex: number) => {
    if (shouldPreventClick()) return;
    
    const track = displayedTracks[trackIndex];
    if (!track?.audioUrl) {
      console.warn('No audio URL for track:', track?.title);
      return;
    }

    setCurrentTrackIndex(trackIndex);
    
    // Create album for the audio player
    const albumForPlayer = {
      title: config.name,
      artist: track.artist,
      description: config.description,
      coverArt: config.coverArt,
      releaseDate: new Date().toISOString(),
      tracks: [{
        title: track.title,
        duration: track.duration?.toString() || '180',
        url: track.audioUrl,
        trackNumber: trackIndex + 1,
        image: track.artworkUrl,
        artist: track.artist
      }]
    };

    await playAlbum(albumForPlayer, 0);
  };

  const handlePlayPause = async (trackIndex: number) => {
    if (shouldPreventClick()) return;
    
    if (currentTrackIndex === trackIndex && isPlaying) {
      pause();
    } else if (currentTrackIndex === trackIndex && !isPlaying) {
      resume();
    } else {
      await handlePlayTrack(trackIndex);
    }
  };

  if (displayedTracks.length === 0 && !isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 mb-4">No tracks available in this playlist</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Loading Progress Bar */}
      {isLoading && (
        <div className="bg-gray-800/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-300">Loading tracks...</span>
            <span className="text-sm text-gray-400">{displayedTracks.length} of {rawTracks.length}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-orange-500 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Track List - Matching original PlaylistAlbum layout */}
      <div className="space-y-2">
        <div className="text-sm text-gray-400 mb-3">
          Showing {displayedTracks.length} of {rawTracks.length} tracks
          <span className="ml-2 text-green-400">
            • {displayedTracks.length} resolved
          </span>
          <span className="ml-2 text-blue-400">
            • {displayedTracks.filter(t => t.audioUrl).length} with audio
          </span>
        </div>
        
        {displayedTracks.map((track, index) => {
          const isCurrentTrack = currentTrackIndex === index;
          const displayTitle = track.valueForValue?.resolvedTitle || track.title;
          const displayArtist = track.valueForValue?.resolvedArtist || track.artist;
          const displayImage = track.artworkUrl || config.coverArt;
          const hasAudio = Boolean(track.audioUrl);
          const hasArtwork = Boolean(track.valueForValue?.resolvedImage);
          
          return (
            <div 
              key={track.id} 
              className={`flex items-center justify-between p-4 hover:bg-white/10 rounded-lg transition-all duration-200 group animate-in fade-in slide-in-from-left-2 ${
                hasAudio ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
              } ${
                isCurrentTrack ? 'bg-white/20' : ''
              } border-l-2 ${hasAudio ? 'border-green-500/50' : 'border-gray-500/30'}`}
              onClick={() => hasAudio && handlePlayPause(index)}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="relative w-10 h-10 md:w-12 md:h-12 flex-shrink-0 overflow-hidden rounded">
                  <img 
                    src={displayImage}
                    alt={displayTitle}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-medium truncate ${isCurrentTrack ? 'text-orange-400' : 'text-white'}`}>
                      {displayTitle}
                    </h3>
                    {isCurrentTrack && isPlaying && (
                      <div className="flex-shrink-0 text-orange-400">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 truncate">
                    {displayArtist} • {formatTime(track.duration)}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Favorite Button */}
                {(track.id || track.valueForValue?.itemGuid) && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <FavoriteButton
                      trackId={track.id || track.valueForValue?.itemGuid}
                      size={18}
                      className="text-white"
                    />
                  </div>
                )}

                <div onClick={(e) => e.stopPropagation()}>
                  <BoostButton
                    trackId={track.id || track.valueForValue?.itemGuid}
                    feedId={track.valueForValue?.feedGuid}
                    trackTitle={displayTitle}
                    artistName={displayArtist}
                    lightningAddress={track.v4vRecipient}
                    valueSplits={track.v4vValue?.recipients || track.v4vValue?.destinations 
                      ? (track.v4vValue.recipients || track.v4vValue.destinations)
                          .filter((r: any) => !r.fee)
                          .map((r: any) => ({
                            name: r.name || track.artist,
                            address: r.address || '',
                            split: parseInt(r.split) || 100,
                            type: r.type === 'lnaddress' ? 'lnaddress' : 'node'
                          }))
                      : undefined}
                    episodeGuid={track.valueForValue?.itemGuid}
                    remoteFeedGuid={track.valueForValue?.feedGuid}
                    className="text-xs"
                  />
                </div>
                {hasAudio && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayPause(index);
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 ${
                      isCurrentTrack 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-gray-700 hover:bg-gray-600 text-white opacity-0 group-hover:opacity-100'
                    }`}
                    disabled={shouldPreventClick()}
                  >
                    {isCurrentTrack && isPlaying ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4 ml-0.5" />
                    )}
                  </button>
                )}
                
                <div className="flex flex-col items-end text-xs text-gray-400">
                  <div className="flex items-center gap-1">
                    {hasAudio && (
                      <span className="text-green-500">🎵</span>
                    )}
                    {hasArtwork && (
                      <span className="text-blue-500">🖼️</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Loading indicator for remaining tracks */}
      {isLoading && displayedTracks.length > 0 && (
        <div className="text-center py-4">
          <div className="inline-flex items-center gap-2 text-sm text-gray-400">
            <div className="animate-spin w-4 h-4 border-2 border-gray-600 border-t-orange-500 rounded-full" />
            Loading more tracks...
          </div>
        </div>
      )}
    </div>
  );
}