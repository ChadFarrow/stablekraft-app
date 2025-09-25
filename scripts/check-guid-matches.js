#!/usr/bin/env node

/**
 * Check if playlist GUIDs match database entries
 */

const { PrismaClient } = require('@prisma/client');
const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function checkGuidMatches() {
  try {
    console.log('🔍 Checking GUID matches between playlist XML and database...\n');
    
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
    
    console.log(`📋 Found ${xmlGuids.length} GUIDs in playlist XML`);
    
    // Check which GUIDs exist in database
    const dbTracks = await prisma.track.findMany({
      where: {
        guid: { in: xmlGuids }
      },
      select: { 
        guid: true, 
        title: true, 
        audioUrl: true,
        artist: true 
      }
    });
    
    const dbGuidSet = new Set(dbTracks.map(t => t.guid));
    console.log(`💾 Found ${dbTracks.length} matching tracks in database`);
    
    // Find missing GUIDs
    const missingGuids = xmlGuids.filter(guid => !dbGuidSet.has(guid));
    console.log(`❌ Missing ${missingGuids.length} tracks from database\n`);
    
    if (missingGuids.length > 0) {
      console.log('Missing GUIDs (first 10):');
      missingGuids.slice(0, 10).forEach(guid => {
        console.log(`  - ${guid}`);
      });
    }
    
    // Check for tracks without audio URLs
    const tracksWithoutAudio = dbTracks.filter(t => !t.audioUrl || t.audioUrl.length === 0);
    console.log(`\n⚠️  Tracks in DB but without audio URL: ${tracksWithoutAudio.length}`);
    
    if (tracksWithoutAudio.length > 0) {
      console.log('Tracks without audio (first 5):');
      tracksWithoutAudio.slice(0, 5).forEach(track => {
        console.log(`  - ${track.guid}: "${track.title}" by ${track.artist}`);
      });
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log(`  Total GUIDs in XML: ${xmlGuids.length}`);
    console.log(`  Found in database: ${dbTracks.length}`);
    console.log(`  Missing from database: ${missingGuids.length}`);
    console.log(`  In DB but no audio: ${tracksWithoutAudio.length}`);
    console.log(`  Valid tracks (in DB with audio): ${dbTracks.length - tracksWithoutAudio.length}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkGuidMatches();