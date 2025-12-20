/**
 * Shared types for playlist handling
 */

import type { V4VValue } from '@/lib/v4v-utils';

export interface PlaylistConfig {
  id: string;                    // e.g., 'mmm', 'hgh', 'sas'
  url: string;                   // XML feed URL
  name: string;                  // Display name, e.g., 'Mutton, Mead & Music'
  shortName: string;             // Short name for logs, e.g., 'MMM'
  author: string;                // Playlist author
  description: string;           // Default description
  cacheDuration: number;         // Cache duration in ms
  maxDuration: number;           // API timeout in seconds
  playlistUrl: string;           // Frontend URL, e.g., '/playlist/mmm'
  albumUrl: string;              // Album-style URL
}

export interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  episodeTitle?: string;
  episodeId?: string;
  episodeIndex?: number;
}

export interface ParsedEpisodeMarker {
  type: 'episode';
  title: string;
}

export interface ParsedRemoteItem {
  type: 'remoteItem';
  feedGuid: string;
  itemGuid: string;
}

export type ParsedPlaylistItem = ParsedEpisodeMarker | ParsedRemoteItem;

export interface EpisodeGroup {
  id: string;
  title: string;
  trackCount: number;
  tracks: ResolvedTrack[];
  index: number;
}

export interface ResolvedTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  url?: string;
  duration: number;
  publishedAt: string;
  image: string;
  albumTitle?: string;
  feedTitle?: string;
  feedId?: string;
  guid: string;
  v4vRecipient?: string | null;
  v4vValue?: V4VValue | null;
  playlistContext?: {
    feedGuid: string;
    itemGuid: string;
    source: string;
  };
  episodeTitle?: string;
  episodeId?: string;
  episodeIndex?: number;
  resolved?: boolean;
  // Additional fields for track context
  startTime?: number;
  endTime?: number;
  source?: string;
  description?: string;
}

export interface PlaylistAlbum {
  id: string;
  title: string;
  artist: string;
  album?: string;
  description: string;
  image: string;
  coverArt?: string;
  url?: string;
  link?: string | null;
  tracks: ResolvedTrack[];
  episodes: EpisodeGroup[];
  hasEpisodeMarkers: boolean;
  feedId?: string;
  type: 'playlist';
  totalTracks: number;
  publishedAt: string;
  isPlaylistCard: boolean;
  playlistUrl: string;
  albumUrl: string;
  playlistContext?: {
    source: string;
    originalUrl: string;
    resolvedTracks: number;
    totalRemoteItems: number;
    totalEpisodes: number;
  };
}

export interface PlaylistResponse {
  success: boolean;
  albums: PlaylistAlbum[];
  totalCount: number;
  fromDatabase?: boolean;
  playlist: {
    title: string;
    description: string;
    author: string;
    totalItems: number;
    items: PlaylistAlbum[];
  };
}

export interface GroupedItems {
  episodes: { title: string; remoteItems: RemoteItem[] }[];
  ungroupedItems: RemoteItem[];
  hasEpisodeMarkers: boolean;
}
