/**
 * Utility functions for RSS parsing
 */
import { logger } from '../logger';

// Development logging utility
const isDev = process.env.NODE_ENV === 'development';
const isVerbose = process.env.NEXT_PUBLIC_LOG_LEVEL === 'verbose';

export const devLog = (...args: any[]) => {
  if (isDev) logger.debug(args.join(' '));
};

export const verboseLog = (...args: any[]) => {
  if (isVerbose) logger.debug(args.join(' '));
};

export class RSSUtils {
  /**
   * Helper function to clean HTML content
   */
  static cleanHtmlContent(content: string | null | undefined): string | undefined {
    if (!content) return undefined;
    // Remove HTML tags and decode HTML entities
    return content
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
      .replace(/&amp;/g, '&') // Replace &amp; with &
      .replace(/&lt;/g, '<') // Replace &lt; with <
      .replace(/&gt;/g, '>') // Replace &gt; with >
      .replace(/&quot;/g, '"') // Replace &quot; with "
      .replace(/&#39;/g, "'") // Replace &#39; with '
      .trim();
  }

  /**
   * Get text content from XML element
   */
  static getElementText(element: Element | null): string {
    if (!element) return '';
    return element.textContent?.trim() || '';
  }

  /**
   * Get attribute value from XML element
   */
  static getElementAttribute(element: Element | null, attributeName: string): string {
    if (!element) return '';
    return element.getAttribute(attributeName) || '';
  }

  /**
   * Get elements by tag name with null safety
   */
  static getElementsByTagName(parent: Element | Document, tagName: string): Element[] {
    const elements = parent.getElementsByTagName(tagName);
    return Array.from(elements);
  }

  /**
   * Format duration from seconds to readable format
   */
  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Parse duration string to seconds
   */
  static parseDuration(duration: string): number {
    if (!duration) return 0;

    // Handle different duration formats
    // HH:MM:SS, MM:SS, or just seconds
    const parts = duration.split(':').map(part => parseInt(part, 10));

    if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      // Just seconds
      return parts[0];
    }

    return 0;
  }

  /**
   * Validate and sanitize URL
   */
  static sanitizeUrl(url: string | null | undefined): string | undefined {
    if (!url) return undefined;

    const trimmed = url.trim();
    if (!trimmed) return undefined;

    // Basic URL validation
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      // If it's not a valid URL, return undefined
      return undefined;
    }
  }

  /**
   * Extract podcast namespace values
   */
  static getPodcastNamespaceValue(element: Element, attributeName: string): string {
    // Try different podcast namespace prefixes
    const prefixes = ['podcast:', 'pc:', 'podcasting:'];

    for (const prefix of prefixes) {
      const value = element.getAttribute(prefix + attributeName);
      if (value) return value;
    }

    return '';
  }

  /**
   * Check if string contains valid RSS content
   */
  static isValidRSSContent(content: string): boolean {
    if (!content || typeof content !== 'string') return false;

    const trimmed = content.trim();
    if (trimmed.length === 0) return false;

    // Check for basic XML structure
    if (!trimmed.includes('<') || !trimmed.includes('>')) return false;

    // Check for RSS or feed elements
    return trimmed.includes('<rss') ||
           trimmed.includes('<feed') ||
           trimmed.includes('<channel>') ||
           trimmed.includes('</rss>') ||
           trimmed.includes('</feed>');
  }
}