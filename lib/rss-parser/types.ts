/**
 * Type definitions for RSS parsing
 */

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
  releaseDate: string;
  duration?: string;
  link?: string;
  funding?: RSSFunding[];
  subtitle?: string;
  summary?: string;
  keywords?: string[];
  categories?: string[];
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
  // V4V (Value4Value) fields
  value4Value?: RSSValue4Value;
  v4vRecipient?: string;
  v4vValue?: any;
  // RSS parser custom fields
  'podcast:valueRecipient'?: any;
  'podcast:value'?: any;
}