import { PrismaClient } from '@prisma/client';

export interface DatabaseOperationInput {
  operation: 'create' | 'read' | 'update' | 'delete' | 'search' | 'batch';
  entity_type: 'track' | 'episode' | 'feed' | 'playlist' | 'user';
  data?: any;
  filters?: any;
  options?: {
    include_relations?: boolean;
    pagination?: {
      page: number;
      page_size: number;
    };
    sorting?: {
      field: string;
      direction: 'asc' | 'desc';
    };
  };
}

export interface DatabaseOperationOutput {
  success: boolean;
  data?: any;
  count?: number;
  error?: string;
  metadata?: {
    page?: number;
    page_size?: number;
    total?: number;
    has_more?: boolean;
  };
}

export class DatabaseOperationsSkill {
  private static prisma: PrismaClient | null = null;

  /**
   * Execute database operations for music tracks, episodes, feeds, and playlists
   */
  static async executeOperation(input: DatabaseOperationInput): Promise<DatabaseOperationOutput> {
    const { operation, entity_type, data, filters, options = {} } = input;

    try {
      switch (entity_type) {
        case 'track':
          return await this.handleTrackOperation(operation, data, filters, options);
        case 'episode':
          return await this.handleEpisodeOperation(operation, data, filters, options);
        case 'feed':
          return await this.handleFeedOperation(operation, data, filters, options);
        case 'playlist':
          return await this.handlePlaylistOperation(operation, data, filters, options);
        case 'user':
          return await this.handleUserOperation(operation, data, filters, options);
        default:
          throw new Error(`Unsupported entity type: ${entity_type}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle track operations
   */
  private static async handleTrackOperation(
    operation: string,
    data: any,
    filters: any,
    options: any
  ): Promise<DatabaseOperationOutput> {
    switch (operation) {
      case 'create':
        return await this.createTrack(data);
      case 'read':
        return await this.readTrack(filters, options);
      case 'update':
        return await this.updateTrack(filters.id, data);
      case 'delete':
        return await this.deleteTrack(filters.id);
      case 'search':
        return await this.searchTracks(filters, options);
      case 'batch':
        return await this.batchTrackOperation(data, options);
      default:
        throw new Error(`Unsupported track operation: ${operation}`);
    }
  }

  /**
   * Handle episode operations
   */
  private static async handleEpisodeOperation(
    operation: string,
    data: any,
    filters: any,
    options: any
  ): Promise<DatabaseOperationOutput> {
    switch (operation) {
      case 'create':
        return await this.createEpisode(data);
      case 'read':
        return await this.readEpisode(filters, options);
      case 'update':
        return await this.updateEpisode(filters.id, data);
      case 'delete':
        return await this.deleteEpisode(filters.id);
      case 'search':
        return await this.searchEpisodes(filters, options);
      default:
        throw new Error(`Unsupported episode operation: ${operation}`);
    }
  }

  /**
   * Handle feed operations
   */
  private static async handleFeedOperation(
    operation: string,
    data: any,
    filters: any,
    options: any
  ): Promise<DatabaseOperationOutput> {
    switch (operation) {
      case 'create':
        return await this.createFeed(data);
      case 'read':
        return await this.readFeed(filters, options);
      case 'update':
        return await this.updateFeed(filters.id, data);
      case 'delete':
        return await this.deleteFeed(filters.id);
      case 'search':
        return await this.searchFeeds(filters, options);
      default:
        throw new Error(`Unsupported feed operation: ${operation}`);
    }
  }

  /**
   * Handle playlist operations
   */
  private static async handlePlaylistOperation(
    operation: string,
    data: any,
    filters: any,
    options: any
  ): Promise<DatabaseOperationOutput> {
    switch (operation) {
      case 'create':
        return await this.createPlaylist(data);
      case 'read':
        return await this.readPlaylist(filters, options);
      case 'update':
        return await this.updatePlaylist(filters.id, data);
      case 'delete':
        return await this.deletePlaylist(filters.id);
      case 'search':
        return await this.searchPlaylists(filters, options);
      default:
        throw new Error(`Unsupported playlist operation: ${operation}`);
    }
  }

  /**
   * Handle user operations
   */
  private static async handleUserOperation(
    operation: string,
    data: any,
    filters: any,
    options: any
  ): Promise<DatabaseOperationOutput> {
    switch (operation) {
      case 'create':
        return await this.createUser(data);
      case 'read':
        return await this.readUser(filters, options);
      case 'update':
        return await this.updateUser(filters.id, data);
      case 'delete':
        return await this.deleteUser(filters.id);
      case 'search':
        return await this.searchUsers(filters, options);
      default:
        throw new Error(`Unsupported user operation: ${operation}`);
    }
  }

  // ============================================================================
  // TRACK OPERATIONS
  // ============================================================================

  private static async createTrack(data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      
      // Find or create feed
      let feed = await prisma.feed.findFirst({
        where: { originalUrl: data.feedUrl || 'unknown' }
      });
      
      if (!feed && data.feedUrl) {
        feed = await prisma.feed.create({
          data: {
            id: data.feedId || `feed-${Date.now()}`,
            title: data.feedTitle || 'Imported Feed',
            originalUrl: data.feedUrl,
            type: 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });
      }
      
      if (!feed) {
        throw new Error('Feed is required but not found');
      }

      const track = await prisma.track.create({
        data: {
          id: data.id || `track-${Date.now()}-${Math.random()}`,
          feedId: feed.id,
          title: data.title,
          artist: data.artist || null,
          album: data.album || null,
          audioUrl: data.audioUrl || '',
          startTime: data.startTime || null,
          endTime: data.endTime || null,
          duration: data.duration ? Math.round(data.duration) : null,
          image: data.image || null,
          description: data.description || null,
          guid: data.episodeId || data.guid || null,
          publishedAt: data.episodeDate ? new Date(data.episodeDate) : null,
          v4vValue: data.valueForValue || null,
          updatedAt: new Date()
        }
      });
      
      return {
        success: true,
        data: track
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create track'
      };
    }
  }

  private static async readTrack(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const track = await prisma.track.findUnique({
        where: { id: filters.id },
        include: {
          Feed: {
            select: {
              id: true,
              title: true,
              artist: true,
              type: true,
              originalUrl: true
            }
          }
        }
      });
      
      if (!track) {
        return {
          success: false,
          error: 'Track not found'
        };
      }
      
      return {
        success: true,
        data: track
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read track'
      };
    }
  }

  private static async updateTrack(id: string, data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const track = await prisma.track.update({
        where: { id },
        data: {
          title: data.title,
          artist: data.artist,
          album: data.album,
          audioUrl: data.audioUrl,
          startTime: data.startTime,
          endTime: data.endTime,
          duration: data.duration ? Math.round(data.duration) : undefined,
          image: data.image,
          description: data.description,
          guid: data.episodeId || data.guid,
          publishedAt: data.episodeDate ? new Date(data.episodeDate) : undefined,
          v4vValue: data.valueForValue
        }
      });
      return {
        success: true,
        data: track
      };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        return {
          success: false,
          error: 'Track not found'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update track'
      };
    }
  }

  private static async deleteTrack(id: string): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      await prisma.track.delete({
        where: { id }
      });
      return {
        success: true
      };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        return {
          success: false,
          error: 'Track not found'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete track'
      };
    }
  }

  private static async searchTracks(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const page = options.pagination?.page || 1;
      const pageSize = options.pagination?.page_size || 20;
      const skip = (page - 1) * pageSize;
      
      // Build Prisma where clause
      const where: any = {};
      
      if (filters.artist) {
        where.artist = { contains: filters.artist, mode: 'insensitive' };
      }
      if (filters.title) {
        where.title = { contains: filters.title, mode: 'insensitive' };
      }
      if (filters.feedId) {
        where.feedId = filters.feedId;
      }
      if (filters.episodeId) {
        where.guid = filters.episodeId;
      }
      if (filters.hasV4VData) {
        where.v4vValue = { not: null };
      }
      
      const [tracks, total] = await Promise.all([
        prisma.track.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { publishedAt: 'desc' },
          include: {
            Feed: {
              select: {
                id: true,
                title: true,
                artist: true,
                type: true
              }
            }
          }
        }),
        prisma.track.count({ where })
      ]);
      
      return {
        success: true,
        data: tracks,
        count: total,
        metadata: {
          page,
          page_size: pageSize,
          total,
          has_more: (page * pageSize) < total
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search tracks'
      };
    }
  }

  private static async batchTrackOperation(data: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const { operation, tracks } = data;
      const results = [];

      for (const track of tracks) {
        try {
          let result;
          switch (operation) {
            case 'create':
              result = await this.createTrack(track);
              if (result.success) {
                results.push(result.data);
              }
              break;
            case 'update':
              result = await this.updateTrack(track.id, track);
              if (result.success) {
                results.push(result.data);
              }
              break;
            case 'delete':
              result = await this.deleteTrack(track.id);
              if (result.success) {
                results.push({ id: track.id, deleted: true });
              }
              break;
            default:
              throw new Error(`Unsupported batch operation: ${operation}`);
          }
        } catch (error) {
          // Continue with other tracks even if one fails
          console.error('Batch operation failed for track:', error);
        }
      }

      return {
        success: true,
        data: results,
        count: results.length
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute batch operation'
      };
    }
  }

  // ============================================================================
  // EPISODE OPERATIONS
  // ============================================================================

  private static async createEpisode(data: any): Promise<DatabaseOperationOutput> {
    try {
      // Episodes are represented as tracks in Prisma schema
      const prisma = await this.getPrismaClient();
      
      // Find or create feed
      let feed;
      if (data.feedId) {
        feed = await prisma.feed.findUnique({ where: { id: data.feedId } });
      } else if (data.feedUrl) {
        feed = await prisma.feed.findFirst({ where: { originalUrl: data.feedUrl } });
      }
      
      if (!feed && data.feedUrl) {
        // Create feed if it doesn't exist
        feed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}`,
            title: data.feedTitle || 'Untitled Feed',
            originalUrl: data.feedUrl,
            type: 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });
      }
      
      if (!feed) {
        return {
          success: false,
          error: 'Feed is required for episode creation'
        };
      }
      
      const track = await prisma.track.create({
        data: {
          id: data.id || `track-${Date.now()}-${Math.random()}`,
          feedId: feed.id,
          guid: data.guid || data.episodeId || null,
          title: data.title || data.episodeTitle || 'Untitled Episode',
          artist: data.artist || null,
          album: data.album || null,
          audioUrl: data.audioUrl || '',
          startTime: data.startTime || null,
          endTime: data.endTime || null,
          duration: data.duration ? Math.round(data.duration) : null,
          image: data.image || null,
          description: data.description || null,
          publishedAt: data.publishedAt || data.episodeDate ? new Date(data.publishedAt || data.episodeDate) : new Date(),
          v4vValue: data.v4vValue || data.valueForValue || null,
          updatedAt: new Date()
        }
      });
      
      return {
        success: true,
        data: track
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create episode'
      };
    }
  }

  private static async readEpisode(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      let tracks: any[];
      
      if (filters.guid) {
        // Find tracks by guid (which represents episode ID)
        tracks = await prisma.track.findMany({
          where: { guid: filters.guid },
          include: {
            Feed: {
              select: {
                id: true,
                title: true,
                artist: true,
                type: true
              }
            }
          }
        });
      } else if (filters.id) {
        // Find track by ID
        const track = await prisma.track.findUnique({
          where: { id: filters.id },
          include: {
            Feed: {
              select: {
                id: true,
                title: true,
                artist: true,
                type: true
              }
            }
          }
        });
        tracks = track ? [track] : [];
      } else {
        tracks = [];
      }
      
      // Return first track as episode representation
      const episode = tracks[0] || null;
      
      if (!episode) {
        return {
          success: false,
          error: 'Episode not found'
        };
      }
      
      return {
        success: true,
        data: episode
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read episode'
      };
    }
  }

  private static async updateEpisode(id: string, data: any): Promise<DatabaseOperationOutput> {
    try {
      // Episodes are represented as tracks in Prisma schema
      const prisma = await this.getPrismaClient();
      const track = await prisma.track.update({
        where: { id },
        data: {
          title: data.title,
          artist: data.artist,
          album: data.album,
          audioUrl: data.audioUrl,
          startTime: data.startTime,
          endTime: data.endTime,
          duration: data.duration ? Math.round(data.duration) : undefined,
          image: data.image,
          description: data.description,
          guid: data.guid || data.episodeId,
          publishedAt: data.publishedAt || data.episodeDate ? new Date(data.publishedAt || data.episodeDate) : undefined,
          v4vValue: data.v4vValue || data.valueForValue,
          updatedAt: new Date()
        }
      });
      return {
        success: true,
        data: track
      };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        return {
          success: false,
          error: 'Episode not found'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update episode'
      };
    }
  }

  private static async deleteEpisode(id: string): Promise<DatabaseOperationOutput> {
    try {
      // Episodes are represented as tracks in Prisma schema
      const prisma = await this.getPrismaClient();
      await prisma.track.delete({
        where: { id }
      });
      return {
        success: true
      };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        return {
          success: false,
          error: 'Episode not found'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete episode'
      };
    }
  }

  private static async searchEpisodes(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      // Episodes are represented as tracks in Prisma schema
      const prisma = await this.getPrismaClient();
      const page = options.pagination?.page || 1;
      const pageSize = options.pagination?.page_size || 20;
      const skip = (page - 1) * pageSize;
      
      // Build Prisma where clause
      const where: any = {};
      
      if (filters.guid) {
        where.guid = { contains: filters.guid, mode: 'insensitive' };
      }
      if (filters.title) {
        where.title = { contains: filters.title, mode: 'insensitive' };
      }
      if (filters.artist) {
        where.artist = { contains: filters.artist, mode: 'insensitive' };
      }
      if (filters.feedId) {
        where.feedId = filters.feedId;
      }
      
      // Build orderBy
      const orderBy: any = {};
      const sortField = options.sorting?.field || 'publishedAt';
      const sortDirection = options.sorting?.direction || 'desc';
      orderBy[sortField] = sortDirection;
      
      const [episodes, total] = await Promise.all([
        prisma.track.findMany({
          where,
          skip,
          take: pageSize,
          orderBy,
          include: {
            Feed: {
              select: {
                id: true,
                title: true,
                artist: true,
                type: true,
                originalUrl: true
              }
            }
          }
        }),
        prisma.track.count({ where })
      ]);
      
      return {
        success: true,
        data: episodes,
        count: episodes.length,
        metadata: {
          page,
          page_size: pageSize,
          total,
          has_more: skip + pageSize < total
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search episodes'
      };
    }
  }

  // ============================================================================
  // FEED OPERATIONS
  // ============================================================================

  private static async createFeed(data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const feed = await prisma.feed.create({
        data: {
          id: data.id || `feed-${Date.now()}`,
          title: data.title || 'Untitled Feed',
          description: data.description || null,
          originalUrl: data.feedUrl || data.originalUrl || '',
          cdnUrl: data.cdnUrl || null,
          type: data.type || 'album',
          artist: data.artist || null,
          image: data.image || null,
          language: data.language || null,
          category: data.category || null,
          explicit: data.explicit || false,
          priority: data.priority || 'normal',
          status: data.status || 'active',
          v4vRecipient: data.v4vRecipient || null,
          v4vValue: data.v4vValue || null,
          updatedAt: new Date()
        }
      });
      return {
        success: true,
        data: feed
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create feed'
      };
    }
  }

  private static async readFeed(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      let feed;
      
      if (filters.id) {
        feed = await prisma.feed.findUnique({
          where: { id: filters.id },
          include: options.include_relations ? {
            Track: true
          } : undefined
        });
      } else if (filters.originalUrl) {
        feed = await prisma.feed.findFirst({
          where: { originalUrl: filters.originalUrl },
          include: options.include_relations ? {
            Track: true
          } : undefined
        });
      }
      
      if (!feed) {
        return {
          success: false,
          error: 'Feed not found'
        };
      }
      
      return {
        success: true,
        data: feed
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read feed'
      };
    }
  }

  private static async updateFeed(id: string, data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const feed = await prisma.feed.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          cdnUrl: data.cdnUrl,
          type: data.type,
          artist: data.artist,
          image: data.image,
          language: data.language,
          category: data.category,
          explicit: data.explicit,
          priority: data.priority,
          status: data.status,
          v4vRecipient: data.v4vRecipient,
          v4vValue: data.v4vValue,
          updatedAt: new Date()
        }
      });
      return {
        success: true,
        data: feed
      };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        return {
          success: false,
          error: 'Feed not found'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update feed'
      };
    }
  }

  private static async deleteFeed(id: string): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      await prisma.feed.delete({
        where: { id }
      });
      return {
        success: true
      };
    } catch (error) {
      if ((error as any).code === 'P2025') {
        return {
          success: false,
          error: 'Feed not found'
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete feed'
      };
    }
  }

  private static async searchFeeds(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const page = options.pagination?.page || 1;
      const pageSize = options.pagination?.page_size || 20;
      const skip = (page - 1) * pageSize;
      
      // Build Prisma where clause
      const where: any = {};
      
      if (filters.title) {
        where.title = { contains: filters.title, mode: 'insensitive' };
      }
      if (filters.artist) {
        where.artist = { contains: filters.artist, mode: 'insensitive' };
      }
      if (filters.type) {
        where.type = filters.type;
      }
      if (filters.status) {
        where.status = filters.status;
      }
      if (filters.originalUrl) {
        where.originalUrl = { contains: filters.originalUrl, mode: 'insensitive' };
      }
      
      // Build orderBy
      const orderBy: any = {};
      const sortField = options.sorting?.field || 'updatedAt';
      const sortDirection = options.sorting?.direction || 'desc';
      orderBy[sortField] = sortDirection;
      
      const [feeds, total] = await Promise.all([
        prisma.feed.findMany({
          where,
          skip,
          take: pageSize,
          orderBy,
          include: options.include_relations ? {
            _count: {
              select: { Track: true }
            }
          } : undefined
        }),
        prisma.feed.count({ where })
      ]);
      
      return {
        success: true,
        data: feeds,
        count: feeds.length,
        metadata: {
          page,
          page_size: pageSize,
          total,
          has_more: skip + pageSize < total
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search feeds'
      };
    }
  }

  // ============================================================================
  // PLAYLIST OPERATIONS (Prisma-based)
  // ============================================================================

  private static async createPlaylist(data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const playlist = await prisma.userPlaylist.create({
        data: {
          id: this.generateId(),
          name: data.name,
          description: data.description,
          isPublic: data.isPublic || false,
          createdBy: data.createdBy,
          image: data.image,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      return {
        success: true,
        data: playlist
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create playlist'
      };
    }
  }

  private static async readPlaylist(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const playlist = await prisma.userPlaylist.findUnique({
        where: { id: filters.id },
        include: options.include_relations ? {
          PlaylistTrack: {
            include: {
              UserPlaylist: true
            }
          }
        } : undefined
      });

      return {
        success: true,
        data: playlist
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read playlist'
      };
    }
  }

  private static async updatePlaylist(id: string, data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const playlist = await prisma.userPlaylist.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          isPublic: data.isPublic,
          image: data.image
        }
      });

      return {
        success: true,
        data: playlist
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update playlist'
      };
    }
  }

  private static async deletePlaylist(id: string): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      await prisma.userPlaylist.delete({
        where: { id }
      });

      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete playlist'
      };
    }
  }

  private static async searchPlaylists(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const page = options.pagination?.page || 1;
      const pageSize = options.pagination?.page_size || 20;
      const skip = (page - 1) * pageSize;

      const where: any = {};
      if (filters.createdBy) {
        where.createdBy = filters.createdBy;
      }
      if (filters.isPublic !== undefined) {
        where.isPublic = filters.isPublic;
      }
      if (filters.name) {
        where.name = {
          contains: filters.name,
          mode: 'insensitive'
        };
      }

      const [playlists, total] = await Promise.all([
        prisma.userPlaylist.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: options.sorting ? {
            [options.sorting.field]: options.sorting.direction
          } : {
            createdAt: 'desc'
          },
          include: options.include_relations ? {
            PlaylistTrack: true
          } : undefined
        }),
        prisma.userPlaylist.count({ where })
      ]);

      return {
        success: true,
        data: playlists,
        count: total,
        metadata: {
          page,
          page_size: pageSize,
          total,
          has_more: (page * pageSize) < total
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search playlists'
      };
    }
  }

  // ============================================================================
  // USER OPERATIONS (Prisma-based)
  // ============================================================================

  private static async createUser(data: any): Promise<DatabaseOperationOutput> {
    try {
      // Note: User model not defined in Prisma schema, would need to be added
      return {
        success: false,
        error: 'User operations not implemented - User model not defined'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create user'
      };
    }
  }

  private static async readUser(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      return {
        success: false,
        error: 'User operations not implemented - User model not defined'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read user'
      };
    }
  }

  private static async updateUser(id: string, data: any): Promise<DatabaseOperationOutput> {
    try {
      return {
        success: false,
        error: 'User operations not implemented - User model not defined'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update user'
      };
    }
  }

  private static async deleteUser(id: string): Promise<DatabaseOperationOutput> {
    try {
      return {
        success: false,
        error: 'User operations not implemented - User model not defined'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete user'
      };
    }
  }

  private static async searchUsers(filters: any, options: any): Promise<DatabaseOperationOutput> {
    try {
      return {
        success: false,
        error: 'User operations not implemented - User model not defined'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search users'
      };
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  private static async getPrismaClient(): Promise<PrismaClient> {
    if (!this.prisma) {
      this.prisma = new PrismaClient();
    }
    return this.prisma;
  }

  private static generateId(): string {
    return `id-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Get database statistics
   */
  static async getDatabaseStats(): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      const [totalTracks, totalFeeds] = await Promise.all([
        prisma.track.count(),
        prisma.feed.count()
      ]);
      
      const stats = {
        totalTracks,
        totalFeeds,
        totalEpisodes: totalTracks // Episodes concept doesn't exist in Prisma, use track count
      };
      
      return {
        success: true,
        data: stats
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get database statistics'
      };
    }
  }

  /**
   * Clear database cache
   */
  static clearCache(): void {
    // Prisma doesn't have a file-based cache to clear
    // This is kept for backward compatibility but does nothing
  }

  /**
   * Export database
   */
  static async exportDatabase(): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      
      // Export all data from Prisma
      const [tracks, feeds] = await Promise.all([
        prisma.track.findMany({
          include: {
            Feed: true
          }
        }),
        prisma.feed.findMany()
      ]);
      
      const data = {
        tracks,
        feeds,
        exportedAt: new Date().toISOString()
      };
      
      return {
        success: true,
        data
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export database'
      };
    }
  }

  /**
   * Import database
   */
  static async importDatabase(data: any): Promise<DatabaseOperationOutput> {
    try {
      const prisma = await this.getPrismaClient();
      
      // Import feeds first (tracks depend on feeds)
      if (data.feeds && Array.isArray(data.feeds)) {
        for (const feedData of data.feeds) {
          try {
            await prisma.feed.upsert({
              where: { id: feedData.id },
              update: feedData,
              create: feedData
            });
          } catch (error) {
            console.error('Failed to import feed:', error);
          }
        }
      }
      
      // Import tracks
      if (data.tracks && Array.isArray(data.tracks)) {
        for (const trackData of data.tracks) {
          try {
            await prisma.track.upsert({
              where: { id: trackData.id },
              update: trackData,
              create: trackData
            });
          } catch (error) {
            console.error('Failed to import track:', error);
          }
        }
      }
      
      return {
        success: true
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import database'
      };
    }
  }
}

export default DatabaseOperationsSkill;
