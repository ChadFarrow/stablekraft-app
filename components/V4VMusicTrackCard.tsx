'use client';

import { ExtendedTrack } from '@/lib/track-adapter';
import BaseMusicTrackCard from './BaseMusicTrackCard';
import type { V4VMusicTrack, BaseMusicTrack } from '@/types/music-track';

interface V4VMusicTrackCardProps {
  track: ExtendedTrack;
  onPlay?: (track: ExtendedTrack) => void;
  onViewDetails?: (track: ExtendedTrack) => void;
  onFavorite?: (track: ExtendedTrack) => void;
  onShare?: (track: ExtendedTrack) => void;
  showV4VBadge?: boolean;
  compact?: boolean;
}

export default function V4VMusicTrackCard({
  track,
  onPlay,
  onViewDetails,
  onFavorite,
  onShare,
  showV4VBadge = true,
  compact = false
}: V4VMusicTrackCardProps) {
  // Convert ExtendedTrack to V4VMusicTrack format
  const v4vTrack: V4VMusicTrack = {
    id: track.id,
    title: track.title || 'Unknown Title',
    artist: track.artist || 'Unknown Artist',
    episodeTitle: track.episodeTitle,
    audioUrl: track.audioUrl,
    duration: track.duration,
    startTime: track.startTime,
    endTime: track.endTime,
    image: track.image,
    source: track.source,
    feedUrl: track.feedUrl,
    createdAt: undefined,
    pubDate: track.episodeDate?.toISOString(),
    valueForValue: track.valueForValue ? {
      feedGuid: track.valueForValue.lightningAddress || '',
      itemGuid: track.valueForValue.customKey || '',
      remotePercentage: track.valueForValue.percentage || 0,
      resolved: true,
      resolvedTitle: track.title,
      resolvedArtist: track.artist,
      resolvedAudioUrl: track.audioUrl,
      resolvedDuration: track.duration
    } : undefined
  };

  const handlePlay = (baseTrack: BaseMusicTrack | V4VMusicTrack) => {
    if (onPlay) {
      onPlay(track); // Pass original track type
    }
  };

  const handleViewDetails = (baseTrack: BaseMusicTrack | V4VMusicTrack) => {
    if (onViewDetails) {
      onViewDetails(track); // Pass original track type
    }
  };

  const handleFavorite = (baseTrack: BaseMusicTrack | V4VMusicTrack) => {
    if (onFavorite) {
      onFavorite(track); // Pass original track type
    }
  };

  const handleShare = (baseTrack: BaseMusicTrack | V4VMusicTrack) => {
    if (onShare) {
      onShare(track); // Pass original track type
    }
  };

  return (
    <BaseMusicTrackCard
      track={v4vTrack}
      variant={compact ? 'compact' : 'v4v'}
      showV4VBadge={showV4VBadge}
      onPlay={handlePlay}
      onViewDetails={handleViewDetails}
      onFavorite={handleFavorite}
      onShare={handleShare}
      className="bg-white/5 backdrop-blur-sm border-white/10 hover:border-white/20 hover:bg-white/10"
    />
  );
}