/**
 * Track extraction methods for various sources
 */
import { createErrorLogger } from '../error-utils';
import { RSSValueRecipient } from '../rss-parser';
import { ParserUtils } from './utils';
import { V4VResolver } from './v4v-resolver';
import type { MusicTrack, EpisodeContext, ChapterData } from './types';

export class TrackExtractors {
  private static readonly logger = createErrorLogger('TrackExtractors');

  /**
   * Extract music tracks from value time splits
   */
  static async extractTracksFromValueSplits(
    item: any,
    context: EpisodeContext
  ): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];

    // Use the enhanced V4V parsing from RSSParser
    // Look for podcast:valueTimeSplit elements inside podcast:value
    const valueElement = item['podcast:value'] || item.value;
    if (!valueElement) return tracks;

    const valueSplits = valueElement['podcast:valueTimeSplit'] || valueElement.valueTimeSplit || [];
    const splitsArray = Array.isArray(valueSplits) ? valueSplits : [valueSplits];

    for (const split of splitsArray) {
      if (!split) continue;

      const startTime = parseFloat(ParserUtils.getAttributeValue(split, 'startTime') || '0');
      const endTime = parseFloat(ParserUtils.getAttributeValue(split, 'endTime') || '0');
      const duration = endTime > startTime ? endTime - startTime : parseFloat(ParserUtils.getAttributeValue(split, 'duration') || '0');

      // Check for remoteItem elements (V4V music sharing)
      const remoteItems = split['podcast:remoteItem'] || split.remoteItem || [];
      const remoteItemsArray = Array.isArray(remoteItems) ? remoteItems : [remoteItems];

      const hasRemoteItems = remoteItemsArray.some((item: any) => {
        if (!item) return false;
        const feedGuid = ParserUtils.getAttributeValue(item, 'feedGuid');
        const itemGuid = ParserUtils.getAttributeValue(item, 'itemGuid');
        return feedGuid && itemGuid;
      });

      // Also check for remote recipients (fallback)
      const recipients = split['podcast:valueRecipient'] || split.valueRecipient || [];
      const recipientsArray = Array.isArray(recipients) ? recipients : [recipients];

      const hasRemoteRecipients = recipientsArray.some((recipient: any) => {
        if (!recipient) return false;
        const type = ParserUtils.getAttributeValue(recipient, 'type') || 'remote';
        return type === 'remote' && parseFloat(ParserUtils.getAttributeValue(recipient, 'percentage') || '0') > 0;
      });

      if (startTime > 0 && duration > 0 && (hasRemoteItems || hasRemoteRecipients)) {
        // Extract recipient information for V4V data
        const primaryRecipient = recipientsArray.find((recipient: any) => {
          if (!recipient) return false;
          const type = ParserUtils.getAttributeValue(recipient, 'type') || 'remote';
          return type === 'remote';
        });

        const lightningAddress = primaryRecipient ?
          (ParserUtils.getAttributeValue(primaryRecipient, 'address') || ParserUtils.getAttributeValue(primaryRecipient, 'lightning') || '') : '';

        const suggestedAmount = primaryRecipient ?
          parseFloat(ParserUtils.getAttributeValue(primaryRecipient, 'amount') || '0') : 0;

        // Try to extract track title from recipient name, remoteItem, or custom fields
        let trackTitle = `Music Track at ${ParserUtils.formatTime(startTime)}`;
        let remotePercentage = 0;
        let feedGuid = '';
        let itemGuid = '';

        if (hasRemoteItems && remoteItemsArray.length > 0) {
          const primaryRemoteItem = remoteItemsArray[0];
          feedGuid = ParserUtils.getAttributeValue(primaryRemoteItem, 'feedGuid') || '';
          itemGuid = ParserUtils.getAttributeValue(primaryRemoteItem, 'itemGuid') || '';
          // Try to get percentage from the split itself
          remotePercentage = parseFloat(ParserUtils.getAttributeValue(split, 'remotePercentage') || '0');
          trackTitle = `External Music Track at ${ParserUtils.formatTime(startTime)}`;
        } else if (primaryRecipient) {
          const recipientName = ParserUtils.getTextContent(primaryRecipient, 'name') ||
            ParserUtils.getAttributeValue(primaryRecipient, 'name') || '';
          if (recipientName && !recipientName.includes('@')) {
            trackTitle = recipientName;
          }
        }

        // Try to resolve V4V track information using Podcast Index API
        let resolvedTitle = trackTitle;
        let resolvedArtist = context.channelTitle;
        let resolvedImage: string | undefined;
        let resolvedAudioUrl: string | undefined;
        let resolvedDuration: number | undefined;
        let isResolved = false;

        if (feedGuid && itemGuid) {
          try {
            this.logger.info('Attempting to resolve V4V track with Podcast Index', { feedGuid, itemGuid });

            const resolution = await V4VResolver.resolveV4VTrackWithPodcastIndex(feedGuid, itemGuid);

            if (resolution.resolved) {
              resolvedTitle = resolution.title || trackTitle;
              resolvedArtist = resolution.artist || context.channelTitle;
              resolvedImage = resolution.image;
              resolvedAudioUrl = resolution.audioUrl;
              resolvedDuration = resolution.duration;
              isResolved = true;

              this.logger.info('Successfully resolved V4V track', {
                feedGuid,
                itemGuid,
                originalTitle: trackTitle,
                resolvedTitle,
                resolvedArtist
              });
            } else {
              this.logger.warn('Failed to resolve V4V track with Podcast Index', { feedGuid, itemGuid });
            }
          } catch (error) {
            this.logger.error('Error during V4V track resolution', {
              feedGuid,
              itemGuid,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        // This is likely a music track shared via value-for-value
        const track: MusicTrack = {
          id: ParserUtils.generateId(),
          title: resolvedTitle,
          artist: resolvedArtist,
          episodeId: context.episodeId,
          episodeTitle: context.episodeTitle,
          episodeDate: context.episodeDate,
          startTime,
          endTime: startTime + duration,
          duration: resolvedDuration || duration,
          audioUrl: resolvedAudioUrl || context.audioUrl,
          image: resolvedImage,
          source: 'value-split',
          feedUrl: context.feedUrl,
          discoveredAt: new Date(),
          valueForValue: {
            lightningAddress,
            suggestedAmount,
            customKey: ParserUtils.getAttributeValue(split, 'customKey'),
            customValue: ParserUtils.getAttributeValue(split, 'customValue'),
            remotePercentage,
            feedGuid,
            itemGuid,
            resolvedTitle,
            resolvedArtist,
            resolvedImage,
            resolvedAudioUrl,
            resolvedDuration,
            resolved: isResolved,
            lastResolved: isResolved ? new Date() : undefined
          }
        };

        tracks.push(track);
      }
    }

    return tracks;
  }

  /**
   * Extract music tracks from V4V data parsed by RSSParser
   */
  static extractTracksFromV4VData(
    value4Value: any,
    context: EpisodeContext
  ): MusicTrack[] {
    const tracks: MusicTrack[] = [];

    if (!value4Value || !value4Value.timeSplits) {
      return tracks;
    }

    for (const timeSplit of value4Value.timeSplits) {
      // Check if this time split has remote recipients (indicating music sharing)
      const hasRemoteRecipients = timeSplit.recipients &&
        timeSplit.recipients.some((recipient: RSSValueRecipient) =>
          recipient.type === 'remote' && recipient.percentage > 0
        );

      if (hasRemoteRecipients && timeSplit.startTime > 0 && timeSplit.endTime > timeSplit.startTime) {
        // Find the primary remote recipient
        const primaryRecipient = timeSplit.recipients.find((recipient: RSSValueRecipient) =>
          recipient.type === 'remote'
        );

        if (primaryRecipient) {
          // Try to extract track title from recipient name
          let trackTitle = `Music Track at ${ParserUtils.formatTime(timeSplit.startTime)}`;
          if (primaryRecipient.name && !primaryRecipient.name.includes('@')) {
            trackTitle = primaryRecipient.name;
          }

          const track: MusicTrack = {
            id: ParserUtils.generateId(),
            title: trackTitle,
            artist: context.channelTitle,
            episodeId: context.episodeId,
            episodeTitle: context.episodeTitle,
            episodeDate: context.episodeDate,
            startTime: timeSplit.startTime,
            endTime: timeSplit.endTime,
            duration: timeSplit.endTime - timeSplit.startTime,
            audioUrl: context.audioUrl,
            source: 'value-split',
            feedUrl: context.feedUrl,
            discoveredAt: new Date(),
            valueForValue: {
              lightningAddress: primaryRecipient.address || '',
              suggestedAmount: primaryRecipient.amount || 0,
              customKey: primaryRecipient.customKey,
              customValue: primaryRecipient.customValue
            }
          };

          tracks.push(track);
        }
      }
    }

    return tracks;
  }

  /**
   * Extract music tracks from episode description
   */
  static extractTracksFromDescription(
    description: string,
    context: EpisodeContext
  ): MusicTrack[] {
    const tracks: MusicTrack[] = [];

    // Enhanced patterns for extracting songs from episode descriptions
    // Specifically designed for playlist-style feeds like Mike's Mix Tape
    const musicPatterns = [
      // Pattern: "Artist - Song" (most common in playlists)
      /([A-Z][A-Za-z\s&'.-]+)\s*-\s*([A-Z][A-Za-z\s\d\-'",.!?()]+)/g,
      // Pattern: "Artist: Song"
      /([A-Z][A-Za-z\s&'.-]+)\s*:\s*([A-Z][A-Za-z\s\d\-'",.!?()]+)/g,
      // Pattern: "Song by Artist"
      /([A-Z][A-Za-z\s\d\-'",.!?()]+)\s+by\s+([A-Z][A-Za-z\s&'.-]+)/g,
      // Pattern: "Artist 'Song'" or "Artist "Song""
      /([A-Z][A-Za-z\s&'.-]+)\s*['"]([A-Za-z\s\d\-'",.!?()]+)['"]/g,
      // Pattern: "Artist | Song" (common in playlists)
      /([A-Z][A-Za-z\s&'.-]+)\s*\|\s*([A-Z][A-Za-z\s\d\-'",.!?()]+)/g,
      // Legacy patterns for backward compatibility
      /(?:song|track|music|tune):\s*["']([^"']+)["']/gi,
      /["']([^"']+(?:song|track|music|tune)[^"']*)["']/gi,
      /(?:plays?|features?|includes?)\s+["']([^"']+)["']/gi
    ];

    // Also look for bullet-point style lists
    const bulletPatterns = [
      /^[\s]*[-•*]\s*([A-Z][A-Za-z\s&'.-]+)\s*[-:]\s*([A-Z][A-Za-z\s\d\-'",.!?()]+)/gm,
      /^[\s]*[-•*]\s*([A-Z][A-Za-z\s&'.-]+)\s*\|\s*([A-Z][A-Za-z\s\d\-'",.!?()]+)/gm
    ];

    // Combine all patterns
    const allPatterns = [...musicPatterns, ...bulletPatterns];

    for (const pattern of allPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const artist = match[1]?.trim();
        const title = match[2]?.trim();

        if (artist && title && artist.length > 2 && title.length > 2) {
          // Skip if it looks like HTML or generic text
          if (artist.includes('<') || title.includes('<') ||
            artist.includes('http') || title.includes('http') ||
            artist.toLowerCase().includes('unknown') ||
            title.toLowerCase().includes('unknown') ||
            artist.toLowerCase().includes('volume') ||
            title.toLowerCase().includes('volume') ||
            artist.toLowerCase().includes('verse') ||
            title.toLowerCase().includes('verse') ||
            title.toLowerCase().includes('doerfel') ||
            title.toLowerCase().includes('traveling') ||
            title.toLowerCase().includes('thanks') ||
            title.toLowerCase().includes('episode')) {
            continue;
          }

          // Skip very short or generic titles
          if (title.length < 3 || artist.length < 3) {
            continue;
          }

          const track: MusicTrack = {
            id: ParserUtils.generateId(),
            title,
            artist,
            episodeId: context.episodeId,
            episodeTitle: context.episodeTitle,
            episodeDate: context.episodeDate,
            startTime: 0,
            endTime: 0,
            duration: 0,
            audioUrl: context.audioUrl,
            source: 'description',
            feedUrl: context.feedUrl,
            discoveredAt: new Date(),
            description: `Extracted from episode description`
          };

          tracks.push(track);
        }
      }
    }

    return tracks;
  }

  /**
   * Extract V4V tracks by cross-referencing V4V time splits with chapters data
   */
  static async extractV4VTracksFromChapters(
    item: any,
    context: EpisodeContext
  ): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];

    // Look for V4V time splits
    const valueElement = item['podcast:value'] || item.value;
    if (!valueElement) return tracks;

    const valueSplits = valueElement['podcast:valueTimeSplit'] || valueElement.valueTimeSplit || [];
    const splitsArray = Array.isArray(valueSplits) ? valueSplits : [valueSplits];

    // Look for chapters data
    const chaptersElement = item['podcast:chapters'] || item.chapters;
    if (!chaptersElement) return tracks;

    const chaptersUrl = ParserUtils.getAttributeValue(chaptersElement, 'url');
    if (!chaptersUrl) return tracks;

    try {
      // Fetch and parse the chapters JSON file
      const response = await fetch(chaptersUrl);
      if (!response.ok) {
        this.logger.warn('Failed to fetch chapters file for V4V extraction', { url: chaptersUrl });
        return tracks;
      }

      const chaptersData: ChapterData = await response.json();

      // Create a map of start times to chapter data
      const chapterMap = new Map<number, { title: string; image?: string; url?: string }>();
      for (const chapter of chaptersData.chapters) {
        chapterMap.set(chapter.startTime, {
          title: chapter.title,
          image: chapter.image,
          url: chapter.url
        });
      }

      // Process each V4V time split
      for (const split of splitsArray) {
        if (!split) continue;

        const startTime = parseFloat(ParserUtils.getAttributeValue(split, 'startTime') || '0');
        const duration = parseFloat(ParserUtils.getAttributeValue(split, 'duration') || '0');
        const remotePercentage = parseFloat(ParserUtils.getAttributeValue(split, 'remotePercentage') || '0');

        // Check for remoteItem elements (V4V music sharing)
        const remoteItems = split['podcast:remoteItem'] || split.remoteItem || [];
        const remoteItemsArray = Array.isArray(remoteItems) ? remoteItems : [remoteItems];

        const hasRemoteItems = remoteItemsArray.some((item: any) => {
          if (!item) return false;
          const feedGuid = ParserUtils.getAttributeValue(item, 'feedGuid');
          const itemGuid = ParserUtils.getAttributeValue(item, 'itemGuid');
          return feedGuid && itemGuid;
        });

        if (startTime > 0 && duration > 0 && hasRemoteItems) {
          // Find matching chapter by start time
          const chapter = chapterMap.get(startTime);
          if (chapter && !chapter.title.includes('Into The Doerfel-Verse')) {
            // Extract V4V data
            const primaryRemoteItem = remoteItemsArray[0];
            const feedGuid = ParserUtils.getAttributeValue(primaryRemoteItem, 'feedGuid') || '';
            const itemGuid = ParserUtils.getAttributeValue(primaryRemoteItem, 'itemGuid') || '';

            const track: MusicTrack = {
              id: ParserUtils.generateId(),
              title: chapter.title,
              artist: 'Unknown Artist', // We don't have artist info in chapters
              episodeId: context.episodeId,
              episodeTitle: context.episodeTitle,
              episodeDate: context.episodeDate,
              startTime,
              endTime: startTime + duration,
              duration,
              audioUrl: context.audioUrl,
              source: 'value-split',
              feedUrl: context.feedUrl,
              discoveredAt: new Date(),
              image: chapter.image,
              description: chapter.url ? `Album: ${chapter.url}` : undefined,
              valueForValue: {
                lightningAddress: '',
                suggestedAmount: 0,
                remotePercentage,
                feedGuid,
                itemGuid,
                resolved: false
              }
            };

            tracks.push(track);
          }
        }
      }

    } catch (error) {
      this.logger.warn('Failed to extract V4V tracks from chapters', { url: chaptersUrl, error });
    }

    return tracks;
  }

  /**
   * Enhance V4V tracks with chapters data to get actual track titles
   */
  static async enhanceV4VTracksWithChapters(
    tracks: MusicTrack[],
    item: any
  ): Promise<MusicTrack[]> {
    // Look for podcast:chapters element
    const chaptersElement = item['podcast:chapters'] || item.chapters;
    if (!chaptersElement) return tracks;

    const chaptersUrl = ParserUtils.getAttributeValue(chaptersElement, 'url');
    if (!chaptersUrl) return tracks;

    try {
      // Fetch and parse the chapters JSON file
      const response = await fetch(chaptersUrl);
      if (!response.ok) {
        this.logger.warn('Failed to fetch chapters file for V4V enhancement', { url: chaptersUrl });
        return tracks;
      }

      const chaptersData: ChapterData = await response.json();

      // Create a map of start times to chapter titles
      const chapterMap = new Map<number, { title: string; image?: string; url?: string }>();
      for (const chapter of chaptersData.chapters) {
        chapterMap.set(chapter.startTime, {
          title: chapter.title,
          image: chapter.image,
          url: chapter.url
        });
      }

      // Enhance V4V tracks with chapter data
      return tracks.map(track => {
        if (track.source === 'value-split' && track.valueForValue?.feedGuid) {
          // Find matching chapter by start time
          const chapter = chapterMap.get(track.startTime);
          if (chapter && !chapter.title.includes('Into The Doerfel-Verse')) {
            // Use the actual track title from chapters
            return {
              ...track,
              title: chapter.title,
              artist: 'Unknown Artist', // We don't have artist info in chapters
              image: chapter.image || track.image,
              description: chapter.url ? `Album: ${chapter.url}` : track.description
            };
          }
        }
        return track;
      });

    } catch (error) {
      this.logger.warn('Failed to enhance V4V tracks with chapters data', { url: chaptersUrl, error });
    }

    return tracks;
  }
}