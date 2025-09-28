#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const { parseRSSFeed } = require('../lib/rss-parser-db');

const prisma = new PrismaClient();

async function reparseFeedsForV4V() {
  console.log('🔄 Starting V4V data re-parsing for all feeds...');
  
  try {
    // Get all active feeds
    const feeds = await prisma.feed.findMany({
      where: { status: 'active' },
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`📊 Found ${feeds.length} active feeds to re-parse`);
    
    let successCount = 0;
    let errorCount = 0;
    let v4vFoundCount = 0;
    
    for (const feed of feeds) {
      try {
        console.log(`\n🔍 Re-parsing feed: ${feed.title} (${feed.id})`);
        console.log(`   URL: ${feed.originalUrl}`);
        
        // Parse the feed with updated parser
        const parsedFeed = await parseRSSFeed(feed.originalUrl, feed.id);
        
        if (parsedFeed && parsedFeed.tracks) {
          console.log(`   📝 Found ${parsedFeed.tracks.length} tracks`);
          
          // Check if any tracks have V4V data
          const tracksWithV4V = parsedFeed.tracks.filter(track => 
            track.v4vRecipient || track.v4vValue
          );
          
          if (tracksWithV4V.length > 0) {
            console.log(`   ⚡ Found V4V data in ${tracksWithV4V.length} tracks!`);
            v4vFoundCount++;
            
            // Update tracks in database with V4V data
            for (const track of tracksWithV4V) {
              await prisma.track.updateMany({
                where: {
                  feedId: feed.id,
                  title: track.title,
                  audioUrl: track.audioUrl
                },
                data: {
                  v4vRecipient: track.v4vRecipient,
                  v4vValue: track.v4vValue ? JSON.stringify(track.v4vValue) : null
                }
              });
            }
            
            // Update feed-level V4V data if present
            if (parsedFeed.v4vRecipient || parsedFeed.v4vValue) {
              await prisma.feed.update({
                where: { id: feed.id },
                data: {
                  v4vRecipient: parsedFeed.v4vRecipient,
                  v4vValue: parsedFeed.v4vValue ? JSON.stringify(parsedFeed.v4vValue) : null
                }
              });
              console.log(`   ⚡ Updated feed-level V4V data`);
            }
          } else {
            console.log(`   ℹ️  No V4V data found in this feed`);
          }
          
          successCount++;
        } else {
          console.log(`   ⚠️  Failed to parse feed or no tracks found`);
          errorCount++;
        }
        
      } catch (error) {
        console.error(`   ❌ Error re-parsing feed ${feed.title}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`\n✅ V4V Re-parsing Complete!`);
    console.log(`   📊 Total feeds processed: ${feeds.length}`);
    console.log(`   ✅ Successfully parsed: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   ⚡ Feeds with V4V data: ${v4vFoundCount}`);
    
  } catch (error) {
    console.error('❌ Fatal error during V4V re-parsing:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
reparseFeedsForV4V().catch(console.error);