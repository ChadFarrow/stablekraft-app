import { MusicTrackParser } from '../../lib/music-track-parser';
import type { MusicTrack, MusicTrackExtractionResult, EpisodeContext } from '../../lib/music-track-parser/types';

export interface MusicExtractionInput {
  episode_data: {
    guid: string;
    title: string;
    description: string;
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
    audio_url?: string;
  };
  extraction_options?: {
    source_types?: Array<'chapters' | 'value_splits' | 'description' | 'audio'>;
    min_duration?: number;
    max_duration?: number;
    deduplicate?: boolean;
    enhance_metadata?: boolean;
  };
}

export interface MusicExtractionOutput {
  music_tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album?: string;
    duration: number;
    start_time: number;
    end_time: number;
    audio_url: string;
    source: string;
    metadata: {
      genre?: string;
      year?: number;
      artwork_url?: string;
      isrc?: string;
    };
    v4v_info: {
      lightning_address?: string;
      custom_key?: string;
      custom_value?: string;
    };
  }>;
}

export class MusicExtractionSkill {
  /**
   * Extract music tracks from podcast episodes using chapters, value splits, and content analysis
   */
  static async extractMusicTracks(input: MusicExtractionInput): Promise<MusicExtractionOutput> {
    const { episode_data, extraction_options = {} } = input;
    
    const {
      source_types = ['chapters', 'value_splits', 'description'],
      min_duration = 30,
      max_duration = 600,
      deduplicate = true,
      enhance_metadata = true
    } = extraction_options;

    try {
      const musicTracks: Array<{
        id: string;
        title: string;
        artist: string;
        album?: string;
        duration: number;
        start_time: number;
        end_time: number;
        audio_url: string;
        source: string;
        metadata: {
          genre?: string;
          year?: number;
          artwork_url?: string;
          isrc?: string;
        };
        v4v_info: {
          lightning_address?: string;
          custom_key?: string;
          custom_value?: string;
        };
      }> = [];

      // Extract tracks from chapters
      if (source_types.includes('chapters')) {
        const chapterTracks = this.extractTracksFromChapters(episode_data, min_duration, max_duration);
        musicTracks.push(...chapterTracks);
      }

      // Extract tracks from value splits
      if (source_types.includes('value_splits')) {
        const valueSplitTracks = this.extractTracksFromValueSplits(episode_data, min_duration, max_duration);
        musicTracks.push(...valueSplitTracks);
      }

      // Extract tracks from description
      if (source_types.includes('description')) {
        const descriptionTracks = this.extractTracksFromDescription(episode_data, min_duration, max_duration);
        musicTracks.push(...descriptionTracks);
      }

      // Deduplicate tracks if requested
      const finalTracks = deduplicate ? this.deduplicateTracks(musicTracks) : musicTracks;

      // Enhance metadata if requested
      const enhancedTracks = enhance_metadata ? await this.enhanceTrackMetadata(finalTracks) : finalTracks;

      return {
        music_tracks: enhancedTracks
      };

    } catch (error) {
      throw new Error(`Music extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract tracks from chapter data
   */
  private static extractTracksFromChapters(
    episodeData: MusicExtractionInput['episode_data'],
    minDuration: number,
    maxDuration: number
  ): Array<MusicExtractionOutput['music_tracks'][0]> {
    const tracks: Array<MusicExtractionOutput['music_tracks'][0]> = [];

    for (const chapter of episodeData.chapters) {
      const duration = chapter.end_time - chapter.start_time;
      
      // Filter by duration
      if (duration < minDuration || duration > maxDuration) {
        continue;
      }

      // Check if this looks like a music track
      if (this.isMusicChapter(chapter.title)) {
        const { artist, title } = this.extractArtistAndTitle(chapter.title);
        
        tracks.push({
          id: this.generateTrackId(episodeData.guid, chapter.start_time),
          title,
          artist,
          duration,
          start_time: chapter.start_time,
          end_time: chapter.end_time,
          audio_url: episodeData.audio_url || '',
          source: 'chapter',
          metadata: {},
          v4v_info: {}
        });
      }
    }

    return tracks;
  }

  /**
   * Extract tracks from value splits
   */
  private static extractTracksFromValueSplits(
    episodeData: MusicExtractionInput['episode_data'],
    minDuration: number,
    maxDuration: number
  ): Array<MusicExtractionOutput['music_tracks'][0]> {
    const tracks: Array<MusicExtractionOutput['music_tracks'][0]> = [];

    for (const valueSplit of episodeData.value_splits) {
      const duration = valueSplit.end_time - valueSplit.start_time;
      
      // Filter by duration
      if (duration < minDuration || duration > maxDuration) {
        continue;
      }

      // Extract artist and title from the value split name
      const { artist, title } = this.extractArtistAndTitle(valueSplit.name);
      
      tracks.push({
        id: this.generateTrackId(episodeData.guid, valueSplit.start_time),
        title: title || 'Unknown Track',
        artist: artist || valueSplit.name,
        duration,
        start_time: valueSplit.start_time,
        end_time: valueSplit.end_time,
        audio_url: episodeData.audio_url || '',
        source: 'value_split',
        metadata: {},
        v4v_info: {
          lightning_address: valueSplit.lightning_address,
          custom_key: valueSplit.custom_key,
          custom_value: valueSplit.custom_value
        }
      });
    }

    return tracks;
  }

  /**
   * Extract tracks from episode description
   */
  private static extractTracksFromDescription(
    episodeData: MusicExtractionInput['episode_data'],
    minDuration: number,
    maxDuration: number
  ): Array<MusicExtractionOutput['music_tracks'][0]> {
    const tracks: Array<MusicExtractionOutput['music_tracks'][0]> = [];

    // Look for music track patterns in the description
    const musicPatterns = [
      /(\d+:\d+)\s*-\s*(.+?)\s*by\s*(.+?)(?:\n|$)/gi,
      /Track:\s*(.+?)\s*-\s*(.+?)(?:\n|$)/gi,
      /Song:\s*(.+?)\s*by\s*(.+?)(?:\n|$)/gi,
      /(.+?)\s*by\s*(.+?)\s*\((\d+:\d+)\)/gi
    ];

    for (const pattern of musicPatterns) {
      let match;
      while ((match = pattern.exec(episodeData.description)) !== null) {
        const [, timeOrTitle, titleOrArtist, artistOrTime] = match;
        
        let title: string;
        let artist: string;
        let duration = 180; // Default 3 minutes

        if (pattern === musicPatterns[0]) {
          // Time - Title by Artist
          title = titleOrArtist.trim();
          artist = artistOrTime.trim();
          duration = this.parseTimeToSeconds(timeOrTitle);
        } else if (pattern === musicPatterns[1]) {
          // Track: Title - Artist
          title = titleOrArtist.trim();
          artist = artistOrTime.trim();
        } else if (pattern === musicPatterns[2]) {
          // Song: Title by Artist
          title = titleOrArtist.trim();
          artist = artistOrTime.trim();
        } else if (pattern === musicPatterns[3]) {
          // Title by Artist (Time)
          title = timeOrTitle.trim();
          artist = titleOrArtist.trim();
          duration = this.parseTimeToSeconds(artistOrTime);
        }

        // Filter by duration
        if (duration < minDuration || duration > maxDuration) {
          continue;
        }

        tracks.push({
          id: this.generateTrackId(episodeData.guid, Date.now()),
          title,
          artist,
          duration,
          start_time: 0, // Unknown start time from description
          end_time: duration,
          audio_url: episodeData.audio_url || '',
          source: 'description',
          metadata: {},
          v4v_info: {}
        });
      }
    }

    return tracks;
  }

  /**
   * Check if a chapter title looks like a music track
   */
  private static isMusicChapter(title: string): boolean {
    const musicKeywords = [
      'song', 'track', 'music', 'by', 'feat', 'featuring', 'ft', 'ft.',
      'artist', 'band', 'singer', 'musician', 'album', 'single'
    ];
    
    const lowerTitle = title.toLowerCase();
    return musicKeywords.some(keyword => lowerTitle.includes(keyword));
  }

  /**
   * Extract artist and title from a string
   */
  private static extractArtistAndTitle(text: string): { artist: string; title: string } {
    // Common patterns for artist - title or title by artist
    const patterns = [
      /^(.+?)\s*-\s*(.+)$/,  // Artist - Title
      /^(.+?)\s*by\s*(.+)$/, // Title by Artist
      /^(.+?)\s*feat\.?\s*(.+)$/, // Artist feat. Title
      /^(.+?)\s*ft\.?\s*(.+)$/    // Artist ft. Title
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const [, first, second] = match;
        // Determine which is artist and which is title based on context
        if (pattern === patterns[1]) {
          // Title by Artist
          return { title: first.trim(), artist: second.trim() };
        } else {
          // Artist - Title or Artist feat. Title
          return { artist: first.trim(), title: second.trim() };
        }
      }
    }

    // If no pattern matches, treat the whole string as title
    return { title: text.trim(), artist: 'Unknown Artist' };
  }

  /**
   * Deduplicate tracks based on title, artist, and time overlap
   */
  private static deduplicateTracks(tracks: Array<MusicExtractionOutput['music_tracks'][0]>): Array<MusicExtractionOutput['music_tracks'][0]> {
    const deduplicated: Array<MusicExtractionOutput['music_tracks'][0]> = [];
    
    for (const track of tracks) {
      const isDuplicate = deduplicated.some(existing => {
        // Check for exact match
        if (existing.title === track.title && existing.artist === track.artist) {
          return true;
        }
        
        // Check for time overlap
        const timeOverlap = !(track.end_time <= existing.start_time || track.start_time >= existing.end_time);
        if (timeOverlap && existing.title === track.title) {
          return true;
        }
        
        return false;
      });
      
      if (!isDuplicate) {
        deduplicated.push(track);
      }
    }
    
    return deduplicated;
  }

  /**
   * Enhance track metadata with additional information
   */
  private static async enhanceTrackMetadata(tracks: Array<MusicExtractionOutput['music_tracks'][0]>): Promise<Array<MusicExtractionOutput['music_tracks'][0]>> {
    // This would typically integrate with music metadata services
    // For now, we'll just add some basic enhancements
    return tracks.map(track => ({
      ...track,
      metadata: {
        ...track.metadata,
        genre: this.inferGenre(track.title, track.artist),
        year: new Date().getFullYear() // Default to current year
      }
    }));
  }

  /**
   * Infer genre from track title and artist
   */
  private static inferGenre(title: string, artist: string): string {
    const text = `${title} ${artist}`.toLowerCase();
    
    if (text.includes('rock') || text.includes('metal')) return 'Rock';
    if (text.includes('pop')) return 'Pop';
    if (text.includes('jazz')) return 'Jazz';
    if (text.includes('classical')) return 'Classical';
    if (text.includes('electronic') || text.includes('edm')) return 'Electronic';
    if (text.includes('hip') || text.includes('rap')) return 'Hip Hop';
    if (text.includes('country')) return 'Country';
    if (text.includes('blues')) return 'Blues';
    
    return 'Unknown';
  }

  /**
   * Parse time string to seconds
   */
  private static parseTimeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return 180; // Default 3 minutes
  }

  /**
   * Generate unique track ID
   */
  private static generateTrackId(episodeGuid: string, startTime: number): string {
    return `${episodeGuid}-${startTime}-${Date.now()}`;
  }

  /**
   * Extract music tracks from a feed URL using the existing parser
   */
  static async extractMusicTracksFromFeed(feedUrl: string): Promise<MusicTrackExtractionResult> {
    try {
      return await MusicTrackParser.extractMusicTracks(feedUrl);
    } catch (error) {
      throw new Error(`Failed to extract music tracks from feed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export default MusicExtractionSkill;
