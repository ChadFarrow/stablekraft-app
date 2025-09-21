export interface Track {
  id: string;
  title: string;
  artist: string;
  episodeTitle: string;
  audioUrl: string;
  startTime: number;
  endTime: number;
  duration: number;
  source: string;
  image?: string;
  feedGuid?: string;
  itemGuid?: string;
  resolved?: boolean;
  loading?: boolean;
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

export type SortOption = 'episode-desc' | 'episode-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc' | 'time-asc';
export type FilterSource = 'all' | 'chapter' | 'value-split' | 'description' | 'external-feed';
export type ViewMode = 'main' | 'complete';
export type CacheStatus = 'fresh' | 'cached' | null;

export interface CachedData {
  tracks: Track[];
  timestamp: number;
  feedUrl: string;
}

export interface PlaylistConfig {
  cacheKey: string;
  cacheDuration: number;
  feedUrl?: string;
  apiEndpoint: string;
  title: string;
  description: string;
  useAudioContext?: boolean;
}

export interface PlaylistStats {
  totalTracks: number;
  totalDuration: number;
  resolvedTracks: number;
  episodes: number;
  sources: Record<string, number>;
}