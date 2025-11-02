import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { parseRSSFeedWithSegments } from '@/lib/rss-parser-db';

interface ExistingFeed {
  id: string;
  originalUrl: string;
  type: string;
  title: string;
  priority: string;
  status: string;
  cdnUrl?: string;
}

export async function POST(request: Request) {
  try {
    console.log('🚀 Starting database migration via API...');
    
    // Check if we already have data
    const existingFeedCount = await prisma.feed.count();
    const existingTrackCount = await prisma.track.count();
    
    if (existingFeedCount > 0 && existingTrackCount > 0) {
      return NextResponse.json({
        success: true,
        message: 'Database already populated',
        feedCount: existingFeedCount,
        trackCount: existingTrackCount,
        skipped: true
      });
    }
    
    // Read existing feeds from JSON
    const feedsPath = path.join(process.cwd(), 'data', 'feeds.json');
    if (!fs.existsSync(feedsPath)) {
      return NextResponse.json({
        success: false,
        error: 'feeds.json not found'
      }, { status: 404 });
    }
    
    const feedsContent = fs.readFileSync(feedsPath, 'utf-8');
    const feedsData = JSON.parse(feedsContent);
    const existingFeeds: ExistingFeed[] = feedsData.feeds || [];
    
    console.log(`📊 Found ${existingFeeds.length} feeds to migrate`);
    
    let migratedFeeds = 0;
    let migratedTracks = 0;
    let errors: string[] = [];
    
    // Get batch parameters
    const { searchParams } = new URL(request.url);
    const batchSize = parseInt(searchParams.get('batchSize') || '25');
    const startIndex = parseInt(searchParams.get('startIndex') || '0');
    const maxBatch = Math.min(startIndex + batchSize, existingFeeds.length);
    
    console.log(`📦 Processing batch: feeds ${startIndex}-${maxBatch-1} of ${existingFeeds.length} total`);
    
    // Process each feed in the current batch
    for (const feedData of existingFeeds.slice(startIndex, maxBatch)) {
      try {
        console.log(`📡 Processing feed: ${feedData.title}`);
        
        // Create or update feed in database
        const feed = await prisma.feed.upsert({
          where: { id: feedData.id },
          update: {
            title: feedData.title,
            originalUrl: feedData.originalUrl,
            type: feedData.type || 'music',
            priority: feedData.priority || 'normal',
            status: feedData.status || 'active',
            updatedAt: new Date()
          },
          create: {
            id: feedData.id,
            title: feedData.title,
            originalUrl: feedData.originalUrl,
            type: feedData.type || 'music',
            priority: feedData.priority || 'normal',
            status: feedData.status || 'active',
            updatedAt: new Date()
          }
        });
        
        migratedFeeds++;
        
        // Parse the RSS feed to get tracks
        try {
          const parsedFeed = await parseRSSFeedWithSegments(feedData.originalUrl);
          
          // Update feed metadata
          await prisma.feed.update({
            where: { id: feedData.id },
            data: {
              description: parsedFeed.description,
              image: parsedFeed.image,
              artist: parsedFeed.artist,
              language: parsedFeed.language,
              category: parsedFeed.category,
              explicit: parsedFeed.explicit,
              lastFetched: new Date()
            }
          });
          
          // Add tracks
          for (const item of parsedFeed.items.slice(0, 50)) { // Limit tracks per feed
            try {
              await prisma.track.create({
                data: {
                  id: `${feedData.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  feedId: feedData.id,
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
                  v4vValue: item.v4vValue || null,
                  startTime: item.startTime,
                  endTime: item.endTime,
                  updatedAt: new Date()
                }
              });
              migratedTracks++;
            } catch (trackError) {
              console.error(`❌ Error adding track ${item.title}:`, trackError);
            }
          }
          
          console.log(`✅ Processed ${parsedFeed.items.length} tracks for ${feedData.title}`);
          
        } catch (parseError) {
          console.error(`❌ Error parsing feed ${feedData.title}:`, parseError);
          errors.push(`Failed to parse ${feedData.title}: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
          
          // Update feed with error status
          await prisma.feed.update({
            where: { id: feedData.id },
            data: {
              status: 'error',
              lastError: parseError instanceof Error ? parseError.message : 'Parse error',
              lastFetched: new Date()
            }
          });
        }
        
      } catch (feedError) {
        console.error(`❌ Error processing feed ${feedData.title}:`, feedError);
        errors.push(`Failed to process ${feedData.title}: ${feedError instanceof Error ? feedError.message : 'Unknown error'}`);
      }
      
      // Add a small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`✅ Batch migration complete: ${migratedFeeds} feeds, ${migratedTracks} tracks`);
    
    const hasMore = maxBatch < existingFeeds.length;
    const nextStartIndex = hasMore ? maxBatch : null;
    
    return NextResponse.json({
      success: true,
      message: `Batch migration completed (${startIndex}-${maxBatch-1} of ${existingFeeds.length})`,
      feedCount: migratedFeeds,
      trackCount: migratedTracks,
      totalFeeds: existingFeeds.length,
      processed: maxBatch,
      hasMore,
      nextStartIndex,
      errors: errors.length > 0 ? errors : undefined
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Migration failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}