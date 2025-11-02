/**
 * Template for adding tracks to Prisma database
 * 
 * Use this template when creating scripts that add new tracks.
 * Replace all JSON file operations with Prisma operations.
 * 
 * @example
 * ```javascript
 * const { addTracks, closeConnection } = require('./prisma-helper');
 * 
 * // Prepare tracks
 * const tracks = [{
 *   title: 'Track Title',
 *   artist: 'Artist Name',
 *   audioUrl: 'https://...',
 *   feedUrl: 'https://...',
 *   // ... other fields
 * }];
 * 
 * // Add to database
 * const results = await addTracks(tracks);
 * console.log(`Added ${results.added} tracks, updated ${results.updated}`);
 * 
 * // Close connection
 * await closeConnection();
 * ```
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Add tracks to Prisma database (replaces JSON file writes)
 */
async function addTracksToPrisma(tracks) {
  const results = {
    added: 0,
    updated: 0,
    errors: 0,
    errorsList: []
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

      // Generate track ID
      const trackId = trackData.id || trackData.guid || 
        `track-${feed.id}-${trackData.title.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
      
      const guid = trackData.guid || trackId;

      // Check if track exists
      const existing = await prisma.track.findUnique({ where: { id: trackId } });

      const prismaTrackData = {
        id: trackId,
        guid: guid,
        title: trackData.title,
        artist: trackData.artist || trackData.feedArtist || null,
        album: trackData.album || trackData.feedTitle || null,
        audioUrl: trackData.audioUrl || trackData.enclosureUrl || '',
        duration: trackData.duration ? Math.round(trackData.duration) : null,
        image: trackData.image || trackData.feedImage || null,
        description: trackData.description || null,
        feedId: feed.id,
        publishedAt: trackData.publishedAt || (trackData.datePublished ? new Date(trackData.datePublished) : new Date()),
        v4vValue: trackData.v4vValue || null,
        updatedAt: new Date()
      };

      if (existing) {
        await prisma.track.update({
          where: { id: trackId },
          data: prismaTrackData
        });
        results.updated++;
      } else {
        await prisma.track.create({ data: prismaTrackData });
        results.added++;
      }
    } catch (error) {
      results.errors++;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      results.errorsList.push(`Track "${trackData.title}": ${errorMsg}`);
      console.warn(`⚠️  Failed to add track "${trackData.title}": ${errorMsg}`);
    }
  }

  return results;
}

/**
 * Close Prisma connection
 */
async function closeConnection() {
  await prisma.$disconnect();
}

module.exports = {
  addTracksToPrisma,
  closeConnection
};

