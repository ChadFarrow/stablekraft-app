'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Play, Pause } from 'lucide-react';
import type { Episode, Track } from '@/types/playlist';

interface EpisodeSectionProps {
  episode: Episode;
  isExpanded: boolean;
  onToggle: () => void;
  onPlayTrack: (track: Track) => void;
  currentTrackId?: string;
  isPlaying?: boolean;
  renderTrack: (track: Track, index: number) => React.ReactNode;
}

export default function EpisodeSection({
  episode,
  isExpanded,
  onToggle,
  onPlayTrack,
  currentTrackId,
  isPlaying,
  renderTrack
}: EpisodeSectionProps) {
  const hasPlayingTrack = episode.tracks.some(t => t.id === currentTrackId);

  const handlePlayEpisode = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (episode.tracks.length > 0) {
      onPlayTrack(episode.tracks[0]);
    }
  };

  return (
    <div className="mb-3">
      {/* Episode Header - Collapsible */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className={`w-full flex items-center justify-between p-3 rounded-lg transition-colors cursor-pointer ${
          hasPlayingTrack
            ? 'bg-[#00ffd5]/10 border border-[#00ffd5]/30'
            : 'bg-white/5 hover:bg-white/10 border border-transparent'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Play Episode Button */}
          <button
            onClick={handlePlayEpisode}
            className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
              hasPlayingTrack && isPlaying
                ? 'bg-[#00ffd5] text-black'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            {hasPlayingTrack && isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          <div className="text-left min-w-0">
            <h3 className="font-semibold text-white text-sm md:text-base truncate">
              {episode.title}
            </h3>
            <p className="text-xs text-gray-400">
              {episode.trackCount} {episode.trackCount === 1 ? 'track' : 'tracks'}
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 ml-2">
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </div>

      {/* Episode Tracks - Collapsible Content */}
      {isExpanded && (
        <div className="mt-1 space-y-0.5 pl-3 border-l-2 border-white/10 ml-4">
          {episode.tracks.map((track, index) => renderTrack(track, index))}
        </div>
      )}
    </div>
  );
}
