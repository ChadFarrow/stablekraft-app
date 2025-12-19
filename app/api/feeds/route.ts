import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments, calculateTrackOrder } from '@/lib/rss-parser-db';
import { findPublisherFeed } from '@/lib/publisher-detector';
import { generateAlbumSlug, isValidFeedUrl, normalizeUrl } from '@/lib/url-utils';

/**
 * Generate a URL-friendly feed ID from artist and title
 */
function generateFeedId(artist: string | undefined, title: string): string {
  const parts = [];
  if (artist) {
    parts.push(generateAlbumSlug(artist));
  }
  parts.push(generateAlbumSlug(title));

  let baseId = parts.join('-');

  // Ensure we have a valid ID
  if (!baseId || baseId.length < 2) {
    baseId = `feed-${Date.now()}`;
  }

  return baseId;
}

// GET /api/feeds - List all feeds with optional filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const sortBy = searchParams.get('sortBy') || 'priority'; // 'priority' or 'recent'
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const skip = (page - 1) * limit;

    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    // Determine sort order based on sortBy parameter
    const orderBy = sortBy === 'recent'
      ? [{ createdAt: 'desc' as const }]
      : [{ priority: 'asc' as const }, { createdAt: 'desc' as const }];

    const [feeds, total] = await Promise.all([
      prisma.feed.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: {
            select: { Track: true }
          }
        }
      }),
      prisma.feed.count({ where })
    ]);
    
    return NextResponse.json({
      feeds,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching feeds:', error);
    return NextResponse.json(
      { error: 'Failed to fetch feeds' },
      { status: 500 }
    );
  }
}

