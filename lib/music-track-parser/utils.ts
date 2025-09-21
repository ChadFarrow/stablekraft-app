/**
 * Utility functions for music track parsing
 */

export class ParserUtils {
  /**
   * Get text content from XML element
   */
  static getTextContent(element: any, tagName: string): string | undefined {
    const value = element[tagName];
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object' && value._) return value._.trim();
    return undefined;
  }

  /**
   * Get attribute value from XML element
   */
  static getAttributeValue(element: any, attribute: string): string | undefined {
    if (!element || typeof element !== 'object') return undefined;

    // Check if it's a string (direct value)
    if (typeof element === 'string') return element;

    // Check if it has the attribute directly
    if (element.$ && element.$[attribute]) return element.$[attribute];

    // Check if the element itself has the attribute
    if (element[attribute]) return element[attribute];

    return undefined;
  }

  /**
   * Generate a unique ID
   */
  static generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Format time in seconds to MM:SS format
   */
  static formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Check if a chapter represents a music track
   */
  static isMusicChapter(chapter: { title: string; startTime: number }): boolean {
    const title = chapter.title.toLowerCase();

    // Exclude podcast intro/outro chapters and generic content
    const excludePatterns = [
      'into the doerfel-verse', 'verse', 'tiddicate', 'indicate',
      'intro', 'outro', 'introductory', 'conclusion', 'ending',
      'welcome', 'goodbye', 'thanks', 'thank you', 'shout out',
      'call the hitter', 'special thanks', 'producers', 'boost',
      'boostagram', 'value4value', 'lightning', 'bitcoin'
    ];

    if (excludePatterns.some(pattern => title.includes(pattern))) {
      return false;
    }

    // Exclude very short or generic titles
    if (title.length < 3 || title.length > 100) {
      return false;
    }

    // Exclude titles that are just numbers or timestamps
    if (/^\d+$/.test(title) || /^\d+:\d+$/.test(title)) {
      return false;
    }

    // Keywords that strongly suggest music content
    const musicKeywords = [
      'song', 'track', 'music', 'tune', 'melody', 'jam', 'riff',
      'instrumental', 'acoustic', 'electric', 'guitar', 'piano',
      'drums', 'bass', 'vocal', 'chorus', 'bridge', 'album',
      'single', 'ep', 'remix', 'cover', 'live', 'studio'
    ];

    // Must contain at least one music keyword
    const hasMusicKeyword = musicKeywords.some(keyword => title.includes(keyword));

    // Additional check: if it looks like "Artist - Title" or "Artist: Title" format
    const hasArtistTitleFormat = /^[^-:]+[-:]\s*[^-:]+$/.test(chapter.title.trim());

    return hasMusicKeyword || hasArtistTitleFormat;
  }

  /**
   * Extract artist and title from a track string
   * Common patterns: "Artist - Title", "Artist: Title", "Artist \"Title\"", etc.
   */
  static extractArtistAndTitle(trackString: string): { artist: string; title: string } {
    const trimmed = trackString.trim();

    // Pattern 1: "Artist - Title"
    const dashMatch = trimmed.match(/^(.+?)\s*-\s*(.+)$/);
    if (dashMatch) {
      return {
        artist: dashMatch[1].trim(),
        title: dashMatch[2].trim()
      };
    }

    // Pattern 2: "Artist: Title"
    const colonMatch = trimmed.match(/^(.+?):\s*(.+)$/);
    if (colonMatch) {
      return {
        artist: colonMatch[1].trim(),
        title: colonMatch[2].trim()
      };
    }

    // Pattern 3: "Artist \"Title\""
    const quoteMatch = trimmed.match(/^(.+?)\s*"([^"]+)"$/);
    if (quoteMatch) {
      return {
        artist: quoteMatch[1].trim(),
        title: quoteMatch[2].trim()
      };
    }

    // Pattern 4: "Artist 'Title'"
    const singleQuoteMatch = trimmed.match(/^(.+?)\s*'([^']+)'$/);
    if (singleQuoteMatch) {
      return {
        artist: singleQuoteMatch[1].trim(),
        title: singleQuoteMatch[2].trim()
      };
    }

    // Pattern 5: "Artist (Title)"
    const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (parenMatch) {
      return {
        artist: parenMatch[1].trim(),
        title: parenMatch[2].trim()
      };
    }

    // If no pattern matches, assume the whole string is the title
    return {
      artist: 'Unknown Artist',
      title: trimmed
    };
  }

  /**
   * Convert an RSS item object back to XML string for V4V parsing
   */
  static itemToXmlString(item: any): string {
    let xml = '';

    // Add basic item elements
    if (item.title) {
      xml += `<title><![CDATA[${item.title}]]></title>`;
    }
    if (item.description) {
      xml += `<description><![CDATA[${item.description}]]></description>`;
    }
    if (item.guid) {
      xml += `<guid>${item.guid}</guid>`;
    }
    if (item.pubDate) {
      xml += `<pubDate>${item.pubDate}</pubDate>`;
    }

    // Add V4V elements
    if (item['podcast:valueTimeSplit']) {
      const splits = Array.isArray(item['podcast:valueTimeSplit']) ?
        item['podcast:valueTimeSplit'] : [item['podcast:valueTimeSplit']];

      splits.forEach((split: any) => {
        if (split && split.$) {
          xml += `<podcast:valueTimeSplit`;
          Object.entries(split.$).forEach(([key, value]) => {
            xml += ` ${key}="${value}"`;
          });
          xml += '>';

          if (split['podcast:valueRecipient']) {
            const recipients = Array.isArray(split['podcast:valueRecipient']) ?
              split['podcast:valueRecipient'] : [split['podcast:valueRecipient']];

            recipients.forEach((recipient: any) => {
              if (recipient && recipient.$) {
                xml += `<podcast:valueRecipient`;
                Object.entries(recipient.$).forEach(([key, value]) => {
                  xml += ` ${key}="${value}"`;
                });
                xml += '>';
                if (recipient._) {
                  xml += recipient._;
                }
                xml += '</podcast:valueRecipient>';
              }
            });
          }

          xml += '</podcast:valueTimeSplit>';
        }
      });
    }

    return xml;
  }

  /**
   * Detect if this is a playlist-style feed where each item is a song
   */
  static isPlaylistStyleFeed(channel: any): boolean {
    const title = this.getTextContent(channel, 'title') || '';
    const description = this.getTextContent(channel, 'description') || '';

    // Check for Podcasting 2.0 musicL medium type
    const isMusicLFeed = channel['podcast:medium'] === 'musicL';

    // Check for podcast:remoteItem elements (Podcasting 2.0 playlist feature)
    const hasRemoteItems = channel['podcast:remoteItem'] && channel['podcast:remoteItem'].length > 0;

    // Only treat as playlist if it's explicitly musicL or has remote items
    // Regular music podcasts should use normal episode processing
    return isMusicLFeed || hasRemoteItems;
  }
}