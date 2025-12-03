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
  rank?: number; // Chart position for Top 100 playlist
  boosts?: number; // Number of boosts for Top 100
  albumTitle?: string; // Album/feed title for share links
  feedTitle?: string; // Feed title for share links
  episodeId?: string; // Reference to parent episode group
  episodeIndex?: number; // Position within episode group
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
  v4vRecipient?: string;
  v4vValue?: any;
}

// Episode group from <podcast:txt purpose="episode"> markers
export interface Episode {
  id: string;           // Generated from episode title
  title: string;        // Episode title from podcast:txt tag
  trackCount: number;   // Number of tracks in this episode
  tracks: Track[];      // Tracks belonging to this episode
  index: number;        // Order in the playlist (0 = first/newest)
}

export type SortOption = 'original' | 'episode-desc' | 'episode-asc' | 'title-asc' | 'title-desc' | 'artist-asc' | 'artist-desc' | 'time-asc';
export type FilterSource = 'all' | 'chapter' | 'value-split' | 'description' | 'external-feed';
export type ViewMode = 'main' | 'complete';
export type EpisodeViewMode = 'grouped' | 'flat';
export type CacheStatus = 'fresh' | 'cached' | 'stale' | null;

export interface CachedData {
  tracks: Track[];
  episodes?: Episode[];         // Episode grouping data
  hasEpisodeMarkers?: boolean;  // Whether the playlist has episode markers
  timestamp: number;
  feedUrl: string;
  artwork?: string;
  link?: string;
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