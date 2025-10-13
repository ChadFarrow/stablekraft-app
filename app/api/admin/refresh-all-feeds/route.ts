import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parseRSSFeedWithSegments } from '@/lib/rss-parser-db';

// POST /api/admin/refresh-all-feeds - Refresh all RSS feeds in the database
export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication check here
    // const authHeader = request.headers.get('authorization');
    // if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    console.log('🔄 Starting comprehensive feed refresh...');
    
    // Get all feeds from database
    const feeds = await prisma.feed.findMany({
      select: {
        id: true,
        originalUrl: true,
        title: true,
        _count: {
          select: { Track: true }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' }
      ]
    });
    
    console.log(`📊 Found ${feeds.length} feeds to refresh`);
    
    let successCount = 0;
    let failCount = 0;
    let newTracksTotal = 0;
    const errors: Array<{ feed: string; error: string }> = [];
    
    // Process feeds in batches to avoid timeouts
    const BATCH_SIZE = 10;
    for (let i = 0; i < feeds.length; i += BATCH_SIZE) {
      const batch = feeds.slice(i, Math.min(i + BATCH_SIZE, feeds.length));
      
      await Promise.all(batch.map(async (feed) => {
        try {
          console.log(`📡 Refreshing: ${feed.title}`);
          
          // Parse the RSS feed
          const parsedFeed = await parseRSSFeedWithSegments(feed.originalUrl);
          
          // Update feed metadata
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              title: parsedFeed.title,
              description: parsedFeed.description,
              artist: parsedFeed.artist,
              image: parsedFeed.image,
              language: parsedFeed.language,
              category: parsedFeed.category,
              explicit: parsedFeed.explicit,
              lastFetched: new Date(),
              status: 'active',
              lastError: null
            }
          });
          
          // Get existing track GUIDs
          const existingTracks = await prisma.track.findMany({
            where: { feedId: feed.id },
            select: { guid: true }
          });
          
          const existingGuids = new Set(existingTracks.map(t => t.guid).filter(Boolean));
          
          // Filter out existing tracks
          const newItems = parsedFeed.items.filter(item => 
            !item.guid || !existingGuids.has(item.guid)
          );
          
          // Add new tracks
          if (newItems.length > 0) {
            const tracksData = newItems.map((item, index) => ({
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
              updatedAt: new Date()
            }));
            
            await prisma.track.createMany({
              data: tracksData,
              skipDuplicates: true
            });
            
            newTracksTotal += newItems.length;
          }
          
          successCount++;
          console.log(`✅ Refreshed ${feed.title}: ${newItems.length} new tracks`);
          
        } catch (error) {
          failCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({ feed: feed.title, error: errorMessage });
          
          // Update feed with error status
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              status: 'error',
              lastError: errorMessage,
              lastFetched: new Date()
            }
          });
          
          console.error(`❌ Failed to refresh ${feed.title}:`, errorMessage);
        }
      }));
      
      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < feeds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Get final counts
    const finalFeedCount = await prisma.feed.count();
    const finalTrackCount = await prisma.track.count();
    
    const summary = {
      success: true,
      message: 'Feed refresh completed',
      stats: {
        feedsProcessed: feeds.length,
        feedsSuccessful: successCount,
        feedsFailed: failCount,
        newTracksAdded: newTracksTotal,
        totalFeeds: finalFeedCount,
        totalTracks: finalTrackCount
      },
      errors: errors.slice(0, 10) // Return first 10 errors
    };
    
    console.log('✅ Feed refresh completed:', summary.stats);
    
    return NextResponse.json(summary);
    
  } catch (error) {
    console.error('❌ Feed refresh error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to refresh feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check status
export async function GET() {
  try {
    const feedCount = await prisma.feed.count();
    const trackCount = await prisma.track.count();
    const activeFeeds = await prisma.feed.count({ where: { status: 'active' } });
    const errorFeeds = await prisma.feed.count({ where: { status: 'error' } });
    
    return NextResponse.json({
      status: 'ready',
      database: {
        feeds: feedCount,
        tracks: trackCount,
        activeFeeds,
        errorFeeds
      },
      message: 'POST to this endpoint to refresh all feeds'
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Database error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}