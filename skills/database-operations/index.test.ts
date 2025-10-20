import DatabaseOperationsSkill from './index';

describe('Database Operations Skill', () => {
  const mockTrackData = {
    title: 'Test Track',
    artist: 'Test Artist',
    episodeId: 'episode-123',
    episodeTitle: 'Test Episode',
    episodeDate: new Date(),
    startTime: 0,
    endTime: 180,
    duration: 180,
    audioUrl: 'https://example.com/track.mp3',
    source: 'chapter',
    feedUrl: 'https://example.com/feed.xml',
    feedId: 'feed-123'
  };

  describe('executeOperation', () => {
    it('should create a track', async () => {
      const input = {
        operation: 'create',
        entity_type: 'track',
        data: mockTrackData
      };

      // Mock the musicTrackDB.addMusicTrack method
      const mockTrack = { ...mockTrackData, id: 'track-123', discoveredAt: new Date(), lastUpdated: new Date() };
      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'addMusicTrack')
        .mockResolvedValue(mockTrack);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockTrack);
    });

    it('should read a track', async () => {
      const input = {
        operation: 'read',
        entity_type: 'track',
        filters: { id: 'track-123' }
      };

      const mockTrack = { ...mockTrackData, id: 'track-123' };
      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'getMusicTrack')
        .mockResolvedValue(mockTrack);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockTrack);
    });

    it('should update a track', async () => {
      const input = {
        operation: 'update',
        entity_type: 'track',
        filters: { id: 'track-123' },
        data: { title: 'Updated Track' }
      };

      const mockUpdatedTrack = { ...mockTrackData, id: 'track-123', title: 'Updated Track' };
      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'updateMusicTrack')
        .mockResolvedValue(mockUpdatedTrack);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedTrack);
    });

    it('should delete a track', async () => {
      const input = {
        operation: 'delete',
        entity_type: 'track',
        filters: { id: 'track-123' }
      };

      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'deleteMusicTrack')
        .mockResolvedValue(true);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
    });

    it('should search tracks', async () => {
      const input = {
        operation: 'search',
        entity_type: 'track',
        filters: { artist: 'Test Artist' },
        options: {
          pagination: { page: 1, page_size: 10 }
        }
      };

      const mockSearchResult = {
        tracks: [mockTrackData],
        total: 1,
        page: 1,
        pageSize: 10,
        filters: { artist: 'Test Artist' }
      };

      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'searchMusicTracks')
        .mockResolvedValue(mockSearchResult);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSearchResult.tracks);
      expect(result.count).toBe(1);
      expect(result.metadata?.total).toBe(1);
    });

    it('should handle batch operations', async () => {
      const input = {
        operation: 'batch',
        entity_type: 'track',
        data: {
          operation: 'create',
          tracks: [mockTrackData]
        }
      };

      const mockTrack = { ...mockTrackData, id: 'track-123', discoveredAt: new Date(), lastUpdated: new Date() };
      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'addMusicTrack')
        .mockResolvedValue(mockTrack);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      const input = {
        operation: 'create',
        entity_type: 'track',
        data: mockTrackData
      };

      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'addMusicTrack')
        .mockRejectedValue(new Error('Database error'));

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('playlist operations', () => {
    it('should create a playlist', async () => {
      const input = {
        operation: 'create',
        entity_type: 'playlist',
        data: {
          name: 'Test Playlist',
          description: 'A test playlist',
          createdBy: 'user-123',
          isPublic: false
        }
      };

      // Mock Prisma client
      const mockPrisma = {
        userPlaylist: {
          create: jest.fn().mockResolvedValue({
            id: 'playlist-123',
            name: 'Test Playlist',
            description: 'A test playlist',
            createdBy: 'user-123',
            isPublic: false
          })
        }
      };

      jest.spyOn(DatabaseOperationsSkill as any, 'getPrismaClient')
        .mockResolvedValue(mockPrisma);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Test Playlist');
    });

    it('should read a playlist', async () => {
      const input = {
        operation: 'read',
        entity_type: 'playlist',
        filters: { id: 'playlist-123' },
        options: { include_relations: true }
      };

      const mockPrisma = {
        userPlaylist: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'playlist-123',
            name: 'Test Playlist',
            PlaylistTrack: []
          })
        }
      };

      jest.spyOn(DatabaseOperationsSkill as any, 'getPrismaClient')
        .mockResolvedValue(mockPrisma);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Test Playlist');
    });

    it('should search playlists', async () => {
      const input = {
        operation: 'search',
        entity_type: 'playlist',
        filters: { createdBy: 'user-123' },
        options: {
          pagination: { page: 1, page_size: 10 }
        }
      };

      const mockPrisma = {
        userPlaylist: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'playlist-1', name: 'Playlist 1' },
            { id: 'playlist-2', name: 'Playlist 2' }
          ]),
          count: jest.fn().mockResolvedValue(2)
        }
      };

      jest.spyOn(DatabaseOperationsSkill as any, 'getPrismaClient')
        .mockResolvedValue(mockPrisma);

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.metadata?.total).toBe(2);
    });
  });

  describe('utility methods', () => {
    it('should get database statistics', async () => {
      const mockStats = {
        totalTracks: 100,
        totalEpisodes: 50,
        totalFeeds: 10,
        tracksWithV4V: 25,
        tracksBySource: { chapter: 50, 'value-split': 30, description: 20 },
        recentTracks: 5
      };

      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'getStatistics')
        .mockResolvedValue(mockStats);

      const result = await DatabaseOperationsSkill.getDatabaseStats();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockStats);
    });

    it('should clear database cache', () => {
      const clearCacheSpy = jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'clearCache');

      DatabaseOperationsSkill.clearCache();

      expect(clearCacheSpy).toHaveBeenCalled();
    });

    it('should export database', async () => {
      const mockData = { musicTracks: [], episodes: [], feeds: [] };
      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'exportDatabase')
        .mockResolvedValue(mockData);

      const result = await DatabaseOperationsSkill.exportDatabase();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockData);
    });

    it('should import database', async () => {
      const mockData = { musicTracks: [], episodes: [], feeds: [] };
      jest.spyOn(require('../../lib/music-track-database').musicTrackDB, 'importDatabase')
        .mockResolvedValue(undefined);

      const result = await DatabaseOperationsSkill.importDatabase(mockData);

      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle unsupported entity types', async () => {
      const input = {
        operation: 'create',
        entity_type: 'unsupported',
        data: {}
      };

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unsupported entity type: unsupported');
    });

    it('should handle unsupported operations', async () => {
      const input = {
        operation: 'unsupported',
        entity_type: 'track',
        data: {}
      };

      const result = await DatabaseOperationsSkill.executeOperation(input);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unsupported track operation: unsupported');
    });
  });
});
