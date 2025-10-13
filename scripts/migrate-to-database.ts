import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

const prisma = new PrismaClient();

interface ExistingFeed {
  id: string;
  originalUrl: string;
  type: string;
  title: string;
  priority: string;
  status: string;
  cdnUrl?: string;
}

interface ExistingTrack {
  title: string;
  subtitle?: string;
  summary?: string;
  itemGuid?: { _: string; isPermaLink: string };
  feedGuid?: string;
  feedUrl?: string;
  feedTitle?: string;
  feedDescription?: string;
  feedImage?: string;
  feedArtist?: string;
  published?: string;
  duration?: number;
  explicit?: boolean;
  keywords?: string[];
  categories?: Array<{ text: string }>;
  enclosureUrl?: string;
  enclosureType?: string;
  value?: any;
  valueTimeSplit?: any;
  startTime?: number;
  endTime?: number;
}

async function migrateFeeds() {
  console.log('🚀 Starting database migration...');
  
  try {
    // Read existing feeds from JSON
    const feedsPath = path.join(process.cwd(), 'data', 'feeds.json');
    const feedsContent = await fs.readFile(feedsPath, 'utf-8');
    const feedsData = JSON.parse(feedsContent);
    const existingFeeds: ExistingFeed[] = feedsData.feeds || [];
    
    console.log(`📋 Found ${existingFeeds.length} feeds to migrate`);
    
    // Process each feed
    for (const feed of existingFeeds) {
      console.log(`\n📡 Processing feed: ${feed.title}`);
      
      try {
        // Check if feed already exists in database
        const existingDbFeed = await prisma.feed.findUnique({
          where: { originalUrl: feed.originalUrl }
        });
        
        if (existingDbFeed) {
          console.log(`✅ Feed already exists in database: ${feed.title}`);
          continue;
        }
        
        // Parse RSS feed to get metadata and tracks
        let parsedFeed;
        try {
          parsedFeed = await parseRSSFeedWithSegments(feed.originalUrl);
        } catch (parseError) {
          console.warn(`⚠️ Failed to parse feed ${feed.title}:`, parseError);
          
          // Create feed with error status if parsing fails
          await prisma.feed.create({
            data: {
              id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              originalUrl: feed.originalUrl,
              cdnUrl: feed.cdnUrl || feed.originalUrl,
              type: feed.type || 'album',
              priority: feed.priority || 'normal',
              title: feed.title || feed.originalUrl,
              status: 'error',
              lastError: parseError instanceof Error ? parseError.message : 'Parse error',
              updatedAt: new Date()
            }
          });
          continue;
        }
        
        // Create feed in database
        const dbFeed = await prisma.feed.create({
          data: {
            id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            originalUrl: feed.originalUrl,
            cdnUrl: feed.cdnUrl || feed.originalUrl,
            type: feed.type || 'album',
            priority: feed.priority || 'normal',
            title: parsedFeed.title || feed.title,
            description: parsedFeed.description,
            artist: parsedFeed.artist,
            image: parsedFeed.image,
            language: parsedFeed.language,
            category: parsedFeed.category,
            explicit: parsedFeed.explicit,
            status: feed.status || 'active',
            lastFetched: new Date(),
            updatedAt: new Date()
          }
        });
        
        console.log(`✅ Created feed in database: ${dbFeed.title}`);
        
        // Add tracks from parsed feed
        if (parsedFeed.items.length > 0) {
          const tracksData = parsedFeed.items.map(item => ({
            id: `${dbFeed.id}-${item.guid || Math.random().toString(36).substr(2, 9)}`,
            feedId: dbFeed.id,
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
          
          console.log(`✅ Added ${tracksData.length} tracks for feed: ${dbFeed.title}`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing feed ${feed.title}:`, error);
      }
    }
    
    console.log('\n📦 Now migrating existing music tracks from JSON...');
    
    // Read existing music tracks
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const enhancedTracksPath = path.join(process.cwd(), 'data', 'enhanced-music-tracks.json');
    
    try {
      // Try enhanced tracks first, fall back to regular tracks
      let tracksContent;
      try {
        tracksContent = await fs.readFile(enhancedTracksPath, 'utf-8');
        console.log('📂 Using enhanced-music-tracks.json');
      } catch {
        tracksContent = await fs.readFile(tracksPath, 'utf-8');
        console.log('📂 Using music-tracks.json');
      }
      
      const tracksData = JSON.parse(tracksContent);
      const existingTracks: ExistingTrack[] = tracksData.musicTracks || tracksData.tracks || [];
      
      console.log(`📋 Found ${existingTracks.length} existing tracks to migrate`);
      
      // Group tracks by feed URL
      const tracksByFeed = new Map<string, ExistingTrack[]>();
      for (const track of existingTracks) {
        const feedUrl = track.feedUrl || 'unknown';
        if (!tracksByFeed.has(feedUrl)) {
          tracksByFeed.set(feedUrl, []);
        }
        tracksByFeed.get(feedUrl)!.push(track);
      }
      
      // Process tracks for each feed
      for (const [feedUrl, tracks] of Array.from(tracksByFeed.entries())) {
        console.log(`\n📀 Processing ${tracks.length} tracks for feed URL: ${feedUrl}`);
        
        // Find or create feed in database
        let dbFeed = await prisma.feed.findFirst({
          where: {
            OR: [
              { originalUrl: feedUrl },
              { cdnUrl: feedUrl }
            ]
          }
        });
        
        if (!dbFeed && feedUrl !== 'unknown') {
          // Create a minimal feed entry for orphaned tracks
          const firstTrack = tracks[0];
          dbFeed = await prisma.feed.create({
            data: {
              id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              originalUrl: feedUrl,
              cdnUrl: feedUrl,
              type: 'album',
              priority: 'normal',
              title: firstTrack.feedTitle || 'Unknown Feed',
              description: firstTrack.feedDescription,
              artist: firstTrack.feedArtist,
              image: firstTrack.feedImage,
              status: 'active',
              lastFetched: new Date(),
              updatedAt: new Date()
            }
          });
          console.log(`✅ Created feed for orphaned tracks: ${dbFeed.title}`);
        }
        
        if (dbFeed) {
          // Migrate tracks
          const tracksToCreate = tracks.map((track: ExistingTrack) => ({
            id: `${dbFeed!.id}-${track.itemGuid?._ || Math.random().toString(36).substr(2, 9)}`,
            feedId: dbFeed!.id,
            guid: track.itemGuid?._,
            title: track.title || 'Untitled',
            subtitle: track.subtitle,
            description: track.summary,
            artist: track.feedArtist,
            album: track.feedTitle,
            audioUrl: track.enclosureUrl || '',
            duration: track.duration,
            explicit: track.explicit || false,
            image: track.feedImage,
            publishedAt: track.published ? new Date(track.published) : undefined,
            itunesKeywords: track.keywords || [],
            itunesCategories: track.categories?.map((c: any) => c.text) || [],
            v4vValue: track.value || track.valueTimeSplit,
            startTime: track.startTime,
            endTime: track.endTime,
            updatedAt: new Date()
          })).filter((t: any) => t.audioUrl); // Only include tracks with audio URLs
          
          if (tracksToCreate.length > 0) {
            const result = await prisma.track.createMany({
              data: tracksToCreate,
              skipDuplicates: true
            });
            console.log(`✅ Migrated ${result.count} tracks for feed: ${dbFeed.title}`);
          }
        }
      }
      
    } catch (error) {
      console.warn('⚠️ Could not migrate existing tracks:', error);
    }
    
    // Print migration summary
    const feedCount = await prisma.feed.count();
    const trackCount = await prisma.track.count();
    
    console.log('\n✨ Migration completed successfully!');
    console.log(`📊 Database now contains:`);
    console.log(`   - ${feedCount} feeds`);
    console.log(`   - ${trackCount} tracks`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateFeeds().catch(console.error);
}

export default migrateFeeds;