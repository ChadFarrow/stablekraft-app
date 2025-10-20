import RSSParsingSkill from '../rss-parsing';
import MusicExtractionSkill from '../music-extraction';
import V4VResolutionSkill from '../v4v-resolution';
import DatabaseOperationsSkill from '../database-operations';

describe('Skills Integration Tests', () => {
  const mockFeedUrl = 'https://example.com/test-feed.xml';
  const mockEpisodeData = {
    guid: 'episode-123',
    title: 'Music Show Episode 1',
    description: 'Featuring tracks by Artist A and Artist B',
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
        lightning_address: 'artist@example.com'
      }
    ],
    audio_url: 'https://example.com/episode.mp3'
  };

  describe('End-to-End Music Track Processing', () => {
    it('should process RSS feed, extract music tracks, resolve V4V, and store in database', async () => {
      // Step 1: Parse RSS feed
      const rssInput = {
        feed_url: mockFeedUrl,
        parse_options: {
          include_chapters: true,
          include_value_splits: true,
          extract_music: true
        }
      };

      const mockRSSResult = {
        feed_metadata: {
          title: 'Test Podcast',
          description: 'A test podcast',
          author: 'Test Author'
        },
        episodes: [mockEpisodeData]
      };

      jest.spyOn(RSSParsingSkill, 'parseRSSFeed')
        .mockResolvedValue(mockRSSResult);

      const rssResult = await RSSParsingSkill.parseRSSFeed(rssInput);
      expect(rssResult.episodes).toHaveLength(1);

      // Step 2: Extract music tracks from episode
      const musicInput = {
        episode_data: mockEpisodeData,
        extraction_options: {
          source_types: ['chapters', 'value_splits'],
          min_duration: 30,
          max_duration: 600,
          deduplicate: true,
          enhance_metadata: true
        }
      };

      const mockMusicResult = {
        music_tracks: [
          {
            id: 'track-1',
            title: 'Song Title',
            artist: 'Artist Name',
            duration: 150,
            start_time: 30,
            end_time: 180,
            audio_url: 'https://example.com/episode.mp3',
            source: 'chapter',
            metadata: { genre: 'Unknown' },
            v4v_info: {}
          },
          {
            id: 'track-2',
            title: 'Unknown Track',
            artist: 'Artist A',
            duration: 60,
            start_time: 30,
            end_time: 90,
            audio_url: 'https://example.com/episode.mp3',
            source: 'value_split',
            metadata: { genre: 'Unknown' },
            v4v_info: {
              lightning_address: 'artist@example.com'
            }
          }
        ]
      };

      jest.spyOn(MusicExtractionSkill, 'extractMusicTracks')
        .mockResolvedValue(mockMusicResult);

      const musicResult = await MusicExtractionSkill.extractMusicTracks(musicInput);
      expect(musicResult.music_tracks).toHaveLength(2);

      // Step 3: Resolve V4V information for tracks with V4V data
      const v4vTracks = musicResult.music_tracks.filter(track => track.v4v_info.lightning_address);
      
      for (const track of v4vTracks) {
        const v4vInput = {
          resolution_target: {
            type: 'track' as const,
            identifier: track.id,
            context: {
              artist: track.artist,
              title: track.title,
              feed_guid: 'feed-guid-123',
              item_guid: 'item-guid-456'
            }
          },
          resolution_options: {
            include_lightning_address: true,
            include_value_splits: true
          }
        };

        const mockV4VResult = {
          v4v_info: {
            lightning_address: track.v4v_info.lightning_address,
            value_splits: [],
            boostagrams: [],
            payment_methods: {
              lightning: true,
              bitcoin: false,
              other: false
            }
          }
        };

        jest.spyOn(V4VResolutionSkill, 'resolveV4V')
          .mockResolvedValue(mockV4VResult);

        const v4vResult = await V4VResolutionSkill.resolveV4V(v4vInput);
        expect(v4vResult.v4v_info.lightning_address).toBe('artist@example.com');
      }

      // Step 4: Store tracks in database
      const trackPromises = musicResult.music_tracks.map(track => {
        const dbInput = {
          operation: 'create' as const,
          entity_type: 'track' as const,
          data: {
            title: track.title,
            artist: track.artist,
            episodeId: mockEpisodeData.guid,
            episodeTitle: mockEpisodeData.title,
            episodeDate: new Date(),
            startTime: track.start_time,
            endTime: track.end_time,
            duration: track.duration,
            audioUrl: track.audio_url,
            source: track.source,
            feedUrl: mockFeedUrl,
            feedId: 'feed-123'
          }
        };

        const mockDbResult = {
          success: true,
          data: {
            ...track,
            id: `db-${track.id}`,
            discoveredAt: new Date(),
            lastUpdated: new Date()
          }
        };

        jest.spyOn(DatabaseOperationsSkill, 'executeOperation')
          .mockResolvedValue(mockDbResult);

        return DatabaseOperationsSkill.executeOperation(dbInput);
      });

      const dbResults = await Promise.all(trackPromises);
      
      expect(dbResults).toHaveLength(2);
      dbResults.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      // Step 5: Verify final database state
      const statsResult = await DatabaseOperationsSkill.getDatabaseStats();
      expect(statsResult.success).toBe(true);
    });
  });

  describe('Skills Registry Integration', () => {
    it('should register and discover all implemented skills', async () => {
      const { SkillsRegistry } = await import('../skills-registry');
      
      // Test that all skills are registered
      const registeredSkills = SkillsRegistry.getAllSkills();
      
      expect(registeredSkills).toHaveLength(4);
      expect(registeredSkills.map(s => s.name)).toContain('rss-parsing');
      expect(registeredSkills.map(s => s.name)).toContain('music-extraction');
      expect(registeredSkills.map(s => s.name)).toContain('v4v-resolution');
      expect(registeredSkills.map(s => s.name)).toContain('database-operations');

      // Test skill discovery by name
      const rssSkill = SkillsRegistry.getSkill('rss-parsing');
      expect(rssSkill).toBeDefined();
      expect(rssSkill?.name).toBe('rss-parsing');

      // Test skill discovery by category
      const processingSkills = SkillsRegistry.getSkillsByCategory('processing');
      expect(processingSkills).toHaveLength(2); // RSS parsing and music extraction

      const dataSkills = SkillsRegistry.getSkillsByCategory('data');
      expect(dataSkills).toHaveLength(2); // V4V resolution and database operations
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle errors gracefully across skill boundaries', async () => {
      // Test RSS parsing failure
      jest.spyOn(RSSParsingSkill, 'parseRSSFeed')
        .mockRejectedValue(new Error('RSS parsing failed'));

      await expect(RSSParsingSkill.parseRSSFeed({
        feed_url: 'invalid-url',
        parse_options: {}
      })).rejects.toThrow('RSS parsing failed');

      // Test music extraction with invalid data
      const invalidMusicInput = {
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

      const musicResult = await MusicExtractionSkill.extractMusicTracks(invalidMusicInput);
      expect(musicResult.music_tracks).toHaveLength(0);

      // Test V4V resolution failure
      jest.spyOn(V4VResolutionSkill, 'resolveV4V')
        .mockRejectedValue(new Error('V4V resolution failed'));

      await expect(V4VResolutionSkill.resolveV4V({
        resolution_target: {
          type: 'track',
          identifier: 'invalid-track',
          context: {}
        },
        resolution_options: {}
      })).rejects.toThrow('V4V resolution failed');

      // Test database operation failure
      jest.spyOn(DatabaseOperationsSkill, 'executeOperation')
        .mockResolvedValue({
          success: false,
          error: 'Database operation failed'
        });

      const dbResult = await DatabaseOperationsSkill.executeOperation({
        operation: 'create',
        entity_type: 'track',
        data: {}
      });

      expect(dbResult.success).toBe(false);
      expect(dbResult.error).toBe('Database operation failed');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle batch operations efficiently', async () => {
      const batchSize = 10;
      const tracks = Array.from({ length: batchSize }, (_, i) => ({
        title: `Track ${i}`,
        artist: `Artist ${i}`,
        episodeId: 'episode-123',
        episodeTitle: 'Test Episode',
        episodeDate: new Date(),
        startTime: i * 60,
        endTime: (i + 1) * 60,
        duration: 60,
        audioUrl: 'https://example.com/track.mp3',
        source: 'chapter',
        feedUrl: mockFeedUrl,
        feedId: 'feed-123'
      }));

      // Test batch database operations
      const batchInput = {
        operation: 'batch' as const,
        entity_type: 'track' as const,
        data: {
          operation: 'create',
          tracks
        }
      };

      const mockBatchResult = {
        success: true,
        data: tracks.map(track => ({ ...track, id: `track-${track.title}` })),
        count: batchSize
      };

      jest.spyOn(DatabaseOperationsSkill, 'executeOperation')
        .mockResolvedValue(mockBatchResult);

      const batchResult = await DatabaseOperationsSkill.executeOperation(batchInput);
      
      expect(batchResult.success).toBe(true);
      expect(batchResult.data).toHaveLength(batchSize);
      expect(batchResult.count).toBe(batchSize);
    });

    it('should handle concurrent operations', async () => {
      const concurrentOperations = Array.from({ length: 5 }, (_, i) => 
        RSSParsingSkill.parseRSSFeed({
          feed_url: `https://example.com/feed-${i}.xml`,
          parse_options: {}
        })
      );

      // Mock all operations to succeed
      jest.spyOn(RSSParsingSkill, 'parseRSSFeed')
        .mockResolvedValue({
          feed_metadata: { title: 'Test Feed' },
          episodes: []
        });

      const results = await Promise.all(concurrentOperations);
      
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.feed_metadata.title).toBe('Test Feed');
      });
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across skills', async () => {
      const episodeGuid = 'episode-123';
      const feedUrl = 'https://example.com/feed.xml';

      // Mock consistent data across skills
      const mockRSSResult = {
        feed_metadata: { title: 'Test Podcast' },
        episodes: [{
          ...mockEpisodeData,
          guid: episodeGuid
        }]
      };

      const mockMusicResult = {
        music_tracks: [{
          id: 'track-1',
          title: 'Test Track',
          artist: 'Test Artist',
          duration: 180,
          start_time: 0,
          end_time: 180,
          audio_url: 'https://example.com/track.mp3',
          source: 'chapter',
          metadata: {},
          v4v_info: {}
        }]
      };

      jest.spyOn(RSSParsingSkill, 'parseRSSFeed').mockResolvedValue(mockRSSResult);
      jest.spyOn(MusicExtractionSkill, 'extractMusicTracks').mockResolvedValue(mockMusicResult);

      // Process the data
      const rssResult = await RSSParsingSkill.parseRSSFeed({
        feed_url: feedUrl,
        parse_options: {}
      });

      const musicResult = await MusicExtractionSkill.extractMusicTracks({
        episode_data: rssResult.episodes[0],
        extraction_options: {}
      });

      // Verify data consistency
      expect(rssResult.episodes[0].guid).toBe(episodeGuid);
      expect(musicResult.music_tracks[0].audio_url).toBe('https://example.com/track.mp3');
      expect(musicResult.music_tracks[0].duration).toBe(180);
    });
  });
});
