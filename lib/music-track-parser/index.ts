/**
 * Music Track Parser
 * Split into focused modules for better maintainability
 */
import { AppError, ErrorCodes, createErrorLogger } from '../error-utils';
import * as xml2js from 'xml2js';
import { RSSParser } from '../rss-parser';
import { ParserUtils } from './utils';
import { TrackDeduplicator } from './deduplication';
import { TrackExtractors } from './extractors';
import { PlaylistParser } from './playlist-parser';
import type {
  MusicTrack,
  MusicFeed,
  ChapterData,
  MusicTrackExtractionResult,
  EpisodeContext
} from './types';

export * from './types';

export class MusicTrackParser {
  private static readonly logger = createErrorLogger('MusicTrackParser');

  /**
   * Extract music tracks from a podcast RSS feed
   */
  static async extractMusicTracks(feedUrl: string): Promise<MusicTrackExtractionResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Starting music track extraction', { feedUrl });

      // Fetch and parse the RSS feed
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new AppError(`Failed to fetch RSS feed: ${response.statusText}`, ErrorCodes.RSS_FETCH_ERROR);
      }

      const xmlText = await response.text();

      // Parse XML using xml2js
      const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
      const result = await parser.parseStringPromise(xmlText);

      if (!result.rss || !result.rss.channel) {
        throw new AppError('Invalid RSS feed structure', ErrorCodes.RSS_PARSE_ERROR);
      }

      // Check if this is a playlist-style feed (each item is a song)
      const isPlaylistFeed = ParserUtils.isPlaylistStyleFeed(result.rss.channel);

      if (isPlaylistFeed) {
        return PlaylistParser.extractTracksFromPlaylistFeed(result.rss.channel, feedUrl, startTime);
      }

      const tracks: MusicTrack[] = [];
      const relatedFeeds: MusicFeed[] = [];

      // Extract channel information
      const channel = result.rss.channel;
      const channelTitle = ParserUtils.getTextContent(channel, 'title') || 'Unknown Podcast';
      const channelDescription = ParserUtils.getTextContent(channel, 'description') || '';

      // Parse podcast roll for related music feeds
      const podRollFeeds = await PlaylistParser.parsePodcastRoll(channel, feedUrl);
      relatedFeeds.push(...podRollFeeds);

      // Parse each item (episode)
      const items = Array.isArray(channel.item) ? channel.item : [channel.item];
      for (const item of items) {
        if (item) {
          const episodeTracks = await this.extractTracksFromEpisode(item, channelTitle, feedUrl);
          tracks.push(...episodeTracks);
        }
      }

      const extractionTime = Date.now() - startTime;

      const stats = {
        totalTracks: tracks.length,
        tracksFromChapters: tracks.filter(t => t.source === 'chapter').length,
        tracksFromValueSplits: tracks.filter(t => t.source === 'value-split').length,
        tracksFromV4VData: tracks.filter(t => t.source === 'value-split' && t.valueForValue?.lightningAddress).length,
        tracksFromDescription: tracks.filter(t => t.source === 'description').length,
        relatedFeedsFound: relatedFeeds.length,
        extractionTime
      };

      this.logger.info('Music track extraction completed', {
        feedUrl,
        stats
      });

      return {
        tracks,
        relatedFeeds,
        extractionStats: stats
      };

    } catch (error) {
      this.logger.error('Music track extraction failed', { feedUrl, error });
      throw error;
    }
  }

  /**
   * Extract music tracks from a single episode
   */
  private static async extractTracksFromEpisode(
    item: any,
    channelTitle: string,
    feedUrl: string
  ): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];

    const episodeTitle = ParserUtils.getTextContent(item, 'title') || 'Unknown Episode';
    const episodeGuid = ParserUtils.getTextContent(item, 'guid') || ParserUtils.generateId();
    const episodeDescription = ParserUtils.getTextContent(item, 'description') || '';

    // Get audio URL from enclosure element
    let audioUrl: string | undefined;
    const enclosure = item.enclosure;
    if (enclosure && enclosure.$ && enclosure.$.url) {
      audioUrl = enclosure.$.url;
    }

    // Extract episode publication date
    const pubDateStr = ParserUtils.getTextContent(item, 'pubDate');
    const episodeDate = pubDateStr ? new Date(pubDateStr) : new Date();

    const context: EpisodeContext = {
      episodeId: episodeGuid,
      episodeTitle,
      episodeDate,
      channelTitle,
      feedUrl,
      audioUrl
    };

    // 1. Extract tracks from chapter data
    const chapterTracks = await this.extractTracksFromChapters(item, context);
    tracks.push(...chapterTracks);

    // 2. Extract tracks from value time splits (legacy method)
    const valueSplitTracks = await TrackExtractors.extractTracksFromValueSplits(item, context);
    tracks.push(...valueSplitTracks);

    // 3. Extract tracks from V4V data (enhanced method)
    // First, try to parse the item using RSSParser to get V4V data
    try {
      // Create a mock RSS feed structure for the single item
      const mockRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md">
  <channel>
    <title>${channelTitle}</title>
    <item>
      ${ParserUtils.itemToXmlString(item)}
    </item>
  </channel>
</rss>`;

      // Use RSSParser to parse the V4V data
      const tempFeedUrl = `data:text/xml;base64,${Buffer.from(mockRssXml).toString('base64')}`;
      const parsedAlbum = await RSSParser.parseAlbumFeed(tempFeedUrl);

      if (parsedAlbum && parsedAlbum.value4Value) {
        const v4vTracks = TrackExtractors.extractTracksFromV4VData(parsedAlbum.value4Value, context);
        tracks.push(...v4vTracks);
      }
    } catch (error) {
      this.logger.warn('Failed to extract V4V data from episode', {
        episodeId: episodeGuid,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // 4. Extract tracks from episode description
    const descriptionTracks = TrackExtractors.extractTracksFromDescription(episodeDescription, context);
    tracks.push(...descriptionTracks);

    // 5. Extract V4V tracks by cross-referencing with chapters data
    const v4vTracks = await TrackExtractors.extractV4VTracksFromChapters(item, context);
    tracks.push(...v4vTracks);

    // 6. Enhance V4V tracks with chapters data to get actual track titles
    const enhancedTracks = await TrackExtractors.enhanceV4VTracksWithChapters(tracks, item);

    // 7. Deduplicate tracks based on start time and V4V references
    const deduplicatedTracks = TrackDeduplicator.deduplicateTracks(enhancedTracks);

    return deduplicatedTracks;
  }

  /**
   * Extract music tracks from chapter JSON files
   */
  private static async extractTracksFromChapters(item: any, context: EpisodeContext): Promise<MusicTrack[]> {
    const tracks: MusicTrack[] = [];

    // Look for podcast:chapters element
    const chaptersElement = item['podcast:chapters'] || item.chapters;
    if (!chaptersElement) return tracks;

    const chaptersUrl = ParserUtils.getAttributeValue(chaptersElement, 'url');
    if (!chaptersUrl) return tracks;

    try {
      // Fetch and parse the chapters JSON file
      const response = await fetch(chaptersUrl);
      if (!response.ok) {
        this.logger.warn('Failed to fetch chapters file', { url: chaptersUrl });
        return tracks;
      }

      const chaptersData: ChapterData = await response.json();

      // Extract music tracks from chapters
      for (const chapter of chaptersData.chapters) {
        // Check if this chapter represents a music track
        if (ParserUtils.isMusicChapter(chapter)) {
          const { artist, title } = ParserUtils.extractArtistAndTitle(chapter.title);

          const track: MusicTrack = {
            id: ParserUtils.generateId(),
            title: title,
            artist: artist,
            episodeId: context.episodeId,
            episodeTitle: context.episodeTitle,
            episodeDate: context.episodeDate,
            startTime: chapter.startTime,
            endTime: chapter.endTime || chapter.startTime + 300, // Default 5 minutes if no end time
            duration: (chapter.endTime || chapter.startTime + 300) - chapter.startTime,
            audioUrl: context.audioUrl,
            source: 'chapter',
            feedUrl: context.feedUrl,
            discoveredAt: new Date(),
            image: chapter.image
          };

          tracks.push(track);
        }
      }

    } catch (error) {
      this.logger.warn('Failed to parse chapters file', { url: chaptersUrl, error });
    }

    return tracks;
  }
}