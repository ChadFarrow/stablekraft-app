#!/usr/bin/env node

import { createRSSParser } from '../src/lib/rss-parser-config.js';
import fs from 'fs';
import path from 'path';

/**
 * @deprecated This script uses JSON file storage which has been migrated to Prisma.
 * Please use Prisma database directly instead of this script.
 * 
 * This script is kept for backward compatibility but should not be used in production.
 * All database operations should use Prisma via @/lib/prisma
 */

async function reparseMainBranchDatabase() {
  console.log('\n⚠️  WARNING: This script uses deprecated JSON file storage.');
  console.log('   All database operations should use Prisma instead.\n');
  console.log('🔄 REPARSING MAIN BRANCH DATABASE WITH NEW RSS PARSER\n');
  console.log('═'.repeat(70));
  
  try {
    const parser = createRSSParser();
    const startTime = Date.now();
    
    // Load existing main branch database (DEPRECATED - using JSON)
    console.log('📁 Loading main branch database from JSON (DEPRECATED)...');
    const mainBranchPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    
    if (!fs.existsSync(mainBranchPath)) {
      console.log('❌ Main branch database JSON file not found.');
      console.log('   This script is deprecated. Use Prisma database operations instead.');
      return;
    }
    
    const mainBranchData = JSON.parse(fs.readFileSync(mainBranchPath, 'utf8'));
    console.log(`   ✅ Loaded ${mainBranchData.musicTracks?.length || 0} tracks from JSON file (DEPRECATED)`);
    
    // Create enhanced database structure
    const enhancedDatabase = {
      metadata: {
        originalCount: mainBranchData.musicTracks?.length || 0,
        enhancedAt: new Date().toISOString(),
        parser: 'feature/rss-feed-parser',
        version: '2.0'
      },
      enhancedTracks: [],
      enhancementStats: {
        successful: 0,
        failed: 0,
        newDataAdded: 0,
        valueForValueEnabled: 0,
        durationResolved: 0,
        artistNamesFixed: 0
      }
    };
    
    // Extract unique feedGuid/itemGuid pairs from existing database
    const trackReferences = [];
    if (mainBranchData.musicTracks) {
      mainBranchData.musicTracks.forEach((track, index) => {
        trackReferences.push({
          originalIndex: index,
          feedGuid: track.feedGuid,
          itemGuid: track.itemGuid?._,  // Handle the complex itemGuid structure
          originalTrack: track
        });
      });
    }
    
    console.log(`\n🔍 Found ${trackReferences.length} tracks to enhance`);
    console.log('   Processing in batches to respect API limits...\n');
    
    // Process tracks in batches
    const batchSize = 5;
    const failedTracks = [];
    
    for (let i = 0; i < trackReferences.length; i += batchSize) {
      const batch = trackReferences.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(trackReferences.length/batchSize);
      
      console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} tracks)...`);
      
      const batchPromises = batch.map(async (trackRef) => {
        try {
          // Use the new RSS parser to get complete metadata
          const resolved = await parser.resolveRemoteItem({
            feedGuid: trackRef.feedGuid,
            itemGuid: trackRef.itemGuid
          });
          
          // Create enhanced track combining original + new data
          const enhancedTrack = {
            // Original data preserved
            originalData: trackRef.originalTrack,
            
            // Enhanced metadata from new parser
            enhancedMetadata: {
              title: resolved.item.title,
              artist: resolved.feed.itunes?.author || resolved.feed.title || trackRef.originalTrack.feedArtist,
              duration: resolved.item.itunes?.duration || trackRef.originalTrack.duration,
              albumTitle: resolved.feed.title,
              description: resolved.item.contentSnippet || resolved.item.content || trackRef.originalTrack.summary,
              publishedDate: resolved.item.pubDate,
              audioUrl: resolved.item.enclosure?.url,
              audioType: resolved.item.enclosure?.type,
              audioSize: resolved.item.enclosure?.length,
              
              // Value4Value information
              valueForValue: {
                enabled: !!resolved.item.value,
                configuration: resolved.item.value || null,
                feedValue: resolved.feed.value || null
              },
              
              // Enhanced identifiers
              feedGuid: trackRef.feedGuid,
              itemGuid: trackRef.itemGuid,
              podcastGuid: resolved.feed.podcastGuid
            },
            
            // Enhancement flags
            enhancements: {
              artistNameImproved: (resolved.feed.itunes?.author || resolved.feed.title) !== trackRef.originalTrack.feedArtist,
              durationResolved: !!resolved.item.itunes?.duration,
              valueForValueAdded: !!resolved.item.value,
              audioUrlUpdated: !!resolved.item.enclosure?.url,
              descriptionEnhanced: !!(resolved.item.contentSnippet || resolved.item.content)
            },
            
            enhancedAt: new Date().toISOString()
          };
          
          // Update stats
          enhancedDatabase.enhancementStats.successful++;
          if (enhancedTrack.enhancements.artistNameImproved) enhancedDatabase.enhancementStats.artistNamesFixed++;
          if (enhancedTrack.enhancements.durationResolved) enhancedDatabase.enhancementStats.durationResolved++;
          if (enhancedTrack.enhancements.valueForValueAdded) enhancedDatabase.enhancementStats.valueForValueEnabled++;
          if (Object.values(enhancedTrack.enhancements).some(v => v)) enhancedDatabase.enhancementStats.newDataAdded++;
          
          console.log(`   ${trackRef.originalIndex + 1}. ✅ Enhanced "${resolved.item.title}" by ${resolved.feed.itunes?.author || 'Unknown'}`);
          return enhancedTrack;
          
        } catch (error) {
          enhancedDatabase.enhancementStats.failed++;
          const failedTrack = {
            originalIndex: trackRef.originalIndex,
            originalData: trackRef.originalTrack,
            error: error.message,
            failedAt: new Date().toISOString()
          };
          
          failedTracks.push(failedTrack);
          console.log(`   ${trackRef.originalIndex + 1}. ❌ Failed: ${trackRef.originalTrack.title || 'Unknown'} - ${error.message}`);
          return null;
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Add successful results to enhanced database
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          enhancedDatabase.enhancedTracks.push(result.value);
        }
      });
      
      // Brief pause between batches
      if (i + batchSize < trackReferences.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    // Add failed tracks to database for reference
    enhancedDatabase.failedTracks = failedTracks;
    
    // Save enhanced database
    const outputPath = path.join(process.cwd(), 'data', 'enhanced-music-tracks.json');
    fs.writeFileSync(outputPath, JSON.stringify(enhancedDatabase, null, 2), 'utf8');
    
    // Create backup of original
    const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-before-enhancement-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(mainBranchData, null, 2), 'utf8');
    
    console.log('\n═'.repeat(70));
    console.log('📊 ENHANCEMENT RESULTS');
    console.log('═'.repeat(70));
    console.log(`Original Tracks: ${enhancedDatabase.metadata.originalCount}`);
    console.log(`Successfully Enhanced: ${enhancedDatabase.enhancementStats.successful}`);
    console.log(`Failed to Enhance: ${enhancedDatabase.enhancementStats.failed}`);
    console.log(`Success Rate: ${((enhancedDatabase.enhancementStats.successful / enhancedDatabase.metadata.originalCount) * 100).toFixed(1)}%`);
    console.log(`Processing Time: ${duration.toFixed(1)}s`);
    
    console.log('\n🎯 ENHANCEMENT BREAKDOWN:');
    console.log(`   Artist Names Fixed: ${enhancedDatabase.enhancementStats.artistNamesFixed}`);
    console.log(`   Durations Resolved: ${enhancedDatabase.enhancementStats.durationResolved}`);
    console.log(`   Value4Value Enabled: ${enhancedDatabase.enhancementStats.valueForValueEnabled}`);
    console.log(`   Tracks with New Data: ${enhancedDatabase.enhancementStats.newDataAdded}`);
    
    console.log('\n📁 FILES CREATED:');
    console.log(`   Enhanced Database: ${outputPath}`);
    console.log(`   Original Backup: ${backupPath}`);
    
    if (enhancedDatabase.enhancedTracks.length > 0) {
      console.log('\n🎵 SAMPLE ENHANCED TRACKS:');
      enhancedDatabase.enhancedTracks.slice(0, 5).forEach((track, index) => {
        console.log(`   ${index + 1}. "${track.enhancedMetadata.title}"`);
        console.log(`      Artist: ${track.enhancedMetadata.artist}`);
        console.log(`      Duration: ${track.enhancedMetadata.duration || 'Unknown'}`);
        console.log(`      Value4Value: ${track.enhancedMetadata.valueForValue.enabled ? '✅' : '❌'}`);
        
        const improvements = Object.entries(track.enhancements).filter(([key, value]) => value);
        if (improvements.length > 0) {
          console.log(`      Improvements: ${improvements.map(([key]) => key).join(', ')}`);
        }
        console.log('');
      });
    }
    
    if (failedTracks.length > 0) {
      console.log('\n❌ FAILED TRACKS ANALYSIS:');
      const errorTypes = {};
      failedTracks.forEach(track => {
        errorTypes[track.error] = (errorTypes[track.error] || 0) + 1;
      });
      
      Object.entries(errorTypes).forEach(([error, count]) => {
        console.log(`   ${error}: ${count} tracks`);
      });
    }
    
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Review the enhanced database for improvements');
    console.log('2. Test the enhanced data with your application');
    console.log('3. Consider migrating to the enhanced format');
    console.log('4. Use Value4Value data for Lightning payments');
    
    console.log('\n✨ Database enhancement complete!');
    
  } catch (error) {
    console.error('\n❌ Error during database enhancement:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

reparseMainBranchDatabase().catch(console.error);