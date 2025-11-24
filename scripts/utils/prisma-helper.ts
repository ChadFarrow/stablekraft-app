/**
 * Prisma Database Helper for Scripts
 * 
 * This utility provides helper functions for scripts to interact with
 * the Prisma database instead of the old JSON file storage.
 * 
 * All scripts should use this instead of directly reading/writing JSON files.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get all tracks from the database
 */
export async function getAllTracks() {
  return await prisma.track.findMany({
    include: {
      Feed: {
        select: {
          id: true,
          title: true,
          artist: true,
          originalUrl: true,
          type: true,
          image: true
        }
      }
    },
    orderBy: {
      publishedAt: 'desc'
    }
  });
}

/**
 * Get tracks with filters
 */
export async function getTracks(filters?: {
  artist?: string;
  title?: string;
  feedId?: string;
  limit?: number;
}) {
  const where: any = {};
  
  if (filters?.artist) {
    where.artist = { contains: filters.artist, mode: 'insensitive' };
  }
  
  if (filters?.title) {
    where.title = { contains: filters.title, mode: 'insensitive' };
  }
  
  if (filters?.feedId) {
    where.feedId = filters.feedId;
  }

  const query: any = {
    where,
    include: {
      Feed: {
        select: {
          id: true,
          title: true,
          artist: true,
          originalUrl: true,
          type: true,
          image: true
        }
      }
    },
    orderBy: {
      publishedAt: 'desc'
    }
  };

  if (filters?.limit) {
    query.take = filters.limit;
  }

  return await prisma.track.findMany(query);
}

/**
 * Get all feeds from the database
 */
export async function getAllFeeds() {
  return await prisma.feed.findMany({
    include: {
      _count: {
        select: { Track: true }
      }
    },
    orderBy: {
      updatedAt: 'desc'
    }
  });
}

/**
 * Get feed by URL
 */
export async function getFeedByUrl(url: string) {
  return await prisma.feed.findFirst({
    where: { originalUrl: url },
    include: {
      Track: {
        orderBy: { trackOrder: 'asc' }
      }
    }
  });
}

/**
 * Create or update a track
 */
export async function upsertTrack(data: {
  id: string;
  guid?: string;
  title: string;
  artist?: string;
  album?: string;
  audioUrl: string;
  duration?: number;
  image?: string;
  feedId: string;
  publishedAt?: Date;
  v4vValue?: any;
}) {
  return await prisma.track.upsert({
    where: { id: data.id },
    create: data,
    update: {
      title: data.title,
      artist: data.artist,
      album: data.album,
      audioUrl: data.audioUrl,
      duration: data.duration,
      image: data.image,
      v4vValue: data.v4vValue,
      updatedAt: new Date()
    }
  });
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  const [totalTracks, totalFeeds, tracksWithV4V] = await Promise.all([
    prisma.track.count(),
    prisma.feed.count(),
    prisma.track.count({
      where: {
        v4vValue: { not: Prisma.JsonNull }
      }
    })
  ]);

  return {
    totalTracks,
    totalFeeds,
    tracksWithV4V
  };
}

/**
 * Add multiple tracks to the database
 * This replaces the old JSON file write pattern
 */
export async function addTracks(tracks: Array<{
  id?: string;
  guid?: string;
  title: string;
  artist?: string;
  album?: string;
  audioUrl?: string;
  duration?: number;
  image?: string;
  feedUrl?: string;
  feedId?: string;
  feedTitle?: string;
  feedArtist?: string;
  publishedAt?: Date;
  v4vValue?: any;
}>) {
  const results = {
    added: 0,
    updated: 0,
    errors: 0,
    errorsList: [] as string[]
  };

  for (const trackData of tracks) {
    try {
      // Find or create feed
      let feed;
      if (trackData.feedId) {
        feed = await prisma.feed.findUnique({ where: { id: trackData.feedId } });
      } else if (trackData.feedUrl) {
        feed = await prisma.feed.findFirst({ where: { originalUrl: trackData.feedUrl } });
      }

      // Create feed if it doesn't exist
      if (!feed && trackData.feedUrl) {
        feed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: trackData.feedTitle || 'Unknown Feed',
            artist: trackData.feedArtist || null,
            originalUrl: trackData.feedUrl,
            type: 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });
      }

      if (!feed) {
        throw new Error('Could not find or create feed');
      }

      // Generate track ID if not provided
      const trackId = trackData.id || trackData.guid || 
        `track-${feed.id}-${trackData.title}-${Date.now()}`;
      
      const guid = trackData.guid || trackId;

      // Upsert track
      const existing = await prisma.track.findUnique({ 
        where: { id: trackId } 
      });

      if (existing) {
        await prisma.track.update({
          where: { id: trackId },
          data: {
            title: trackData.title,
            artist: trackData.artist || trackData.feedArtist || null,
            album: trackData.album || trackData.feedTitle || null,
            audioUrl: trackData.audioUrl || '',
            duration: trackData.duration ? Math.round(trackData.duration) : null,
            image: trackData.image || null,
            v4vValue: trackData.v4vValue || null,
            publishedAt: trackData.publishedAt || new Date(),
            updatedAt: new Date()
          }
        });
        results.updated++;
      } else {
        await prisma.track.create({
          data: {
            id: trackId,
            guid: guid,
            title: trackData.title,
            artist: trackData.artist || trackData.feedArtist || null,
            album: trackData.album || trackData.feedTitle || null,
            audioUrl: trackData.audioUrl || '',
            duration: trackData.duration ? Math.round(trackData.duration) : null,
            image: trackData.image || null,
            feedId: feed.id,
            v4vValue: trackData.v4vValue || null,
            publishedAt: trackData.publishedAt || new Date(),
            updatedAt: new Date()
          }
        });
        results.added++;
      }
    } catch (error) {
      results.errors++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.errorsList.push(`Track "${trackData.title}": ${errorMsg}`);
      console.warn(`⚠️  Failed to add track "${trackData.title}":`, errorMsg);
    }
  }

  return results;
}

/**
 * Add a single track to the database
 */
export async function addTrack(trackData: {
  id?: string;
  guid?: string;
  title: string;
  artist?: string;
  album?: string;
  audioUrl?: string;
  duration?: number;
  image?: string;
  feedUrl?: string;
  feedId?: string;
  feedTitle?: string;
  feedArtist?: string;
  publishedAt?: Date;
  v4vValue?: any;
}) {
  const results = await addTracks([trackData]);
  return {
    success: results.errors === 0,
    added: results.added > 0,
    updated: results.updated > 0,
    error: results.errorsList[0] || null
  };
}

/**
 * Close Prisma connection
 */
export async function closeConnection() {
  await prisma.$disconnect();
}

