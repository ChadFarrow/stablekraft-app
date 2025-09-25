#!/usr/bin/env node

/**
 * Debug Upbeats playlist resolution
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

// Sample GUIDs from the Upbeats playlist that should exist after recovery
const TEST_RECOVERED_GUIDS = [
  'fafc072c-9fd8-4eca-8002-89e4b8787d75', // Bestlegs by Midnight Breakheart
  'fabc3e64-e470-4f97-bf4a-3957e481e23b', // Pour Me Some Water by Jimmy V
  '548bd314-5e9a-4374-8eae-529ac5628064', // My Man Hates Christmas
];

// Sample GUIDs from the original playlist (should be resolved)
const TEST_ORIGINAL_GUIDS = [
  '40e9def1-f84f-4a88-b4e1-7dfee8fffedf', // Sinister Purpose by IROH
  '623c0f13-72b7-5920-9c4f-abe0e31e1059', // Space by Vicious Clay
];

async function debugUpbeatsResolution() {
  try {
    console.log('🔍 Debug: Upbeats playlist database resolution...\n');
    
    console.log('1. Testing recovered tracks (should be found):');
    for (const guid of TEST_RECOVERED_GUIDS) {
      const track = await prisma.track.findUnique({
        where: { guid },
        include: { feed: true }
      });
      
      if (track) {
        console.log(`  ✅ ${guid} -> "${track.title}" by ${track.artist}`);
        console.log(`      Feed: ${track.feed?.title} | Audio URL: ${track.audioUrl ? 'YES' : 'NO'}`);
      } else {
        console.log(`  ❌ ${guid} -> NOT FOUND`);
      }
    }
    
    console.log('\n2. Testing original tracks (should be found):');
    for (const guid of TEST_ORIGINAL_GUIDS) {
      const track = await prisma.track.findUnique({
        where: { guid },
        include: { feed: true }
      });
      
      if (track) {
        console.log(`  ✅ ${guid} -> "${track.title}" by ${track.artist}`);
        console.log(`      Feed: ${track.feed?.title} | Audio URL: ${track.audioUrl ? 'YES' : 'NO'}`);
      } else {
        console.log(`  ❌ ${guid} -> NOT FOUND`);
      }
    }
    
    // Test the batch lookup like the playlist API does
    console.log('\n3. Testing batch lookup (like playlist API):');
    const allTestGuids = [...TEST_RECOVERED_GUIDS, ...TEST_ORIGINAL_GUIDS];
    const batchTracks = await prisma.track.findMany({
      where: {
        guid: { in: allTestGuids }
      },
      include: { feed: true }
    });
    
    console.log(`   Found ${batchTracks.length}/${allTestGuids.length} tracks in batch lookup`);
    
    const foundGuids = new Set(batchTracks.map(t => t.guid));
    const missingGuids = allTestGuids.filter(guid => !foundGuids.has(guid));
    
    if (missingGuids.length > 0) {
      console.log(`   Missing GUIDs: ${missingGuids.join(', ')}`);
    }
    
    // Get overall statistics
    console.log('\n4. Overall database statistics:');
    const totalTracks = await prisma.track.count();
    const tracksWithAudio = await prisma.track.count({
      where: {
        audioUrl: { not: '' }
      }
    });
    const tracksWithGuid = await prisma.track.count({
      where: {
        guid: { not: null }
      }
    });
    
    console.log(`   Total tracks: ${totalTracks}`);
    console.log(`   Tracks with audio URL: ${tracksWithAudio}`);
    console.log(`   Tracks with GUID: ${tracksWithGuid}`);
    
  } catch (error) {
    console.error('❌ Error debugging resolution:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debugUpbeatsResolution();