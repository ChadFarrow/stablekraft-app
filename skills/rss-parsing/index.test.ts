import RSSParsingSkill from './index';

describe('RSS Parsing Skill', () => {
  const testFeedUrl = 'https://example.com/test-feed.xml';

  describe('parseRSSFeed', () => {
    it('should parse RSS feed with default options', async () => {
      const input = {
        feed_url: testFeedUrl,
        parse_options: {}
      };

      // Mock the RSSParser.parseAlbumFeed method
      const mockAlbum = {
        title: 'Test Podcast',
        description: 'A test podcast feed',
        artist: 'Test Artist',
        language: 'en',
        categories: ['Music'],
        coverArt: 'https://example.com/cover.jpg',
        releaseDate: '2024-01-01',
        tracks: [
          {
            title: 'Episode 1',
            duration: '30:00',
            url: 'https://example.com/episode1.mp3',
            musicTrack: true,
            artist: 'Test Artist',
            guid: 'episode-1',
            summary: 'First episode',
            startTime: 0,
            endTime: 1800
          }
        ]
      };

      // Mock the RSSParser
      jest.spyOn(require('../../lib/rss-parser').RSSParser, 'parseAlbumFeed')
        .mockResolvedValue(mockAlbum);

      const result = await RSSParsingSkill.parseRSSFeed(input);

      expect(result).toHaveProperty('feed_metadata');
      expect(result).toHaveProperty('episodes');
      expect(result.feed_metadata.title).toBe('Test Podcast');
      expect(result.episodes).toHaveLength(1);
      expect(result.episodes[0].title).toBe('Episode 1');
    });

    it('should handle parsing errors gracefully', async () => {
      const input = {
        feed_url: 'invalid-url',
        parse_options: {}
      };

      // Mock the RSSParser to throw an error
      jest.spyOn(require('../../lib/rss-parser').RSSParser, 'parseAlbumFeed')
        .mockRejectedValue(new Error('Invalid feed URL'));

      await expect(RSSParsingSkill.parseRSSFeed(input))
        .rejects.toThrow('RSS parsing failed: Invalid feed URL');
    });

    it('should extract chapters when include_chapters is true', async () => {
      const input = {
        feed_url: testFeedUrl,
        parse_options: {
          include_chapters: true
        }
      };

      const mockAlbum = {
        title: 'Test Podcast',
        description: 'A test podcast feed',
        artist: 'Test Artist',
        tracks: [
          {
            title: 'Episode 1',
            duration: '30:00',
            url: 'https://example.com/episode1.mp3',
            musicTrack: true,
            startTime: 0,
            endTime: 1800
          }
        ]
      };

      jest.spyOn(require('../../lib/rss-parser').RSSParser, 'parseAlbumFeed')
        .mockResolvedValue(mockAlbum);

      const result = await RSSParsingSkill.parseRSSFeed(input);

      expect(result.episodes[0].chapters).toHaveLength(1);
      expect(result.episodes[0].chapters[0].title).toBe('Episode 1');
    });

    it('should extract value splits when include_value_splits is true', async () => {
      const input = {
        feed_url: testFeedUrl,
        parse_options: {
          include_value_splits: true
        }
      };

      const mockAlbum = {
        title: 'Test Podcast',
        description: 'A test podcast feed',
        artist: 'Test Artist',
        tracks: [
          {
            title: 'Episode 1',
            duration: '30:00',
            url: 'https://example.com/episode1.mp3',
            musicTrack: true,
            v4vRecipient: 'artist@example.com',
            startTime: 0,
            endTime: 1800
          }
        ]
      };

      jest.spyOn(require('../../lib/rss-parser').RSSParser, 'parseAlbumFeed')
        .mockResolvedValue(mockAlbum);

      const result = await RSSParsingSkill.parseRSSFeed(input);

      expect(result.episodes[0].value_splits).toHaveLength(1);
      expect(result.episodes[0].value_splits[0].lightning_address).toBe('artist@example.com');
    });

    it('should extract music tracks when extract_music is true', async () => {
      const input = {
        feed_url: testFeedUrl,
        parse_options: {
          extract_music: true
        }
      };

      const mockAlbum = {
        title: 'Test Podcast',
        description: 'A test podcast feed',
        artist: 'Test Artist',
        tracks: [
          {
            title: 'Episode 1',
            duration: '30:00',
            url: 'https://example.com/episode1.mp3',
            musicTrack: true,
            artist: 'Test Artist',
            startTime: 0,
            endTime: 1800
          }
        ]
      };

      jest.spyOn(require('../../lib/rss-parser').RSSParser, 'parseAlbumFeed')
        .mockResolvedValue(mockAlbum);

      const result = await RSSParsingSkill.parseRSSFeed(input);

      expect(result.episodes[0].music_tracks).toHaveLength(1);
      expect(result.episodes[0].music_tracks[0].title).toBe('Episode 1');
      expect(result.episodes[0].music_tracks[0].source).toBe('rss_track');
    });
  });

  describe('validateFeedUrl', () => {
    it('should validate HTTP URLs', () => {
      expect(RSSParsingSkill.validateFeedUrl('http://example.com/feed.xml')).toBe(true);
      expect(RSSParsingSkill.validateFeedUrl('https://example.com/feed.xml')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(RSSParsingSkill.validateFeedUrl('invalid-url')).toBe(false);
      expect(RSSParsingSkill.validateFeedUrl('ftp://example.com/feed.xml')).toBe(false);
    });
  });

  describe('getFeedInfo', () => {
    it('should return feed information', async () => {
      const mockAlbum = {
        title: 'Test Podcast',
        description: 'A test podcast feed',
        releaseDate: '2024-01-01',
        tracks: [
          { title: 'Episode 1' },
          { title: 'Episode 2' }
        ]
      };

      jest.spyOn(require('../../lib/rss-parser').RSSParser, 'parseAlbumFeed')
        .mockResolvedValue(mockAlbum);

      const result = await RSSParsingSkill.getFeedInfo(testFeedUrl);

      expect(result.title).toBe('Test Podcast');
      expect(result.description).toBe('A test podcast feed');
      expect(result.last_build_date).toBe('2024-01-01');
      expect(result.item_count).toBe(2);
    });
  });
});
