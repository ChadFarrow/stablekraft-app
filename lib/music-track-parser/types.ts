/**
 * Type definitions for music track parsing
 */

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  episodeId: string;
  episodeTitle: string;
  episodeDate: Date; // Publication date of the episode
  startTime: number; // seconds
  endTime: number; // seconds
  duration: number; // seconds
  audioUrl?: string;
  valueForValue?: {
    lightningAddress: string;
    suggestedAmount: number;
    customKey?: string;
    customValue?: string;
    remotePercentage?: number;
    feedGuid?: string;
    itemGuid?: string;
    resolvedTitle?: string;
    resolvedArtist?: string;
    resolvedImage?: string;
    resolvedAudioUrl?: string;
    resolvedDuration?: number;
    resolved?: boolean;
    lastResolved?: Date;
  };
  source: 'chapter' | 'value-split' | 'description' | 'external-feed';
  feedUrl: string;
  discoveredAt: Date;
  description?: string;
  image?: string;
}

export interface MusicFeed {
  id: string;
  title: string;
  description: string;
  feedUrl: string;
  parentFeedUrl?: string;
  relationship: 'podcast-roll' | 'value-split' | 'related';
  tracks: MusicTrack[];
  lastUpdated: Date;
}

export interface ChapterData {
  version: string;
  chapters: Array<{
    title: string;
    startTime: number;
    endTime?: number;
    url?: string;
    image?: string;
  }>;
}

export interface ValueTimeSplit {
  startTime: number;
  duration: number;
  remotePercentage: number;
  remoteItem?: {
    feedGuid: string;
    itemGuid: string;
  };
}

export interface MusicTrackExtractionResult {
  tracks: MusicTrack[];
  relatedFeeds: MusicFeed[];
  extractionStats: {
    totalTracks: number;
    tracksFromChapters: number;
    tracksFromValueSplits: number;
    tracksFromV4VData: number;
    tracksFromDescription: number;
    relatedFeedsFound: number;
    extractionTime: number;
  };
}

export interface EpisodeContext {
  episodeId: string;
  episodeTitle: string;
  episodeDate: Date;
  channelTitle: string;
  feedUrl: string;
  audioUrl?: string;
}