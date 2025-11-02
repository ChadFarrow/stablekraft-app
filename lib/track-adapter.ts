/**
 * Track Type Adapter
 * 
 * This adapter provides type conversion utilities for Prisma Track objects
 * to work with component types that expect a more flexible track structure.
 */

import { Track } from '@prisma/client';

/**
 * Extended Track type for components (similar to legacy MusicTrackRecord)
 */
export interface ExtendedTrack {
  id: string;
  title: string;
  artist: string;
  episodeId?: string;
  episodeTitle?: string;
  episodeDate?: Date;
  episodeGuid?: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
  audioUrl?: string;
  image?: string;
  description?: string;
  valueForValue?: {
    lightningAddress?: string;
    suggestedAmount?: number;
    currency?: string;
    customKey?: string;
    customValue?: string;
    percentage?: number;
  };
  source?: string;
  feedUrl?: string;
  feedId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Convert Prisma Track to ExtendedTrack format for components
 */
export function prismaTrackToExtendedTrack(track: Track & { Feed?: any }): ExtendedTrack {
  // Extract V4V data from JSON field if present
  const v4vData = typeof track.v4vValue === 'object' && track.v4vValue !== null
    ? track.v4vValue as any
    : null;

  return {
    id: track.id,
    title: track.title,
    artist: track.artist || 'Unknown Artist',
    episodeId: track.guid || track.id,
    episodeTitle: track.title, // Track title as episode title
    episodeDate: track.publishedAt || track.createdAt,
    episodeGuid: track.guid || undefined,
    startTime: track.startTime || undefined,
    endTime: track.endTime || undefined,
    duration: track.duration || undefined,
    audioUrl: track.audioUrl || undefined,
    image: track.image || undefined,
    description: track.description || undefined,
    valueForValue: v4vData ? {
      lightningAddress: v4vData.lightningAddress || v4vData.v4vRecipient || undefined,
      suggestedAmount: v4vData.suggestedAmount || undefined,
      currency: v4vData.currency || undefined,
      customKey: v4vData.customKey || undefined,
      customValue: v4vData.customValue || undefined,
      percentage: v4vData.remotePercentage || v4vData.percentage || undefined
    } : undefined,
    source: track.Feed?.type || 'external-feed',
    feedUrl: track.Feed?.originalUrl || '',
    feedId: track.feedId,
    createdAt: track.createdAt,
    updatedAt: track.updatedAt
  };
}

// Legacy alias for backward compatibility
export type MusicTrackRecord = ExtendedTrack;
export const prismaTrackToMusicTrackRecord = prismaTrackToExtendedTrack;

/**
 * Convert ExtendedTrack to Prisma Track input format
 */
export function extendedTrackToPrismaInput(record: ExtendedTrack, feedId: string): any {
  return {
    id: record.id,
    guid: record.episodeGuid || record.id,
    title: record.title,
    artist: record.artist,
    album: undefined,
    audioUrl: record.audioUrl || '',
    startTime: record.startTime || null,
    endTime: record.endTime || null,
    duration: record.duration ? Math.round(record.duration) : null,
    image: record.image || null,
    description: record.description || null,
    publishedAt: record.episodeDate || new Date(),
    feedId,
    v4vValue: record.valueForValue ? {
      lightningAddress: record.valueForValue.lightningAddress,
      suggestedAmount: record.valueForValue.suggestedAmount,
      currency: record.valueForValue.currency,
      customKey: record.valueForValue.customKey,
      customValue: record.valueForValue.customValue,
      remotePercentage: record.valueForValue.percentage
    } : null,
    updatedAt: new Date()
  };
}

