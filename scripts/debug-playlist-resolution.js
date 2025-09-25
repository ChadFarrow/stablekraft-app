#!/usr/bin/env node

/**
 * Debug why playlist returns fewer tracks than in database
 */

const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function debugPlaylistResolution() {
  try {
    console.log('🔍 Debugging playlist resolution discrepancy...\n');
    
    // Fetch playlist XML
    const response = await fetch('https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml');
    const xmlText = await response.text();
    
    // Extract all GUIDs from XML
    const guidRegex = /itemGuid="([^"]*)"/g;
    const xmlGuids = [];
    let match;
    while ((match = guidRegex.exec(xmlText)) !== null) {
      xmlGuids.push(match[1]);
    }
    
    console.log(`📋 Playlist XML contains: ${xmlGuids.length} tracks`);
    
    // Get all tracks from database that match playlist GUIDs
    const dbTracks = await prisma.track.findMany({
      where: {
        guid: { in: xmlGuids }
      },
      select: { 
        guid: true, 
        title: true, 
        audioUrl: true,
        artist: true,
        duration: true,
        image: true
      }
    });
    
    console.log(`💾 Database has: ${dbTracks.length} matching tracks`);
    
    // Check various conditions that might filter tracks out
    const tracksWithAudio = dbTracks.filter(t => t.audioUrl && t.audioUrl.length > 0);
    const tracksWithoutPlaceholder = tracksWithAudio.filter(t => !t.audioUrl.includes('placeholder'));
    const tracksWithDuration = tracksWithoutPlaceholder.filter(t => t.duration && t.duration > 0);
    const tracksWithImage = tracksWithoutPlaceholder.filter(t => t.image && t.image.length > 0);
    
    console.log('\n📊 Filter Analysis:');
    console.log(`  Tracks with audio URL: ${tracksWithAudio.length}`);
    console.log(`  Without placeholder URL: ${tracksWithoutPlaceholder.length}`);
    console.log(`  With duration > 0: ${tracksWithDuration.length}`);
    console.log(`  With image: ${tracksWithImage.length}`);
    
    // Check what the API endpoint filters for
    console.log('\n🔍 Checking API filter criteria (audioUrl && length > 0 && !placeholder):');
    const apiFilteredTracks = dbTracks.filter(track => 
      track.audioUrl && 
      track.audioUrl.length > 0 && 
      !track.audioUrl.includes('placeholder')
    );
    console.log(`  Would pass API filter: ${apiFilteredTracks.length} tracks`);
    
    // Find tracks that don't pass the filter
    const failedFilter = dbTracks.filter(track => 
      !track.audioUrl || 
      track.audioUrl.length === 0 || 
      track.audioUrl.includes('placeholder')
    );
    
    if (failedFilter.length > 0) {
      console.log(`\n❌ Tracks failing API filter (${failedFilter.length} total):`);
      failedFilter.slice(0, 5).forEach(track => {
        console.log(`  - "${track.title}" by ${track.artist}`);
        console.log(`    Audio URL: ${track.audioUrl || 'MISSING'}`);
      });
    }
    
    // Check for duplicate GUIDs in XML
    const guidCounts = {};
    xmlGuids.forEach(guid => {
      guidCounts[guid] = (guidCounts[guid] || 0) + 1;
    });
    const duplicates = Object.entries(guidCounts).filter(([_, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.length} duplicate GUIDs in XML:`);
      duplicates.slice(0, 5).forEach(([guid, count]) => {
        console.log(`  - ${guid} appears ${count} times`);
      });
    }
    
    // Final comparison
    console.log('\n' + '='.repeat(60));
    console.log('🎯 RESOLUTION SUMMARY:');
    console.log(`  XML tracks: ${xmlGuids.length}`);
    console.log(`  DB tracks matching XML: ${dbTracks.length}`);
    console.log(`  Tracks passing API filter: ${apiFilteredTracks.length}`);
    console.log(`  Expected in API response: ${apiFilteredTracks.length}`);
    console.log(`  Actually in API response: 495 (reported)`);
    console.log(`  DISCREPANCY: ${apiFilteredTracks.length - 495} tracks`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugPlaylistResolution();