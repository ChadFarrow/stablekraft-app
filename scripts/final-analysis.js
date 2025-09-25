#!/usr/bin/env node

/**
 * Final analysis of Upbeats playlist resolution discrepancy
 */

const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function finalAnalysis() {
  try {
    console.log('🔍 FINAL ANALYSIS: Why 540 DB tracks become 495 in playlist\n');
    
    // 1. Fetch the exact data used by the playlist API
    const response = await fetch('https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml');
    const xmlText = await response.text();
    
    // 2. Extract GUIDs exactly as the API does
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
    const remoteItems = [];
    let match;
    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      remoteItems.push({
        feedGuid: match[1],
        itemGuid: match[2]
      });
    }
    
    console.log(`📋 Playlist XML: ${remoteItems.length} remote items`);
    
    // 3. Get the exact GUIDs that would be looked up
    const itemGuids = remoteItems.map(item => item.itemGuid);
    console.log(`🔍 Unique item GUIDs to lookup: ${new Set(itemGuids).size}`);
    
    // 4. Database lookup (exactly as the API does it)
    const dbTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      select: {
        guid: true,
        title: true,
        audioUrl: true,
        artist: true,
        id: true
      }
    });
    
    console.log(`💾 Found in database: ${dbTracks.length} tracks`);
    
    // 5. Apply the exact filter used by the API
    const validTracks = dbTracks.filter(track => 
      track.audioUrl && 
      track.audioUrl.length > 0 && 
      !track.audioUrl.includes('placeholder')
    );
    
    console.log(`✅ Valid tracks (pass API filter): ${validTracks.length}`);
    
    // 6. Check for duplicates in the playlist XML
    const guidCounts = {};
    itemGuids.forEach(guid => {
      guidCounts[guid] = (guidCounts[guid] || 0) + 1;
    });
    
    const duplicates = Object.entries(guidCounts).filter(([_, count]) => count > 1);
    console.log(`🔄 Duplicate GUIDs in XML: ${duplicates.length}`);
    
    if (duplicates.length > 0) {
      console.log('First few duplicates:');
      duplicates.slice(0, 3).forEach(([guid, count]) => {
        console.log(`  - ${guid}: appears ${count} times`);
      });
    }
    
    // 7. Check if any tracks are missing audioUrl after our population
    const tracksWithoutAudio = dbTracks.filter(t => !t.audioUrl || t.audioUrl.length === 0);
    console.log(`⚠️  Tracks without audio URL: ${tracksWithoutAudio.length}`);
    
    // 8. Final calculation
    const expectedInPlaylist = validTracks.length;
    const actualInPlaylist = 495; // From API response
    const discrepancy = expectedInPlaylist - actualInPlaylist;
    
    console.log('\n' + '='.repeat(60));
    console.log('🎯 FINAL ANALYSIS:');
    console.log(`   XML remote items: ${remoteItems.length}`);
    console.log(`   Unique GUIDs: ${new Set(itemGuids).size}`);
    console.log(`   Found in DB: ${dbTracks.length}`);
    console.log(`   Pass filter: ${validTracks.length}`);
    console.log(`   API returns: ${actualInPlaylist}`);
    console.log(`   DISCREPANCY: ${discrepancy} tracks`);
    
    if (discrepancy > 0) {
      console.log('\n❓ Possible causes:');
      console.log('   1. Database tracks being filtered out during resolution');
      console.log('   2. API resolution logic differs from our analysis');
      console.log('   3. Additional filtering happening in the API');
      console.log('   4. Race conditions or caching issues');
    }
    
    console.log('='.repeat(60));
    
    // 9. Let's check if there are any tracks that SHOULD be found but aren't
    const dbGuidSet = new Set(dbTracks.map(t => t.guid));
    const missingFromDb = itemGuids.filter(guid => !dbGuidSet.has(guid));
    
    if (missingFromDb.length > 0) {
      console.log(`\n❌ ${missingFromDb.length} GUIDs not found in database:`);
      missingFromDb.slice(0, 5).forEach(guid => {
        console.log(`   - ${guid}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error in final analysis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

finalAnalysis();