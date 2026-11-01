/**
 * Type definitions for RSS parsing
 */

export interface AlternateEnclosure {
  type: string;       // MIME type
  url: string;        // Media URL
  length?: number;    // File size in bytes
  bitrate?: number;
  height?: number;    // Video height for quality
  title?: string;     // Human-readable (max 32 chars)
  default?: boolean;
}

export interface RSSTrack {
  id?: string; // Database primary key or track identifier
  title: string;
  duration: string;
  url?: string;
  trackNumber?: number;
  subtitle?: string;
  summary?: string;
  image?: string;
  explicit?: boolean;
  keywords?: string[];
  startTime?: number; // Add time segment support
  endTime?: number;   // Add time segment support
  // Music track specific fields
  musicTrack?: boolean;
  episodeId?: string;
  episodeDate?: Date;
  publishedAt?: string; // ISO string date for publication date
  source?: string;
  artist?: string;
  guid?: string; // Item GUID for Nostr (different from database ID)
  v4vRecipient?: string;
  v4vValue?: any;
  status?: string; // 'active' | 'unavailable' | 'error'
  // Media type fields for video support
  mediaType?: 'audio' | 'video';
  mimeType?: string;
  alternateEnclosures?: AlternateEnclosure[];
  // Podcast chapters and value time splits (types from lib/podcast-types.ts)
  chaptersUrl?: string;
  chapters?: import('@/lib/podcast-types').PodcastChapter[];
  valueTimeSplits?: import('@/lib/podcast-types').ValueTimeSplit[];
  // RSS parser custom fields
  'podcast:valueRecipient'?: any;
  'podcast:value'?: any;
}

export interface RSSFunding {
  url: string;
  message?: string;
}

// V4V (Value4Value) interfaces
export interface RSSValueTimeSplit {
  startTime: number; // Start time in seconds
  endTime: number;   // End time in seconds
  recipients: RSSValueRecipient[];
  remoteItems?: Array<{
    feedGuid: string;
    itemGuid: string;
  }>;
  totalAmount?: number;
  currency?: string;
}

export interface RSSValueRecipient {
  name: string;
  address?: string; // Lightning address or payment address
  percentage: number;
  amount?: number;
  type: 'remote' | 'local' | 'fee';
  customKey?: string;
  customValue?: string;
}

export interface RSSValue4Value {
  timeSplits?: RSSValueTimeSplit[];
  funding?: RSSFunding[];
  boostagrams?: RSSBoostagram[];
}

export interface RSSBoostagram {
  senderName?: string;
  message?: string;
  amount: number;
  currency?: string;
  timestamp?: string;
  episodeGuid?: string;
}

export interface RSSPodRoll {
  url: string;
  title?: string;
  description?: string;
}

export interface RSSPublisher {
  feedGuid: string;
  feedUrl: string;
  medium: string;
}

export interface RSSPublisherItem {
  feedGuid: string;
  feedUrl: string;
  medium: string;
  title?: string;
}

export interface RSSAlbum {
  title: string;
  artist: string;
  description: string;
  coverArt: string | null;
  tracks: RSSTrack[];
  /** Album release date: from tracks (oldest item pub date when available); used for "Year" sort. */
  releaseDate: string;
  duration?: string;
  link?: string;
  funding?: RSSFunding[];
  subtitle?: string;
  summary?: string;
  keywords?: string[];
  categories?: string[];
  podcastCategories?: string[];
  explicit?: boolean;
  language?: string;
  copyright?: string;
  owner?: {
    name?: string;
    email?: string;
  };
  podroll?: RSSPodRoll[];
  publisher?: RSSPublisher;
  // Music track specific fields
  isMusicTrackAlbum?: boolean;
  source?: string;
  id?: string;
  feedId?: string;
  feedUrl?: string; // For Helipad TLV
  feedGuid?: string; // For Helipad TLV
  remoteFeedGuid?: string; // For Helipad TLV
  guid?: string; // Episode GUID for Helipad TLV
  episodeGuid?: string; // Alternative episode GUID field
  totalTracks?: number;
  /**
   * The feed's real track count from /api/albums-fast. `tracks` there is cut at
   * 20, so count with `albumTrackCount()` (lib/catalog/album-count.ts).
   */
  trackCount?: number;
  /** The Feed row's own classification ('album', 'podcast', …), not `medium`. */
  type?: string;
  /** When the feed/item was added to the site; used for "Added" sort. */
  dateAdded?: string;
  // V4V (Value4Value) fields
  value4Value?: RSSValue4Value;
  v4vRecipient?: string;
  v4vValue?: any;
  // RSS parser custom fields
  'podcast:valueRecipient'?: any;
  'podcast:value'?: any;
}