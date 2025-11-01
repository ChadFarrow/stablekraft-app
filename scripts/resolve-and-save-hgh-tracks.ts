#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { resolveItemGuid } from '../lib/feed-discovery';

const prisma = new PrismaClient();

async function resolveAndSaveHGHTracks() {
  console.log('🔍 Starting HGH track resolution and database save process...');
  
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
    
    console.log(`📋 Found ${remoteItems.length} remote items in playlist`);
    
    // Check which tracks already exist in database
    const itemGuids = remoteItems.map(item => item.itemGuid);
    const existingTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      include: {
        Feed: true
      }
    });
    
    console.log(`✅ ${existingTracks.length} tracks already exist in database`);
    
    // Find tracks that need their audioUrl updated
    const tracksNeedingUpdate = existingTracks.filter(track => !track.audioUrl);
    console.log(`🔄 ${tracksNeedingUpdate.length} existing tracks need audioUrl updates`);
    
    // Find completely missing tracks
    const existingGuids = new Set(existingTracks.map(track => track.guid));
    const missingItems = remoteItems.filter(item => !existingGuids.has(item.itemGuid));
    console.log(`❌ ${missingItems.length} tracks completely missing from database`);
    
    let updatedCount = 0;
    let createdCount = 0;
    let failedCount = 0;
    
    // Update existing tracks with missing audioUrls
    for (const track of tracksNeedingUpdate) {
      const remoteItem = remoteItems.find(item => item.itemGuid === track.guid);
      if (!remoteItem) continue;
      
      console.log(`🔍 Resolving audioUrl for existing track: ${track.title}`);
      
      try {
        const apiResult = await resolveItemGuid(remoteItem.feedGuid, remoteItem.itemGuid);
        
        if (apiResult && apiResult.audioUrl) {
          await prisma.track.update({
            where: { id: track.id },
            data: {
              audioUrl: apiResult.audioUrl,
              duration: apiResult.duration || track.duration,
              image: apiResult.image || track.image,
              updatedAt: new Date()
            }
          });
          
          console.log(`✅ Updated ${track.title} with audioUrl: ${apiResult.audioUrl}`);
          updatedCount++;
        } else {
          console.log(`⚠️ Could not resolve audioUrl for ${track.title}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`❌ Error updating ${track.title}:`, error);
        failedCount++;
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Create completely missing tracks
    for (const missingItem of missingItems) {
      console.log(`🔍 Resolving missing track: ${missingItem.itemGuid}`);
      
      try {
        const apiResult = await resolveItemGuid(missingItem.feedGuid, missingItem.itemGuid);
        
        if (apiResult) {
          // Check if we have a feed for this feedGuid, create one if not
          let feed = await prisma.feed.findFirst({
            where: {
              originalUrl: { contains: missingItem.feedGuid }
            }
          });
          
          if (!feed) {
            // Create a basic feed entry
            feed = await prisma.feed.create({
              data: {
                id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: apiResult.feedTitle || 'Auto-created Feed',
                description: `Automatically created feed for ${apiResult.feedTitle}`,
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
              audioUrl: apiResult.audioUrl || '',
              duration: apiResult.duration || 0,
              image: apiResult.image || apiResult.feedImage,
              guid: apiResult.guid,
              publishedAt: apiResult.publishedAt || new Date(),
              feedId: feed.id,
              updatedAt: new Date()
            }
          });
          
          console.log(`✅ Created track: ${newTrack.title} by ${newTrack.artist}`);
          createdCount++;
        } else {
          console.log(`⚠️ Could not resolve missing track: ${missingItem.itemGuid}`);
          failedCount++;
        }
      } catch (error) {
        console.error(`❌ Error creating track for ${missingItem.itemGuid}:`, error);
        failedCount++;
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('\n📊 Resolution Results:');
    console.log(`✅ Updated existing tracks: ${updatedCount}`);
    console.log(`✅ Created new tracks: ${createdCount}`);
    console.log(`❌ Failed resolutions: ${failedCount}`);
    console.log(`📝 Total processed: ${tracksNeedingUpdate.length + missingItems.length}`);
    
    // Final verification
    const finalResolvedTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      }
    });
    
    const tracksWithAudio = finalResolvedTracks.filter(track => track.audioUrl);
    
    console.log('\n🎯 Final Status:');
    console.log(`Total tracks in database: ${finalResolvedTracks.length}`);
    console.log(`Tracks with audio URLs: ${tracksWithAudio.length}`);
    console.log(`Remaining placeholders: ${remoteItems.length - tracksWithAudio.length}`);
    
  } catch (error) {
    console.error('❌ Error in track resolution process:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resolveAndSaveHGHTracks();