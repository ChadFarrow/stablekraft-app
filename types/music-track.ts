// Unified music track types for components

export interface BaseMusicTrack {
  id: string;
  title: string;
  artist: string;
  episodeTitle?: string;
  audioUrl?: string;
  duration?: number;
  startTime?: number;
  endTime?: number;
  image?: string;
  source?: string;
  feedUrl?: string;
  createdAt?: string;
  pubDate?: string;
}

export interface V4VMusicTrack extends BaseMusicTrack {
  valueForValue?: {
    feedGuid: string;
    itemGuid: string;
    remotePercentage: number;
    resolved?: boolean;
    resolvedTitle?: string;
    resolvedArtist?: string;
    resolvedAudioUrl?: string;
    resolvedDuration?: number;
  };
}

export type MusicTrackVariant = 'standard' | 'v4v' | 'compact';

export interface MusicTrackCardActions {
  onPlay?: (track: BaseMusicTrack | V4VMusicTrack) => void;
  onViewDetails?: (track: BaseMusicTrack | V4VMusicTrack) => void;
  onFavorite?: (track: BaseMusicTrack | V4VMusicTrack) => void;
  onShare?: (track: BaseMusicTrack | V4VMusicTrack) => void;
}

export interface MusicTrackCardProps extends MusicTrackCardActions {
  track: BaseMusicTrack | V4VMusicTrack;
  variant?: MusicTrackVariant;
  selected?: boolean;
  showV4VBadge?: boolean;
  actions?: React.ReactNode;
  className?: string;
}