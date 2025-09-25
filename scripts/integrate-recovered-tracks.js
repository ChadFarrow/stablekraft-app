#!/usr/bin/env node

/**
 * Integrate recovered tracks into the database
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

async function integrateRecoveredTracks() {
  try {
    console.log('🔄 Integrating recovered tracks into database...\n');
    
    // Load recovery results
    const recoveryResultsPath = path.join(process.cwd(), 'data/track-recovery-results.json');
    if (!fs.existsSync(recoveryResultsPath)) {
      throw new Error('Recovery results not found. Run recover-missing-tracks.js first.');
    }
    
    const recoveryData = JSON.parse(fs.readFileSync(recoveryResultsPath, 'utf8'));
    const recoveredTracks = recoveryData.recoveredTracks;
    
    console.log(`📋 Processing ${recoveredTracks.length} recovered tracks...`);
    
    let addedTracks = 0;
    let updatedFeeds = new Set();
    let errors = 0;
    
    for (const [index, track] of recoveredTracks.entries()) {
      const { resolvedData } = track;
      
      try {
        // Create a unique URL identifier for the feed based on feedGuid
        const feedUrl = `https://podcastindex.org/podcast/${resolvedData.feedGuid}`;
        
        // First, ensure the feed exists in database
        const feed = await prisma.feed.upsert({
          where: { originalUrl: feedUrl },
          update: {
            title: resolvedData.feedTitle,
            image: resolvedData.feedImage,
            artist: resolvedData.feedTitle
          },
          create: {
            title: resolvedData.feedTitle,
            originalUrl: feedUrl,
            image: resolvedData.feedImage || '/placeholder-podcast.jpg',
            description: resolvedData.feedTitle,
            artist: resolvedData.feedTitle,
            category: 'Music',
            type: 'album',
            lastFetched: new Date()
          }
        });
        
        updatedFeeds.add(resolvedData.feedGuid);
        
        // Then, add or update the track
        const track = await prisma.track.upsert({
          where: { guid: resolvedData.guid },
          update: {
            title: resolvedData.title,
            description: resolvedData.description || '',
            audioUrl: resolvedData.audioUrl,
            duration: resolvedData.duration || 0,
            image: resolvedData.image || feed.image || '/placeholder-podcast.jpg',
            publishedAt: new Date(resolvedData.publishedAt),
            feedId: feed.id,
            artist: resolvedData.feedTitle
          },
          create: {
            guid: resolvedData.guid,
            title: resolvedData.title,
            description: resolvedData.description || '',
            audioUrl: resolvedData.audioUrl || '',
            duration: resolvedData.duration || 0,
            image: resolvedData.image || feed.image || '/placeholder-podcast.jpg',
            publishedAt: new Date(resolvedData.publishedAt),
            feedId: feed.id,
            artist: resolvedData.feedTitle
          }
        });
        
        addedTracks++;
        
        console.log(`  ✅ ${index + 1}/${recoveredTracks.length}: "${resolvedData.title}" by ${resolvedData.feedTitle}`);
        
      } catch (error) {
        console.error(`  ❌ ${index + 1}/${recoveredTracks.length}: Error with "${resolvedData.title}": ${error.message}`);
        errors++;
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 INTEGRATION RESULTS:');
    console.log(`   Tracks processed: ${recoveredTracks.length}`);
    console.log(`   Successfully integrated: ${addedTracks}`);
    console.log(`   Feeds updated: ${updatedFeeds.size}`);
    console.log(`   Errors: ${errors}`);
    console.log('='.repeat(60));
    
    if (addedTracks > 0) {
      console.log('\n💡 NEXT STEPS:');
      console.log('   1. Clear playlist cache to see updated tracks');
      console.log('   2. Test the playlist to confirm all tracks are playable');
      console.log('\n✨ Database integration complete! The recovered tracks should now appear in the playlist.');
    }
    
  } catch (error) {
    console.error('❌ Error integrating recovered tracks:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the integration
if (require.main === module) {
  integrateRecoveredTracks();
}

module.exports = { integrateRecoveredTracks };