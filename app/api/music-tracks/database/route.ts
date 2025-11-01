import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { createErrorLogger } from '@/lib/error-utils';

const logger = createErrorLogger('MusicTracksDatabaseAPI');

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Get query parameters
    const artist = searchParams.get('artist');
    const title = searchParams.get('title');
    const feedId = searchParams.get('feedId');
    const episodeId = searchParams.get('episodeId');
    const source = searchParams.get('source') as any;
    const hasV4VData = searchParams.get('hasV4VData');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const extractFromFeed = searchParams.get('extractFromFeed');

    // If extractFromFeed is provided, extract and store tracks
    if (extractFromFeed) {
      logger.info('Extracting tracks from feed', { feedUrl: extractFromFeed });
      
      try {
        const result = await MusicTrackParser.extractMusicTracks(extractFromFeed);
        
        // Find or create feed in Prisma
        let feed = await prisma.feed.findFirst({
          where: { originalUrl: extractFromFeed }
        });
        
        if (!feed) {
          // Create feed if it doesn't exist
          feed = await prisma.feed.create({
            data: {
              id: `feed-${Date.now()}`,
              title: 'Extracted Feed',
              originalUrl: extractFromFeed,
              type: 'album',
              status: 'active',
              updatedAt: new Date()
            }
          });
          logger.info('Created new feed for extraction', { feedId: feed.id });
        }
        
        // Store tracks in Prisma database
        const storedTracks = [];
        for (const track of result.tracks) {
          try {
            const trackData: any = {
              id: track.id || `track-${Date.now()}-${Math.random()}`,
              feedId: feed.id,
              title: track.title,
              artist: track.artist || null,
              album: null,
              audioUrl: track.audioUrl || '',
              startTime: track.startTime || null,
              endTime: track.endTime || null,
              duration: Math.round(track.duration) || null,
              image: track.image || null,
              description: track.description || null,
              guid: track.episodeId || null,
              publishedAt: track.episodeDate || null,
              v4vValue: track.valueForValue ? {
                lightningAddress: track.valueForValue.lightningAddress,
                suggestedAmount: track.valueForValue.suggestedAmount,
                customKey: track.valueForValue.customKey,
                customValue: track.valueForValue.customValue,
                remotePercentage: track.valueForValue.remotePercentage,
                feedGuid: track.valueForValue.feedGuid,
                itemGuid: track.valueForValue.itemGuid
              } : null
            };
            
            const storedTrack = await prisma.track.create({
              data: trackData,
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
            storedTracks.push(storedTrack);
          } catch (error) {
            logger.warn('Failed to store track', { trackId: track.id, error: (error as Error).message });
          }
        }

        // Note: Extraction results are not stored in Prisma schema
        // This functionality would require a new table or can be logged separately
        
        logger.info('Successfully extracted and stored tracks', { 
          feedUrl: extractFromFeed, 
          tracksStored: storedTracks.length 
        });
      } catch (error) {
        logger.error('Failed to extract tracks from feed', { 
          feedUrl: extractFromFeed, 
          error: (error as Error).message 
        });
      }
    }

    // Build Prisma where clause
    const where: any = {};
    
    if (artist) {
      where.artist = { contains: artist, mode: 'insensitive' };
    }
    
    if (title) {
      where.title = { contains: title, mode: 'insensitive' };
    }
    
    if (feedId) {
      where.feedId = feedId;
    }
    
    // Note: episodeId might map to guid field, but since it's not guaranteed,
    // we'll filter by guid if episodeId is provided
    if (episodeId) {
      where.guid = episodeId;
    }
    
    // Note: source is not in Track schema, skip this filter
    // Source information can be derived from Feed.type if needed
    
    if (hasV4VData !== null && hasV4VData === 'true') {
      where.v4vValue = { not: null };
    }

    logger.info('Searching tracks with filters', { where, page, pageSize });

    // Search tracks with Prisma
    const skip = (page - 1) * pageSize;
    
    let tracks, total;
    try {
      [tracks, total] = await Promise.all([
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
                type: true,
                image: true
              }
            }
          }
        }),
        prisma.track.count({ where })
      ]);
      
      logger.info('Search completed successfully', { 
        total, 
        page,
        pageSize 
      });
    } catch (searchError) {
      logger.error('Search failed', { error: (searchError as Error).message });
      throw searchError;
    }
    
    // Get database statistics with Prisma
    let stats;
    try {
      const [totalTracks, totalFeeds] = await Promise.all([
        prisma.track.count(),
        prisma.feed.count()
      ]);
      
      stats = {
        totalTracks,
        totalFeeds,
        // Episodes concept doesn't exist in Prisma schema, use track count as approximation
        totalEpisodes: totalTracks
      };
      
      logger.info('Statistics retrieved successfully', { stats });
    } catch (statsError) {
      logger.error('Statistics failed', { error: (statsError as Error).message });
      throw statsError;
    }

    return NextResponse.json({
      success: true,
      data: {
        tracks,
        pagination: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize)
        },
        filters: where,
        statistics: stats
      }
    });

  } catch (error) {
    // Enhanced error handling
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('Music tracks database API failed', { 
      error: errorMessage,
      stack: errorStack,
      url: request.url
    });
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch music tracks',
        details: errorMessage,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'extractAndStore':
        const { feedUrls } = data;
        if (!feedUrls || !Array.isArray(feedUrls)) {
          return NextResponse.json(
            { error: 'feedUrls array is required' },
            { status: 400 }
          );
        }

        const results = [];
        const errors = [];

        for (const feedUrl of feedUrls) {
          try {
            logger.info('Extracting tracks from feed', { feedUrl });
            
            const result = await MusicTrackParser.extractMusicTracks(feedUrl);
            
            // Find or create feed in Prisma
            let feed = await prisma.feed.findFirst({
              where: { originalUrl: feedUrl }
            });
            
            if (!feed) {
              feed = await prisma.feed.create({
                data: {
                  id: `feed-${Date.now()}`,
                  title: 'Extracted Feed',
                  originalUrl: feedUrl,
                  type: 'album',
                  status: 'active',
                  updatedAt: new Date()
                }
              });
            }
            
            // Store tracks in Prisma database
            const storedTracks = [];
            for (const track of result.tracks) {
              try {
                const trackData: any = {
                  id: track.id || `track-${Date.now()}-${Math.random()}`,
                  feedId: feed.id,
                  title: track.title,
                  artist: track.artist || null,
                  album: null,
                  audioUrl: track.audioUrl || '',
                  startTime: track.startTime || null,
                  endTime: track.endTime || null,
                  duration: Math.round(track.duration) || null,
                  image: track.image || null,
                  description: track.description || null,
                  guid: track.episodeId || null,
                  publishedAt: track.episodeDate || null,
                  v4vValue: track.valueForValue ? {
                    lightningAddress: track.valueForValue.lightningAddress,
                    suggestedAmount: track.valueForValue.suggestedAmount,
                    customKey: track.valueForValue.customKey,
                    customValue: track.valueForValue.customValue,
                    remotePercentage: track.valueForValue.remotePercentage,
                    feedGuid: track.valueForValue.feedGuid,
                    itemGuid: track.valueForValue.itemGuid
                  } : null
                };
                
                const storedTrack = await prisma.track.create({
                  data: trackData
                });
                storedTracks.push(storedTrack);
              } catch (error) {
                logger.warn('Failed to store track', { trackId: track.id, error: (error as Error).message });
              }
            }

            // Note: Extraction results are not stored in Prisma schema

            results.push({
              feedUrl,
              success: true,
              tracksStored: storedTracks.length,
              totalTracks: result.tracks.length,
              relatedFeeds: result.relatedFeeds.length
            });

          } catch (error) {
            errors.push({
              feedUrl,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        // Get statistics
        const [totalTracks, totalFeeds] = await Promise.all([
          prisma.track.count(),
          prisma.feed.count()
        ]);
        
        const stats = {
          totalTracks,
          totalFeeds,
          totalEpisodes: totalTracks
        };

        return NextResponse.json({
          success: true,
          summary: {
            totalFeeds: feedUrls.length,
            successfulFeeds: results.length,
            failedFeeds: errors.length,
            totalTracksStored: results.reduce((sum, r) => sum + r.tracksStored, 0)
          },
          results,
          errors,
          statistics: stats
        });

      case 'updateTrack':
        const { trackId, updates } = data;
        if (!trackId || !updates) {
          return NextResponse.json(
            { error: 'trackId and updates are required' },
            { status: 400 }
          );
        }

        try {
          const updatedTrack = await prisma.track.update({
            where: { id: trackId },
            data: updates,
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

          return NextResponse.json({
            success: true,
            data: updatedTrack
          });
        } catch (error) {
          if ((error as any).code === 'P2025') {
            return NextResponse.json(
              { error: 'Track not found' },
              { status: 404 }
            );
          }
          throw error;
        }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

  } catch (error) {
    logger.error('Music tracks database POST failed', { error: (error as Error).message });
    
    return NextResponse.json(
      { 
        error: 'Failed to process request',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 