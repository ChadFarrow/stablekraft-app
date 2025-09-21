'use client';

import { MusicTrack } from '@/lib/music-track-parser';
import BaseMusicTrackCard from './BaseMusicTrackCard';
import type { BaseMusicTrack } from '@/types/music-track';

interface MusicTrackCardProps {
  track: MusicTrack;
  onPlay?: (track: MusicTrack) => void;
  onViewDetails?: (track: MusicTrack) => void;
  actions?: React.ReactNode;
  selected?: boolean;
}

export default function MusicTrackCard({ track, onPlay, onViewDetails, actions, selected = false }: MusicTrackCardProps) {
  // Convert MusicTrack to BaseMusicTrack format
  const baseTrack: BaseMusicTrack = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    episodeTitle: track.episodeTitle,
    audioUrl: track.audioUrl,
    duration: track.duration,
    startTime: track.startTime,
    endTime: track.endTime,
    image: track.image,
    source: track.source,
    feedUrl: track.feedUrl,
    createdAt: undefined,
    pubDate: track.episodeDate?.toISOString()
  };

  const handlePlay = (baseTrack: BaseMusicTrack) => {
    if (onPlay) {
      onPlay(track); // Pass original track type
    }
  };

  const handleViewDetails = (baseTrack: BaseMusicTrack) => {
    if (onViewDetails) {
      onViewDetails(track); // Pass original track type
    }
  };

  return (
    <BaseMusicTrackCard
      track={baseTrack}
      variant="standard"
      selected={selected}
      actions={actions}
      onPlay={handlePlay}
      onViewDetails={handleViewDetails}
      className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-white/20 hover:bg-white/10"
    />
  );
} 