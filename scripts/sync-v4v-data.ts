#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function syncV4VData() {
  try {
    console.log('🔄 Fetching V4V data from production...');
    
    // Fetch all albums from production API
    const response = await fetch('https://music.podtards.com/api/albums-fast?limit=1000');
    const data = await response.json();
    
    if (!data.success || !data.albums) {
      throw new Error('Failed to fetch production data');
    }
    
    console.log(`📦 Found ${data.albums.length} albums in production`);
    
    let updatedCount = 0;
    let trackUpdateCount = 0;
    
    // Update each feed with V4V data
    for (const album of data.albums) {
      if (album.v4vRecipient || album.v4vValue) {
        try {
          // Try to find by feedGuid first (most reliable)
          let feed = await prisma.feed.findFirst({
            where: { 
              id: album.feedGuid || album.id 
            }
          });
          
          // If not found by ID, try by original URL
          if (!feed && album.feedUrl) {
            feed = await prisma.feed.findFirst({
              where: { 
                originalUrl: album.feedUrl 
              }
            });
          }
          
          // Last resort: try fuzzy title match
          if (!feed) {
            feed = await prisma.feed.findFirst({
              where: {
                title: {
                  contains: album.title.trim(),
                  mode: 'insensitive'
                }
              }
            });
          }
          
          if (feed) {
            // Update all tracks for this feed with V4V data
            const updateResult = await prisma.track.updateMany({
              where: { feedId: feed.id },
              data: {
                v4vRecipient: album.v4vRecipient || null,
                v4vValue: album.v4vValue || null
              }
            });
            
            trackUpdateCount += updateResult.count;
            updatedCount++;
            console.log(`✅ Updated ${updateResult.count} tracks for "${album.title}" with V4V data`);
          } else {
            // Only log if it has V4V data we're missing
            console.log(`⚠️ Album "${album.title}" not found in local database (has V4V data)`);
          }
        } catch (error) {
          console.error(`Error updating "${album.title}":`, error);
        }
      }
    }
    
    console.log(`\n🎉 Successfully updated ${updatedCount} albums with ${trackUpdateCount} total tracks`);
    console.log('💡 V4V data sync complete! Boost buttons should now appear in local development.');
    
  } catch (error) {
    console.error('Error syncing V4V data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncV4VData();