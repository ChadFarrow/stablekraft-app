#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { resolveItemGuid } from '../lib/feed-discovery';

const prisma = new PrismaClient();

async function createMissingHGHTracks() {
  console.log('🔍 Creating missing HGH tracks that were successfully resolved...');
  
  try {
    // Get the HGH playlist XML
    const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
    
    console.log('📥 Fetching HGH playlist XML...');
    const response = await fetch(HGH_PLAYLIST_URL);
    const xmlText = await response.text();
    
    // Extract remote items
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
    const remoteItems: Array<{ feedGuid: string; itemGuid: string }> = [];
    
    let match;
    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      const feedGuid = match[1];
      const itemGuid = match[2];
      
      if (feedGuid && itemGuid) {
        remoteItems.push({ feedGuid, itemGuid });
      }
    }
    
    // Find missing tracks (those that aren't in the database yet)
    const itemGuids = remoteItems.map(item => item.itemGuid);
    const existingTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      }
    });
    
    const existingGuids = new Set(existingTracks.map(track => track.guid));
    const missingItems = remoteItems.filter(item => !existingGuids.has(item.itemGuid));
    
    console.log(`❌ ${missingItems.length} tracks missing from database`);
    
    // Focus on the ones that were successfully resolved in the previous run
    const successfullyResolvedGuids = [
      '0faf03d9-d443-40e4-b3bf-2284f539cc6a', // Big Shot
      '1b15d9fa-92be-4f0a-b503-602580181735', // Stalker Song  
      '4abc42f6-b0c0-517c-a801-cb717efd72c2', // Sacrifice
      '796ee2f0-833d-42fb-aaa5-f1402acb0340-6fe2f866-8aa7-466e-bddc-cc1b698f723b', // Levitate
      'a1e7aa07-8ad8-4f64-910a-1d79a7f12972', // Bad Boys 3
      '9a24f526-618c-4a40-b79d-2ecd3526bb7a', // Dragon's Eye
      '94be7143-1339-463a-be51-b5817e015505', // disco girl
      'b86bb0e1-bc52-5b01-a1ea-d18fe3579ec9', // Lip Shape
      '767c9a41-16c5-42ba-af92-1929620cb420', // Fasen
      '0f2e86a2-cbf9-497c-9a4b-42d241088c35', // The God You Are
      'c265358b-28d1-4879-a050-8b51e1e48c7e', // Water is Sound
      '3a069c6c-7907-4d6e-b805-d0201a994b7c', // MOOKY - Feel Good
      '02f5a1d9-ebfa-4754-9cd0-c0bb07614a51', // A Better Pace
      'ed351b7f-8d3a-4c20-bfd5-f1822a30da86', // Where They Never Say Your Name
      '7ee02b29-f0b4-4482-bef5-1c59812701a8', // scumpypumpy-version6-final-masterV67-FINAL-thistimeforREAL.mp3
      'b2f795fb-c9be-414d-8864-ec5bff88b774', // The Trusted - Doomsday
      '27d20a3e-2ba2-4593-867d-cf7820f4f05f', // Feeling 4 U
      '300f7beb-17b0-40d8-a2e4-61ca816fd10c', // CityBeach - Nostalgic
      'https://www.haciendoelsueco.com/?p=1844' // Protologic music: Swedish Lake
    ];
    
    const priorityItems = missingItems.filter(item => 
      successfullyResolvedGuids.includes(item.itemGuid)
    );
    
    console.log(`🎯 Processing ${priorityItems.length} successfully resolved tracks...`);
    
    let createdCount = 0;
    let failedCount = 0;
    
    for (const missingItem of priorityItems) {
      console.log(`🔍 Creating track: ${missingItem.itemGuid}`);
      
      try {
        const apiResult = await resolveItemGuid(missingItem.feedGuid, missingItem.itemGuid);
        
        if (apiResult && apiResult.audioUrl) {
          // Find existing feed by looking for the feedGuid in originalUrl or other fields
          let feed = await prisma.feed.findFirst({
            where: {
              OR: [
                { originalUrl: { contains: missingItem.feedGuid } },
                { description: { contains: missingItem.feedGuid } }
              ]
            }
          });
          
          if (!feed) {
            // Create a basic feed entry
            feed = await prisma.feed.create({
              data: {
                id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: apiResult.feedTitle || 'Auto-created Feed',
                description: `Automatically created feed for ${apiResult.feedTitle} (GUID: ${missingItem.feedGuid})`,
                originalUrl: `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${missingItem.feedGuid}`,
                type: 'album',
                priority: 'normal',
                status: 'active',
                artist: apiResult.feedTitle || 'Unknown Artist',
                image: apiResult.feedImage,
                updatedAt: new Date()
              }
            });
            
            console.log(`📁 Created feed: ${feed.title}`);
          }
          
          // Create the track
          const newTrack = await prisma.track.create({
            data: {
              id: `track-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              title: apiResult.title,
              artist: apiResult.feedTitle || 'Unknown Artist',
              audioUrl: apiResult.audioUrl,
              duration: apiResult.duration || 0,
              image: apiResult.image || apiResult.feedImage,
              guid: apiResult.guid,
              publishedAt: apiResult.publishedAt || new Date(),
              feedId: feed.id,
              updatedAt: new Date()
            }
          });
          
          console.log(`✅ Created: ${newTrack.title} by ${newTrack.artist}`);
          console.log(`   Audio: ${newTrack.audioUrl}`);
          createdCount++;
        } else {
          console.log(`⚠️ Could not resolve: ${missingItem.itemGuid}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`❌ Error creating track for ${missingItem.itemGuid}:`, error);
        failedCount++;
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    console.log('\n📊 Creation Results:');
    console.log(`✅ Created new tracks: ${createdCount}`);
    console.log(`❌ Failed creations: ${failedCount}`);
    console.log(`📝 Total processed: ${priorityItems.length}`);
    
  } catch (error) {
    console.error('❌ Error in track creation process:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createMissingHGHTracks();