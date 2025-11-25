/**
 * Playlist-style feed parsing utilities
 */
import { createErrorLogger } from '../error-utils';
import { ParserUtils } from './utils';
import { V4VResolver } from '../v4v-resolver';
import type { MusicTrack, MusicFeed, MusicTrackExtractionResult } from './types';

export class PlaylistParser {
  private static readonly logger = createErrorLogger('PlaylistParser');

  /**
   * Extract tracks from a playlist-style feed where each item is a song
   */
  static async extractTracksFromPlaylistFeed(
    channel: any,
    feedUrl: string,
    startTime: number
  ): Promise<MusicTrackExtractionResult> {
    const tracks: MusicTrack[] = [];
    const channelTitle = ParserUtils.getTextContent(channel, 'title') || 'Unknown Playlist';
    const isMusicLFeed = channel['podcast:medium'] === 'musicL';

    // Handle podcast:remoteItem elements (Podcasting 2.0 playlist feature)
    const remoteItems = channel['podcast:remoteItem'] || [];
    const remoteItemArray = Array.isArray(remoteItems) ? remoteItems : [remoteItems];

    // Track related feeds for future enhancement
    const relatedFeeds: MusicFeed[] = [];
    const feedGuids = new Set<string>();

    for (const remoteItem of remoteItemArray) {
      if (remoteItem && remoteItem.$) {
        const feedGuid = remoteItem.$.feedGuid;
        const itemGuid = remoteItem.$.itemGuid;

        // Track unique feed GUIDs
        feedGuids.add(feedGuid);

        // Try to resolve the actual track data from the referenced feed
        const resolvedTrack = await V4VResolver.resolveRemoteTrack(feedGuid, itemGuid, channelTitle, feedUrl);

        if (resolvedTrack) {
          tracks.push(resolvedTrack);
        } else {
          // Fallback to placeholder if resolution fails
          const trackTitle = isMusicLFeed
            ? `Music Track (${feedGuid.substring(0, 8)}...)`
            : `Track from ${feedGuid}`;
          const artist = isMusicLFeed ? 'From MusicL Feed' : 'Various Artists';

          const track: MusicTrack = {
            id: ParserUtils.generateId(),
            title: trackTitle,
            artist,
            episodeId: itemGuid,
            episodeTitle: channelTitle,
            episodeDate: new Date(),
            startTime: 0,
            endTime: 0,
            duration: 0,
            source: 'external-feed',
            feedUrl,
            discoveredAt: new Date(),
            description: `Podcasting 2.0 musicL track from feed ${feedGuid}`
          };

          tracks.push(track);
        }
      }
    }

    // Handle regular items if they exist (for non-remoteItem musicL feeds)
    const items = channel.item || [];
    const itemArray = Array.isArray(items) ? items : [items];

    for (const item of itemArray) {
      const itemTitle = ParserUtils.getTextContent(item, 'title') || '';
      const itemDescription = ParserUtils.getTextContent(item, 'description') || '';
      const pubDate = ParserUtils.getTextContent(item, 'pubDate');
      const guid = ParserUtils.getTextContent(item, 'guid') || ParserUtils.generateId();

      // Extract artist and title from the item title
      const { artist, title } = ParserUtils.extractArtistAndTitle(itemTitle);

      // Get audio URL from enclosure
      const enclosure = item.enclosure;
      let audioUrl: string | undefined;
      if (enclosure && enclosure.$ && enclosure.$.url) {
        audioUrl = enclosure.$.url;
      }

      // For musicL feeds, also check for podcast:value elements (Value for Value)
      let valueForValue;
      if (isMusicLFeed && item['podcast:value']) {
        const valueElement = item['podcast:value'];
        if (valueElement && valueElement['podcast:valueRecipient']) {
          const recipients = Array.isArray(valueElement['podcast:valueRecipient'])
            ? valueElement['podcast:valueRecipient']
            : [valueElement['podcast:valueRecipient']];

          // Find the first recipient (usually the artist)
          const firstRecipient = recipients[0];
          if (firstRecipient && firstRecipient.$) {
            valueForValue = {
              lightningAddress: firstRecipient.$.name || '',
              suggestedAmount: parseFloat(valueElement.$.suggested || '0'),
              customKey: firstRecipient.$.customKey,
              customValue: firstRecipient.$.customValue
            };
          }
        }
      }

      // Create a music track from this playlist item
      const track: MusicTrack = {
        id: ParserUtils.generateId(),
        title: title || itemTitle,
        artist: artist || channelTitle,
        episodeId: guid,
        episodeTitle: channelTitle,
        episodeDate: pubDate ? new Date(pubDate) : new Date(),
        startTime: 0,
        endTime: 0,
        duration: 0,
        audioUrl,
        valueForValue,
        source: isMusicLFeed ? 'external-feed' : 'external-feed',
        feedUrl,
        discoveredAt: new Date(),
        description: itemDescription
      };

      tracks.push(track);
    }

    const extractionTime = Date.now() - startTime;

    return {
      tracks,
      relatedFeeds,
      extractionStats: {
        totalTracks: tracks.length,
        tracksFromChapters: 0,
        tracksFromValueSplits: 0,
        tracksFromV4VData: 0,
        tracksFromDescription: 0,
        relatedFeedsFound: relatedFeeds.length,
        extractionTime
      }
    };
  }

  /**
   * Parse podcast roll for related music feeds
   */
  static async parsePodcastRoll(
    channel: any,
    parentFeedUrl: string
  ): Promise<MusicFeed[]> {
    const feeds: MusicFeed[] = [];

    const podRoll = channel['podcast:podroll'] || channel.podroll;
    if (!podRoll) return feeds;

    const podRollItems = podRoll['podcast:remoteItem'] || podRoll.remoteItem || [];
    const itemsArray = Array.isArray(podRollItems) ? podRollItems : [podRollItems];

    for (const item of itemsArray) {
      if (!item) continue;

      const feedGuid = ParserUtils.getAttributeValue(item, 'feedGuid');
      const feedUrl = ParserUtils.getAttributeValue(item, 'feedUrl');

      if (feedUrl) {
        try {
          // Try to fetch basic info about the related feed
          const feedInfo = await this.getFeedBasicInfo(feedUrl);

          const feed: MusicFeed = {
            id: feedGuid || ParserUtils.generateId(),
            title: feedInfo.title || 'Unknown Feed',
            description: feedInfo.description || '',
            feedUrl,
            parentFeedUrl,
            relationship: 'podcast-roll',
            tracks: [],
            lastUpdated: new Date()
          };

          feeds.push(feed);

        } catch (error) {
          this.logger.warn('Failed to get info for related feed', { feedUrl, error });
        }
      }
    }

    return feeds;
  }

  /**
   * Get basic information about a feed without full parsing
   */
  private static async getFeedBasicInfo(feedUrl: string): Promise<{ title?: string; description?: string }> {
    try {
      const response = await fetch(feedUrl);
      if (!response.ok) return {};

      const xmlText = await response.text();
      const xml2js = await import('xml2js');
      const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
      const result = await parser.parseStringPromise(xmlText);

      if (!result.rss || !result.rss.channel) return {};

      const channel = result.rss.channel;
      return {
        title: ParserUtils.getTextContent(channel, 'title'),
        description: ParserUtils.getTextContent(channel, 'description')
      };

    } catch (error) {
      this.logger.warn('Failed to get basic feed info', { feedUrl, error });
      return {};
    }
  }
}