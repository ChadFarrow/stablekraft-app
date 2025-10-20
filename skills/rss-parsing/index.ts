import { RSSParser } from '../../lib/rss-parser';
import type { RSSAlbum, RSSTrack } from '../../lib/rss-parser/types';

export interface RSSParsingInput {
  feed_url: string;
  parse_options?: {
    include_chapters?: boolean;
    include_value_splits?: boolean;
    extract_music?: boolean;
    cache_duration?: number;
  };
}

export interface RSSParsingOutput {
  feed_metadata: {
    title: string;
    description: string;
    author: string;
    language?: string;
    category?: string[];
    image_url?: string;
    last_build_date?: string;
    generator?: string;
  };
  episodes: Array<{
    guid: string;
    title: string;
    description: string;
    pub_date: string;
    duration: number;
    audio_url: string;
    chapters: Array<{
      title: string;
      start_time: number;
      end_time: number;
    }>;
    value_splits: Array<{
      name: string;
      start_time: number;
      end_time: number;
      lightning_address?: string;
      custom_key?: string;
      custom_value?: string;
    }>;
    music_tracks: Array<{
      title: string;
      artist: string;
      duration: number;
      start_time: number;
      end_time: number;
      audio_url: string;
      source: string;
    }>;
  }>;
}

export class RSSParsingSkill {
  /**
   * Parse podcast RSS feeds and extract metadata including episodes, chapters, and music track information
   */
  static async parseRSSFeed(input: RSSParsingInput): Promise<RSSParsingOutput> {
    const { feed_url, parse_options = {} } = input;
    
    const {
      include_chapters = true,
      include_value_splits = true,
      extract_music = true,
      cache_duration = 3600
    } = parse_options;

    try {
      // Use existing RSS parser to parse the feed
      const album: RSSAlbum | null = await RSSParser.parseAlbumFeed(feed_url);
      
      if (!album) {
        throw new Error(`Failed to parse RSS feed: ${feed_url}`);
      }

      // Extract feed metadata
      const feed_metadata = {
        title: album.title,
        description: album.description,
        author: album.artist,
        language: album.language,
        category: album.categories,
        image_url: album.coverArt || undefined,
        last_build_date: album.releaseDate,
        generator: 'RSS Parser Skill'
      };

      // Extract episodes from tracks
      const episodes = album.tracks.map((track: RSSTrack) => {
        // Extract chapters if available
        const chapters = include_chapters ? this.extractChapters(track) : [];
        
        // Extract value splits if available
        const value_splits = include_value_splits ? this.extractValueSplits(track) : [];
        
        // Extract music tracks if available
        const music_tracks = extract_music ? this.extractMusicTracks(track) : [];

        return {
          guid: track.guid || `${track.title}-${Date.now()}`,
          title: track.title,
          description: track.summary || track.subtitle || '',
          pub_date: track.episodeDate?.toISOString() || new Date().toISOString(),
          duration: this.parseDuration(track.duration),
          audio_url: track.url || '',
          chapters,
          value_splits,
          music_tracks
        };
      });

      return {
        feed_metadata,
        episodes
      };

    } catch (error) {
      throw new Error(`RSS parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract chapters from track data
   */
  private static extractChapters(track: RSSTrack): Array<{
    title: string;
    start_time: number;
    end_time: number;
  }> {
    const chapters = [];
    
    // If track has time segments, extract them as chapters
    if (track.startTime !== undefined && track.endTime !== undefined) {
      chapters.push({
        title: track.title,
        start_time: track.startTime,
        end_time: track.endTime
      });
    }
    
    return chapters;
  }

  /**
   * Extract value splits from track data
   */
  private static extractValueSplits(track: RSSTrack): Array<{
    name: string;
    start_time: number;
    end_time: number;
    lightning_address?: string;
    custom_key?: string;
    custom_value?: string;
  }> {
    const value_splits = [];
    
    // Extract V4V information if available
    if (track.v4vRecipient) {
      value_splits.push({
        name: track.v4vRecipient,
        start_time: track.startTime || 0,
        end_time: track.endTime || this.parseDuration(track.duration),
        lightning_address: track.v4vRecipient,
        custom_key: track['podcast:valueRecipient']?.customKey,
        custom_value: track['podcast:valueRecipient']?.customValue
      });
    }
    
    return value_splits;
  }

  /**
   * Extract music tracks from track data
   */
  private static extractMusicTracks(track: RSSTrack): Array<{
    title: string;
    artist: string;
    duration: number;
    start_time: number;
    end_time: number;
    audio_url: string;
    source: string;
  }> {
    const music_tracks = [];
    
    // If this is identified as a music track, extract it
    if (track.musicTrack) {
      music_tracks.push({
        title: track.title,
        artist: track.artist || 'Unknown Artist',
        duration: this.parseDuration(track.duration),
        start_time: track.startTime || 0,
        end_time: track.endTime || this.parseDuration(track.duration),
        audio_url: track.url || '',
        source: 'rss_track'
      });
    }
    
    return music_tracks;
  }

  /**
   * Parse duration string to seconds
   */
  private static parseDuration(duration: string): number {
    if (!duration) return 0;
    
    // Handle various duration formats
    const parts = duration.split(':');
    if (parts.length === 2) {
      // MM:SS format
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      // HH:MM:SS format
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    } else {
      // Try to parse as seconds
      const seconds = parseInt(duration);
      return isNaN(seconds) ? 0 : seconds;
    }
  }

  /**
   * Validate RSS feed URL
   */
  static validateFeedUrl(feedUrl: string): boolean {
    try {
      const url = new URL(feedUrl);
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Get feed information without parsing full content
   */
  static async getFeedInfo(feedUrl: string): Promise<{
    title?: string;
    description?: string;
    last_build_date?: string;
    item_count?: number;
  }> {
    try {
      const album = await RSSParser.parseAlbumFeed(feedUrl);
      if (!album) return {};
      
      return {
        title: album.title,
        description: album.description,
        last_build_date: album.releaseDate,
        item_count: album.tracks.length
      };
    } catch (error) {
      throw new Error(`Failed to get feed info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export default RSSParsingSkill;
