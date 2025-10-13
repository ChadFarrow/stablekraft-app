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

export async function POST() {
  try {
    console.log('🚀 Starting complete migration of all feeds...');
    
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
    
    // Check which feeds are already migrated
    const migratedFeedIds = await prisma.feed.findMany({
      select: { id: true }
    });
    const migratedIds = new Set(migratedFeedIds.map(f => f.id));
    
    const feedsToMigrate = existingFeeds.filter(feed => !migratedIds.has(feed.id));
    console.log(`📦 Need to migrate ${feedsToMigrate.length} remaining feeds`);
    
    let totalFeeds = migratedFeedIds.length; // Start with already migrated count
    let totalTracks = await prisma.track.count(); // Start with existing track count
    let newFeeds = 0;
    let newTracks = 0;
    let errors: string[] = [];
    
    // Process feeds in smaller batches to avoid timeouts
    const batchSize = 10; // Smaller batches for more reliable processing
    
    for (let i = 0; i < feedsToMigrate.length; i += batchSize) {
      const batch = feedsToMigrate.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(feedsToMigrate.length/batchSize)}: ${batch.length} feeds`);
      
      for (const feedData of batch) {
        try {
          console.log(`📡 Processing feed: ${feedData.title}`);
          
          // Create feed in database
          const feed = await prisma.feed.create({
            data: {
              id: feedData.id,
              title: feedData.title,
              originalUrl: feedData.originalUrl,
              type: feedData.type || 'music',
              priority: feedData.priority || 'normal',
              status: feedData.status || 'active',
              updatedAt: new Date()
            }
          });
          
          newFeeds++;
          
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
            
            // Add tracks (limit to prevent timeout)
            const tracksToAdd = parsedFeed.items.slice(0, 30); // Limit tracks per feed
            
            for (const item of tracksToAdd) {
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
                newTracks++;
              } catch (trackError) {
                console.error(`❌ Error adding track ${item.title}:`, trackError);
              }
            }
            
            console.log(`✅ Processed ${tracksToAdd.length} tracks for ${feedData.title}`);
            
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
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    totalFeeds += newFeeds;
    totalTracks += newTracks;
    
    console.log(`✅ Migration complete: ${totalFeeds} total feeds (${newFeeds} new), ${totalTracks} total tracks (${newTracks} new)`);
    
    return NextResponse.json({
      success: true,
      message: 'Complete migration finished',
      totalFeeds,
      totalTracks,
      newFeeds,
      newTracks,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit error list
      summary: `Successfully migrated ${newFeeds} new feeds with ${newTracks} new tracks (${totalFeeds} total feeds, ${totalTracks} total tracks)`
    });
    
  } catch (error) {
    console.error('❌ Complete migration failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Complete migration failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}