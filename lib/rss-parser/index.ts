/**
 * RSS Parser
 * Split into focused modules for better maintainability
 */
import { AppError, ErrorCodes, withRetry, createErrorLogger } from '../error-utils';
import { RSSUtils, verboseLog } from './utils';
import type { RSSAlbum, RSSTrack, RSSValue4Value } from './types';

export * from './types';

export class RSSParser {
  private static readonly logger = createErrorLogger('RSSParser');

  static async parseAlbumFeed(feedUrl: string): Promise<RSSAlbum | null> {
    return withRetry(async () => {
      verboseLog('[RSSParser] Parsing RSS feed', { feedUrl });

      // For server-side fetching, always use direct URLs
      // For client-side fetching, use the proxy
      const isServer = typeof window === 'undefined';

      let response;
      try {
        if (isServer) {
          // Server-side: fetch directly
          response = await fetch(feedUrl);
        } else {
          // Client-side: use proxy or direct API routes
          const isApiRoute = feedUrl.startsWith('/api/');
          const isAlreadyProxied = feedUrl.startsWith('/api/fetch-rss');

          let proxyUrl: string;
          if (isApiRoute && !isAlreadyProxied) {
            // Direct API route (e.g., /api/podcastindex)
            proxyUrl = feedUrl;
          } else if (isAlreadyProxied) {
            // Already proxied through fetch-rss
            proxyUrl = feedUrl;
          } else {
            // External URL, proxy through fetch-rss
            proxyUrl = `/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`;
          }

          response = await fetch(proxyUrl);
        }
      } catch (error) {
        throw new AppError(
          'Failed to fetch RSS feed',
          ErrorCodes.RSS_FETCH_ERROR,
          500,
          true,
          { feedUrl, error }
        );
      }

      if (!response.ok) {
        if (response.status === 429) {
          throw new AppError(
            'Rate limited while fetching RSS feed',
            ErrorCodes.RATE_LIMIT_ERROR,
            429,
            true,
            { feedUrl, status: response.status }
          );
        }
        throw new AppError(
          `Failed to fetch RSS feed: ${response.status}`,
          ErrorCodes.RSS_FETCH_ERROR,
          response.status,
          response.status >= 500,
          { feedUrl, status: response.status }
        );
      }

      const xmlText = await response.text();

      // Validate response content
      if (!RSSUtils.isValidRSSContent(xmlText)) {
        throw new AppError(
          'Invalid RSS content received',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }

      // Parse XML content
      let xmlDoc: any;
      try {
        if (typeof window !== 'undefined') {
          // Browser environment
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        } else {
          // Server environment - use xmldom
          const { DOMParser } = await import('@xmldom/xmldom');
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        }

        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
        if (parserError) {
          throw new AppError(
            'Invalid XML format in RSS feed',
            ErrorCodes.RSS_PARSE_ERROR,
            400,
            false,
            { feedUrl, parserError: parserError.textContent }
          );
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'Failed to parse XML content',
          ErrorCodes.RSS_PARSE_ERROR,
          400,
          false,
          { feedUrl, error }
        );
      }

      // Extract channel info
      const channels = xmlDoc.getElementsByTagName('channel');
      if (!channels || channels.length === 0) {
        throw new AppError(
          'Invalid RSS feed: no channel found',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }
      const channel = channels[0];

      const titleElement = channel.getElementsByTagName('title')[0];
      const title = RSSUtils.getElementText(titleElement) || 'Unknown Album';
      const descriptionElement = channel.getElementsByTagName('description')[0];
      const description = RSSUtils.getElementText(descriptionElement) || '';
      const linkElement = channel.getElementsByTagName('link')[0];
      const link = RSSUtils.getElementText(linkElement) || '';

      // Extract metadata
      const subtitle = this.extractSubtitle(channel);
      const summary = this.extractSummary(channel) || description;
      const keywords = this.extractKeywords(channel);
      const categories = this.extractCategories(channel);
      const explicit = this.extractExplicit(channel);
      const language = this.extractLanguage(channel);
      const copyright = this.extractCopyright(channel);
      const owner = this.extractOwner(channel);

      // Extract cover art
      const coverArt = this.extractCoverArt(channel);

      // Extract tracks from items
      const tracks = this.extractTracks(channel);

      // Calculate total duration
      const totalDurationSeconds = tracks.reduce((total, track) => {
        return total + RSSUtils.parseDuration(track.duration);
      }, 0);
      const duration = RSSUtils.formatDuration(totalDurationSeconds);

      // Extract funding info
      const funding = this.extractFunding(channel);

      // Extract podroll
      const podroll = this.extractPodroll(channel);

      // Extract publisher info
      const publisher = this.extractPublisher(channel);

      // Extract V4V data
      const value4Value = this.extractValue4Value(channel);

      // Determine release date
      const releaseDate = this.extractReleaseDate(channel, tracks);

      // Determine artist from channel info
      const artist = this.extractArtist(channel) || 'Unknown Artist';

      const album: RSSAlbum = {
        title,
        artist,
        description: RSSUtils.cleanHtmlContent(description) || '',
        coverArt,
        tracks,
        releaseDate,
        duration,
        link: RSSUtils.sanitizeUrl(link),
        funding,
        subtitle,
        summary: RSSUtils.cleanHtmlContent(summary),
        keywords,
        categories,
        explicit,
        language,
        copyright,
        owner,
        podroll,
        publisher,
        value4Value,
        isMusicTrackAlbum: tracks.some(track => track.musicTrack),
        source: feedUrl,
        id: this.generateAlbumId(title, artist),
        feedId: feedUrl
      };

      this.logger.info('Successfully parsed RSS feed', {
        feedUrl,
        title: album.title,
        trackCount: album.tracks.length
      });

      return album;
    });
  }

  // Extract methods will be implemented in separate files
  private static extractSubtitle(channel: Element): string | undefined {
    const subtitleElement = channel.getElementsByTagName('itunes:subtitle')[0] ||
                           channel.getElementsByTagName('subtitle')[0];
    return RSSUtils.cleanHtmlContent(RSSUtils.getElementText(subtitleElement));
  }

  private static extractSummary(channel: Element): string | undefined {
    const summaryElement = channel.getElementsByTagName('itunes:summary')[0] ||
                          channel.getElementsByTagName('summary')[0];
    return RSSUtils.cleanHtmlContent(RSSUtils.getElementText(summaryElement));
  }

  private static extractKeywords(channel: Element): string[] {
    const keywordsElement = channel.getElementsByTagName('itunes:keywords')[0] ||
                           channel.getElementsByTagName('keywords')[0];
    const keywordsText = RSSUtils.getElementText(keywordsElement);
    return keywordsText ? keywordsText.split(',').map(k => k.trim()).filter(k => k) : [];
  }

  private static extractCategories(channel: Element): string[] {
    const categoryElements = RSSUtils.getElementsByTagName(channel, 'itunes:category');
    return categoryElements.map(el => RSSUtils.getElementAttribute(el, 'text')).filter(Boolean);
  }

  private static extractExplicit(channel: Element): boolean {
    const explicitElement = channel.getElementsByTagName('itunes:explicit')[0] ||
                           channel.getElementsByTagName('explicit')[0];
    const explicitText = RSSUtils.getElementText(explicitElement).toLowerCase();
    return explicitText === 'yes' || explicitText === 'true';
  }

  private static extractLanguage(channel: Element): string | undefined {
    const languageElement = channel.getElementsByTagName('language')[0];
    return RSSUtils.getElementText(languageElement) || undefined;
  }

  private static extractCopyright(channel: Element): string | undefined {
    const copyrightElement = channel.getElementsByTagName('copyright')[0];
    return RSSUtils.getElementText(copyrightElement) || undefined;
  }

  private static extractOwner(channel: Element): { name?: string; email?: string } | undefined {
    const ownerElement = channel.getElementsByTagName('itunes:owner')[0];
    if (!ownerElement) return undefined;

    const nameElement = ownerElement.getElementsByTagName('itunes:name')[0];
    const emailElement = ownerElement.getElementsByTagName('itunes:email')[0];

    const name = RSSUtils.getElementText(nameElement);
    const email = RSSUtils.getElementText(emailElement);

    return (name || email) ? { name: name || undefined, email: email || undefined } : undefined;
  }

  private static extractCoverArt(channel: Element): string | null {
    // Try multiple sources for cover art
    const imageElement = channel.getElementsByTagName('itunes:image')[0] ||
                        channel.getElementsByTagName('image')[0];

    if (imageElement) {
      const href = RSSUtils.getElementAttribute(imageElement, 'href');
      if (href) return RSSUtils.sanitizeUrl(href) || null;

      const url = RSSUtils.getElementText(imageElement.getElementsByTagName('url')[0]);
      if (url) return RSSUtils.sanitizeUrl(url) || null;
    }

    return null;
  }

  private static extractTracks(channel: Element): RSSTrack[] {
    const items = RSSUtils.getElementsByTagName(channel, 'item');
    return items.map((item, index) => this.parseTrackFromItem(item, index + 1)).filter(Boolean) as RSSTrack[];
  }

  private static parseTrackFromItem(item: Element, trackNumber: number): RSSTrack | null {
    const titleElement = item.getElementsByTagName('title')[0];
    const title = RSSUtils.getElementText(titleElement);
    if (!title) return null;

    const durationElement = item.getElementsByTagName('itunes:duration')[0] ||
                           item.getElementsByTagName('duration')[0];
    const duration = RSSUtils.getElementText(durationElement) || '0:00';

    const enclosureElement = item.getElementsByTagName('enclosure')[0];
    const url = enclosureElement ? RSSUtils.getElementAttribute(enclosureElement, 'url') : '';

    const subtitleElement = item.getElementsByTagName('itunes:subtitle')[0];
    const subtitle = RSSUtils.cleanHtmlContent(RSSUtils.getElementText(subtitleElement));

    const summaryElement = item.getElementsByTagName('itunes:summary')[0] ||
                          item.getElementsByTagName('description')[0];
    const summary = RSSUtils.cleanHtmlContent(RSSUtils.getElementText(summaryElement));

    const imageElement = item.getElementsByTagName('itunes:image')[0];
    const image = imageElement ? RSSUtils.getElementAttribute(imageElement, 'href') : undefined;

    const explicitElement = item.getElementsByTagName('itunes:explicit')[0];
    const explicit = RSSUtils.getElementText(explicitElement).toLowerCase() === 'yes';

    const keywordsElement = item.getElementsByTagName('itunes:keywords')[0];
    const keywordsText = RSSUtils.getElementText(keywordsElement);
    const keywords = keywordsText ? keywordsText.split(',').map(k => k.trim()).filter(k => k) : [];

    return {
      title,
      duration,
      url: RSSUtils.sanitizeUrl(url),
      trackNumber,
      subtitle,
      summary,
      image: RSSUtils.sanitizeUrl(image),
      explicit,
      keywords,
      musicTrack: true
    };
  }

  private static extractFunding(channel: Element): any[] {
    // Placeholder for funding extraction
    return [];
  }

  private static extractPodroll(channel: Element): any[] {
    // Placeholder for podroll extraction
    return [];
  }

  private static extractPublisher(channel: Element): any {
    // Placeholder for publisher extraction
    return undefined;
  }

  private static extractValue4Value(channel: Element): RSSValue4Value | undefined {
    // Placeholder for V4V extraction
    return undefined;
  }

  private static extractReleaseDate(channel: Element, tracks: RSSTrack[]): string {
    // Try to get from pubDate
    const pubDateElement = channel.getElementsByTagName('pubDate')[0];
    if (pubDateElement) {
      const pubDate = new Date(RSSUtils.getElementText(pubDateElement));
      if (!isNaN(pubDate.getTime())) {
        return pubDate.toISOString().split('T')[0];
      }
    }

    // Fallback to current date
    return new Date().toISOString().split('T')[0];
  }

  private static extractArtist(channel: Element): string | undefined {
    const authorElement = channel.getElementsByTagName('itunes:author')[0] ||
                         channel.getElementsByTagName('author')[0] ||
                         channel.getElementsByTagName('managingEditor')[0];
    return RSSUtils.getElementText(authorElement) || undefined;
  }

  private static generateAlbumId(title: string, artist: string): string {
    const baseString = `${title}-${artist}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return baseString.substring(0, 50);
  }

  /**
   * Parse publisher feed info (placeholder implementation)
   */
  static async parsePublisherFeedInfo(feedUrl: string): Promise<{
    title?: string;
    description?: string;
    artist?: string;
    coverArt?: string;
  } | null> {
    this.logger.warn('parsePublisherFeedInfo not implemented in modular RSS parser', { feedUrl });
    // TODO: Implement publisher feed info parsing
    return null;
  }

  /**
   * Parse publisher feed items and metadata
   */
  static async parsePublisherFeed(feedUrl: string): Promise<{
    publisherInfo: {
      title?: string;
      description?: string;
      artist?: string;
      coverArt?: string;
    };
    remoteItems: Array<{
      feedGuid: string;
      feedUrl: string;
      medium: string;
      title?: string;
    }>;
  }> {
    return withRetry(async () => {
      this.logger.info('Parsing publisher feed', { feedUrl });

      // Fetch the feed
      const response = await fetch(feedUrl);
      if (!response.ok) {
        throw new AppError(
          `Failed to fetch publisher feed: ${response.status}`,
          ErrorCodes.RSS_FETCH_ERROR,
          response.status,
          response.status >= 500,
          { feedUrl, status: response.status }
        );
      }

      const xmlText = await response.text();

      // Parse XML content
      let xmlDoc: any;
      try {
        if (typeof window !== 'undefined') {
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        } else {
          const { DOMParser } = await import('@xmldom/xmldom');
          const parser = new DOMParser();
          xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        }
      } catch (error) {
        throw new AppError(
          'Failed to parse XML content',
          ErrorCodes.RSS_PARSE_ERROR,
          400,
          false,
          { feedUrl, error }
        );
      }

      // Extract channel
      const channels = xmlDoc.getElementsByTagName('channel');
      if (!channels || channels.length === 0) {
        throw new AppError(
          'Invalid RSS feed: no channel found',
          ErrorCodes.RSS_INVALID_FORMAT,
          400,
          false,
          { feedUrl }
        );
      }
      const channel = channels[0];

      // Extract publisher metadata from channel
      const titleElement = channel.getElementsByTagName('title')[0];
      const title = RSSUtils.getElementText(titleElement);

      const descriptionElement = channel.getElementsByTagName('description')[0];
      const description = RSSUtils.getElementText(descriptionElement);

      const artistElement = channel.getElementsByTagName('itunes:author')[0] ||
                           channel.getElementsByTagName('author')[0];
      const artist = RSSUtils.getElementText(artistElement);

      // Extract cover art using the same method as album feeds
      const coverArt = this.extractCoverArt(channel);

      // Extract podcast:remoteItem elements
      const remoteItems: Array<{
        feedGuid: string;
        feedUrl: string;
        medium: string;
        title?: string;
      }> = [];

      // Get all elements with tag name containing "remoteItem"
      const allElements = channel.getElementsByTagName('*');
      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        const tagName = element.tagName || element.nodeName;

        if (tagName === 'podcast:remoteItem' || tagName === 'remoteItem') {
          const feedGuid = RSSUtils.getElementAttribute(element, 'feedGuid');
          const feedUrlAttr = RSSUtils.getElementAttribute(element, 'feedUrl');
          const medium = RSSUtils.getElementAttribute(element, 'medium') || 'music';

          if (feedGuid && feedUrlAttr) {
            remoteItems.push({
              feedGuid,
              feedUrl: feedUrlAttr,
              medium
            });
          }
        }
      }

      this.logger.info('Successfully parsed publisher feed', {
        feedUrl,
        remoteItemCount: remoteItems.length,
        hasImage: !!coverArt
      });

      return {
        publisherInfo: {
          title,
          description,
          artist,
          coverArt: coverArt || undefined
        },
        remoteItems
      };
    });
  }
}