// POST /api/feeds - Add a new feed and fetch its tracks
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalUrl, type = 'album', priority = 'normal', cdnUrl } = body;
    
    if (!originalUrl) {
      return NextResponse.json(
        { error: 'originalUrl is required' },
        { status: 400 }
      );
    }

    // Validate URL before processing
    if (!isValidFeedUrl(originalUrl)) {
      return NextResponse.json(
        { error: 'Invalid feed URL. Must be a valid http or https URL.' },
        { status: 400 }
      );
    }

    const normalizedOriginalUrl = normalizeUrl(originalUrl);

    // Check if feed already exists by URL first (return early to avoid parsing)
    const existingFeed = await prisma.feed.findUnique({
      where: { originalUrl: normalizedOriginalUrl },
      include: {
        _count: {
          select: { Track: true }
        }
      }
    });

    if (existingFeed) {
      return NextResponse.json(
        { error: 'Feed already exists', feed: existingFeed },
        { status: 409 }
      );
    }

    try {
      // Parse the RSS feed
      const parsedFeed = await parseRSSFeedWithSegments(originalUrl);

      // Generate a URL-friendly feed ID from artist and title
      let feedId = generateFeedId(parsedFeed.artist, parsedFeed.title);

      // Use upsert to atomically handle feed creation (prevents race conditions)
      // If another request created the same feed between our check and create, this won't fail
      const feed = await prisma.feed.upsert({
        where: { originalUrl: normalizedOriginalUrl },
        create: {
          id: feedId,
          guid: parsedFeed.podcastGuid || null,
          originalUrl: normalizedOriginalUrl,
          cdnUrl: cdnUrl || normalizedOriginalUrl,
          type,
          priority,
          title: parsedFeed.title,
          description: parsedFeed.description,
          artist: parsedFeed.artist,
          image: parsedFeed.image,
          language: parsedFeed.language,
          category: parsedFeed.category,
          explicit: parsedFeed.explicit,
          v4vRecipient: parsedFeed.v4vRecipient || null,
          v4vValue: parsedFeed.v4vValue || null,
          lastFetched: new Date(),
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        update: {
          // If feed exists by URL, just update lastFetched (race condition case)
          lastFetched: new Date(),
          updatedAt: new Date()
        },
        select: { id: true, createdAt: true, updatedAt: true, originalUrl: true }
      });

      // Check if this was a new creation vs update (race condition detection)
      const wasCreated = Math.abs(feed.createdAt.getTime() - feed.updatedAt.getTime()) < 1000;

      if (!wasCreated) {
        // Another request created this feed - return it as existing
        const existingFeedWithCount = await prisma.feed.findUnique({
          where: { id: feed.id },
          include: {
            _count: {
              select: { Track: true }
            }
          }
        });
        return NextResponse.json(
          { error: 'Feed already exists (concurrent request)', feed: existingFeedWithCount },
          { status: 409 }
        );
      }
      
      // Create tracks in database
      if (parsedFeed.items.length > 0) {
        const tracksData = parsedFeed.items.map((item, index) => ({
          id: `${feed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
          feedId: feed.id,
          guid: item.guid,
          title: item.title,
          subtitle: item.subtitle,
          description: item.description,
          artist: item.artist,
          audioUrl: item.audioUrl,
          duration: item.duration,
          explicit: item.explicit,
          image: item.image,
          publishedAt: item.publishedAt,
          itunesAuthor: item.itunesAuthor,
          itunesSummary: item.itunesSummary,
          itunesImage: item.itunesImage,
          itunesDuration: item.itunesDuration,
          itunesKeywords: item.itunesKeywords || [],
          itunesCategories: item.itunesCategories || [],
          v4vRecipient: item.v4vRecipient,
          v4vValue: item.v4vValue,
          startTime: item.startTime,
          endTime: item.endTime,
          trackOrder: item.episode ? calculateTrackOrder(item.episode, item.season) : index + 1, // Use season/episode if available
          updatedAt: new Date()
        }));
        
        await prisma.track.createMany({
          data: tracksData,
          skipDuplicates: true
        });
      }
      
      // Return feed with track count
      const feedWithCount = await prisma.feed.findUnique({
        where: { id: feed.id },
        include: {
          _count: {
            select: { Track: true }
          }
        }
      });

      // Check for publisher feed if this is an album and auto-import it
      let publisherFeedInfo = null;
      let importedPublisherFeed = null;

      if (type === 'album') {
        // First check if the feed has a podcast:publisher tag
        if (parsedFeed.publisherFeed) {
          console.log('✅ Found publisher feed in RSS:', parsedFeed.publisherFeed.title || parsedFeed.publisherFeed.feedUrl);

          // Check if publisher feed already exists
          const existingPublisher = await prisma.feed.findFirst({
            where: {
              OR: [
                { originalUrl: parsedFeed.publisherFeed.feedUrl },
                { guid: parsedFeed.publisherFeed.feedGuid }
              ]
            }
          });

          if (existingPublisher) {
            console.log('ℹ️ Publisher feed already imported:', existingPublisher.title);
            publisherFeedInfo = {
              found: true,
              feedUrl: parsedFeed.publisherFeed.feedUrl,
              // Use existing publisher's title if not available in remoteItem (Wavlake format)
              title: parsedFeed.publisherFeed.title || existingPublisher.title,
              guid: parsedFeed.publisherFeed.feedGuid,
              medium: parsedFeed.publisherFeed.medium,
              alreadyImported: true
            };
          } else {
            // Auto-import the publisher feed
            console.log('🔄 Auto-importing publisher feed:', parsedFeed.publisherFeed.title || parsedFeed.publisherFeed.feedUrl);
            try {
              const publisherParsedFeed = await parseRSSFeedWithSegments(parsedFeed.publisherFeed.feedUrl);

              // Generate a URL-friendly publisher feed ID
              let publisherFeedId = generateFeedId(publisherParsedFeed.artist, publisherParsedFeed.title);

              // Check for collision
              const existingPublisherId = await prisma.feed.findUnique({
                where: { id: publisherFeedId }
              });

              if (existingPublisherId) {
                publisherFeedId = `${publisherFeedId}-${Date.now()}`;
              }

              // Create publisher feed in database
              const publisherFeed = await prisma.feed.create({
                data: {
                  id: publisherFeedId,
                  guid: parsedFeed.publisherFeed.feedGuid,
                  originalUrl: parsedFeed.publisherFeed.feedUrl,
                  cdnUrl: parsedFeed.publisherFeed.feedUrl,
                  type: 'publisher',
                  priority: 'normal',
                  title: publisherParsedFeed.title,
                  description: publisherParsedFeed.description,
                  artist: publisherParsedFeed.artist,
                  image: publisherParsedFeed.image,
                  language: publisherParsedFeed.language,
                  category: publisherParsedFeed.category,
                  explicit: publisherParsedFeed.explicit,
                  v4vRecipient: publisherParsedFeed.v4vRecipient || null,
                  v4vValue: publisherParsedFeed.v4vValue || null,
                  lastFetched: new Date(),
                  status: 'active',
                  updatedAt: new Date()
                }
              });

              // Import publisher tracks
              for (const item of publisherParsedFeed.items) {
                await prisma.track.create({
                  data: {
                    id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    guid: item.guid || `guid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    feedId: publisherFeed.id,
                    title: item.title,
                    subtitle: item.subtitle,
                    description: item.description,
                    audioUrl: item.audioUrl,
                    duration: item.duration,
                    publishedAt: item.publishedAt,
                    image: item.image,
                    explicit: item.explicit,
                    v4vRecipient: item.v4vRecipient,
                    v4vValue: item.v4vValue,
                    startTime: item.startTime,
                    endTime: item.endTime,
                    updatedAt: new Date()
                  }
                });
              }

              // Get track count
              const publisherTrackCount = await prisma.track.count({
                where: { feedId: publisherFeed.id }
              });

              console.log(`✅ Auto-imported publisher feed with ${publisherTrackCount} tracks`);

              publisherFeedInfo = {
                found: true,
                feedUrl: parsedFeed.publisherFeed.feedUrl,
                // Use the parsed publisher feed's title (more reliable than remoteItem title)
                title: publisherFeed.title || parsedFeed.publisherFeed.title,
                guid: parsedFeed.publisherFeed.feedGuid,
                medium: parsedFeed.publisherFeed.medium,
                alreadyImported: false,
                autoImported: true
              };

              importedPublisherFeed = {
                id: publisherFeed.id,
                title: publisherFeed.title,
                trackCount: publisherTrackCount
              };
            } catch (publisherError) {
              console.error('❌ Failed to auto-import publisher feed:', publisherError);
              publisherFeedInfo = {
                found: true,
                feedUrl: parsedFeed.publisherFeed.feedUrl,
                // May be undefined for Wavlake format if import failed
                title: parsedFeed.publisherFeed.title,
                guid: parsedFeed.publisherFeed.feedGuid,
                medium: parsedFeed.publisherFeed.medium,
                alreadyImported: false,
                autoImported: false,
                error: publisherError instanceof Error ? publisherError.message : 'Unknown error'
              };
            }
          }
        } else if (parsedFeed.artist) {
          // Fallback to Podcast Index API search if no publisher tag found
          console.log('🔍 No publisher tag found, searching Podcast Index for artist:', parsedFeed.artist);
          publisherFeedInfo = await findPublisherFeed(parsedFeed.artist);

          if (publisherFeedInfo.found) {
            // Check if publisher feed already exists
            const existingPublisher = await prisma.feed.findUnique({
              where: { originalUrl: publisherFeedInfo.feedUrl }
            });

            if (existingPublisher) {
              console.log('ℹ️ Publisher feed already imported');
              publisherFeedInfo.alreadyImported = true;
            } else {
              // Note: We don't auto-import Podcast Index searches, only direct RSS publisher tags
              publisherFeedInfo.autoImported = false;
            }
          }
        }
      }

      return NextResponse.json({
        message: 'Feed added successfully',
        feed: feedWithCount,
        publisherFeed: publisherFeedInfo,
        importedPublisherFeed
      }, { status: 201 });
      
    } catch (parseError) {
      // If parsing fails, still create the feed but mark it as error
      const errorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
      
      const feed = await prisma.feed.create({
        data: {
          id: `feed-error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          originalUrl,
          cdnUrl: cdnUrl || originalUrl,
          type,
          priority,
          title: originalUrl,
          status: 'error',
          lastError: errorMessage,
          updatedAt: new Date()
        }
      });
      
      return NextResponse.json({
        warning: 'Feed added but parsing failed',
        feed,
        error: errorMessage
      }, { status: 206 });
    }
  } catch (error) {
    console.error('Error adding feed:', error);
    return NextResponse.json(
      { error: 'Failed to add feed' },
      { status: 500 }
    );
  }
}

// PUT /api/feeds - Update a feed
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Feed ID is required' },
        { status: 400 }
      );
    }
    
    const feed = await prisma.feed.update({
      where: { id },
      data: updateData
    });
    
    return NextResponse.json({
      message: 'Feed updated successfully',
      feed
    });
  } catch (error) {
    console.error('Error updating feed:', error);
    return NextResponse.json(
      { error: 'Failed to update feed' },
      { status: 500 }
    );
  }
}

// DELETE /api/feeds - Delete a feed
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Feed ID is required' },
        { status: 400 }
      );
    }
    
    // Delete feed (tracks will be cascade deleted)
    await prisma.feed.delete({
      where: { id }
    });
    
    return NextResponse.json({
      message: 'Feed deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting feed:', error);
    return NextResponse.json(
      { error: 'Failed to delete feed' },
      { status: 500 }
    );
  }
}