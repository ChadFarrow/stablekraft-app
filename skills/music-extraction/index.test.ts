import MusicExtractionSkill from './index';

describe('Music Extraction Skill', () => {
  const mockEpisodeData = {
    guid: 'episode-123',
    title: 'Music Show Episode 1',
    description: 'Featuring tracks by Artist A and Artist B. Track: Song Title - Artist (3:45)',
    chapters: [
      { title: 'Intro', start_time: 0, end_time: 30 },
      { title: 'Song Title - Artist Name', start_time: 30, end_time: 180 },
      { title: 'Another Track by Different Artist', start_time: 180, end_time: 300 }
    ],
    value_splits: [
      { 
        name: 'Artist A', 
        start_time: 30, 
        end_time: 90, 
        lightning_address: 'artist@example.com',
        custom_key: 'custom_key',
        custom_value: 'custom_value'
      }
    ],
    audio_url: 'https://example.com/episode.mp3'
  };

  describe('extractMusicTracks', () => {
    it('should extract music tracks from chapters', async () => {
      const input = {
        episode_data: mockEpisodeData,
        extraction_options: {
          source_types: ['chapters'],
          min_duration: 30,
          max_duration: 600
        }
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      expect(result.music_tracks).toHaveLength(2); // Two music chapters
      expect(result.music_tracks[0].source).toBe('chapter');
      expect(result.music_tracks[0].title).toBe('Song Title');
      expect(result.music_tracks[0].artist).toBe('Artist Name');
    });

    it('should extract music tracks from value splits', async () => {
      const input = {
        episode_data: mockEpisodeData,
        extraction_options: {
          source_types: ['value_splits'],
          min_duration: 30,
          max_duration: 600
        }
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      expect(result.music_tracks).toHaveLength(1);
      expect(result.music_tracks[0].source).toBe('value_split');
      expect(result.music_tracks[0].title).toBe('Unknown Track');
      expect(result.music_tracks[0].artist).toBe('Artist A');
      expect(result.music_tracks[0].v4v_info.lightning_address).toBe('artist@example.com');
    });

    it('should extract music tracks from description', async () => {
      const input = {
        episode_data: mockEpisodeData,
        extraction_options: {
          source_types: ['description'],
          min_duration: 30,
          max_duration: 600
        }
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      expect(result.music_tracks.length).toBeGreaterThan(0);
      expect(result.music_tracks[0].source).toBe('description');
    });

    it('should filter tracks by duration', async () => {
      const input = {
        episode_data: mockEpisodeData,
        extraction_options: {
          source_types: ['chapters'],
          min_duration: 100, // Only tracks longer than 100 seconds
          max_duration: 200
        }
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      // Should only include tracks between 100-200 seconds
      result.music_tracks.forEach(track => {
        expect(track.duration).toBeGreaterThanOrEqual(100);
        expect(track.duration).toBeLessThanOrEqual(200);
      });
    });

    it('should deduplicate tracks when requested', async () => {
      const input = {
        episode_data: {
          ...mockEpisodeData,
          chapters: [
            { title: 'Song Title - Artist Name', start_time: 30, end_time: 180 },
            { title: 'Song Title - Artist Name', start_time: 30, end_time: 180 } // Duplicate
          ]
        },
        extraction_options: {
          source_types: ['chapters'],
          deduplicate: true
        }
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      expect(result.music_tracks).toHaveLength(1); // Duplicate removed
    });

    it('should enhance metadata when requested', async () => {
      const input = {
        episode_data: mockEpisodeData,
        extraction_options: {
          source_types: ['chapters'],
          enhance_metadata: true
        }
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      expect(result.music_tracks[0].metadata).toHaveProperty('genre');
      expect(result.music_tracks[0].metadata).toHaveProperty('year');
    });

    it('should handle extraction errors gracefully', async () => {
      const input = {
        episode_data: {
          guid: 'invalid',
          title: '',
          description: '',
          chapters: [],
          value_splits: [],
          audio_url: ''
        },
        extraction_options: {}
      };

      const result = await MusicExtractionSkill.extractMusicTracks(input);

      expect(result.music_tracks).toHaveLength(0);
    });
  });

  describe('extractMusicTracksFromFeed', () => {
    it('should use existing MusicTrackParser for feed extraction', async () => {
      const mockResult = {
        tracks: [],
        relatedFeeds: [],
        extractionStats: {
          totalTracks: 0,
          tracksFromChapters: 0,
          tracksFromValueSplits: 0,
          tracksFromV4VData: 0,
          tracksFromDescription: 0,
          relatedFeedsFound: 0,
          extractionTime: 100
        }
      };

      // Mock the MusicTrackParser
      jest.spyOn(require('../../lib/music-track-parser').MusicTrackParser, 'extractMusicTracks')
        .mockResolvedValue(mockResult);

      const result = await MusicExtractionSkill.extractMusicTracksFromFeed('https://example.com/feed.xml');

      expect(result).toEqual(mockResult);
    });

    it('should handle feed extraction errors', async () => {
      jest.spyOn(require('../../lib/music-track-parser').MusicTrackParser, 'extractMusicTracks')
        .mockRejectedValue(new Error('Feed parsing failed'));

      await expect(MusicExtractionSkill.extractMusicTracksFromFeed('invalid-url'))
        .rejects.toThrow('Failed to extract music tracks from feed: Feed parsing failed');
    });
  });

  describe('utility methods', () => {
    it('should identify music chapters correctly', () => {
      expect(MusicExtractionSkill['isMusicChapter']('Song Title - Artist')).toBe(true);
      expect(MusicExtractionSkill['isMusicChapter']('Track by Musician')).toBe(true);
      expect(MusicExtractionSkill['isMusicChapter']('Introduction')).toBe(false);
    });

    it('should extract artist and title correctly', () => {
      const result1 = MusicExtractionSkill['extractArtistAndTitle']('Artist Name - Song Title');
      expect(result1.artist).toBe('Artist Name');
      expect(result1.title).toBe('Song Title');

      const result2 = MusicExtractionSkill['extractArtistAndTitle']('Song Title by Artist Name');
      expect(result2.title).toBe('Song Title');
      expect(result2.artist).toBe('Artist Name');
    });

    it('should parse time strings correctly', () => {
      expect(MusicExtractionSkill['parseTimeToSeconds']('3:45')).toBe(225);
      expect(MusicExtractionSkill['parseTimeToSeconds']('1:30:45')).toBe(5445);
    });
  });
});
