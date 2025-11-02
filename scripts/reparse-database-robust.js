#!/usr/bin/env node

import { createRSSParser } from '../src/lib/rss-parser-config.js';
import fs from 'fs';
import path from 'path';
import {
  printSectionHeader,
  formatConsoleOutput,
  createStatsTracker,
  createProgressTracker,
  saveProgress,
  formatDuration
} from './utils/database-utils.js';

/**
 * @deprecated This script uses JSON file storage which has been migrated to Prisma.
 * Please use Prisma database directly instead of this script.
 */

async function reparseMainBranchDatabaseRobust() {
  formatConsoleOutput('warning', 'WARNING: This script uses deprecated JSON file storage.');
  formatConsoleOutput('warning', 'All database operations should use Prisma instead.');
  printSectionHeader('Robust Database Reparse with Progress Saving');
  
  try {
    const parser = createRSSParser();
    const startTime = Date.now();
    
    // Load existing main branch database (DEPRECATED - using JSON)
    formatConsoleOutput('info', 'Loading main branch database from JSON (DEPRECATED)...');
    const mainBranchPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    
    if (!fs.existsSync(mainBranchPath)) {
      formatConsoleOutput('error', 'Main branch database JSON file not found.');
      formatConsoleOutput('warning', 'This script is deprecated. Use Prisma database operations instead.');
      return;
    }
    
    const mainBranchData = JSON.parse(fs.readFileSync(mainBranchPath, 'utf8'));
    formatConsoleOutput('success', `Loaded ${mainBranchData.musicTracks.length} tracks from JSON file (DEPRECATED)`);
    
    // Set up progress tracking
    const progressFile = path.join(process.cwd(), 'data', 'reparse-progress.json');
    const enhancedFile = path.join(process.cwd(), 'data', 'enhanced-music-tracks.json');
    
    // Initialize enhanced database
    let enhancedDatabase = {
      metadata: {
        originalCount: mainBranchData.musicTracks.length,
        enhancedAt: new Date().toISOString(),
        parser: 'feature/rss-feed-parser',
        version: '2.0'
      },
      enhancedTracks: [],
      failedTracks: [],
      enhancementStats: {
        successful: 0,
        failed: 0,
        processed: 0,
        remaining: mainBranchData.musicTracks.length,
        artistNamesFixed: 0,
        valueForValueEnabled: 0,
        audioUrlsAdded: 0,
        durationResolved: 0
      }
    };
    
    // Use progress tracker utility
    const progressTracker = createProgressTracker(progressFile, mainBranchData.musicTracks.length);
    const startIndex = progressTracker.getStartIndex();
    
    if (progressTracker.isResuming()) {
      formatConsoleOutput('info', `Resuming from track ${startIndex + 1}`);
    }
    
    // Load existing enhanced database if present
    if (fs.existsSync(enhancedFile)) {
      enhancedDatabase = JSON.parse(fs.readFileSync(enhancedFile, 'utf8'));
      formatConsoleOutput('info', `Loaded existing enhanced database with ${enhancedDatabase.enhancedTracks.length} tracks`);
    }
    
    // Create stats tracker
    const statsTracker = createStatsTracker(enhancedDatabase.enhancementStats);
    
    // Process in smaller batches with frequent saves
    const BATCH_SIZE = 3;
    const SAVE_EVERY = 30;
    const totalTracks = mainBranchData.musicTracks.length;
    
    formatConsoleOutput('progress', `Processing ${totalTracks - startIndex} remaining tracks in batches of ${BATCH_SIZE}...`);
    
    for (let i = startIndex; i < totalTracks; i += BATCH_SIZE) {
      const batch = mainBranchData.musicTracks.slice(i, Math.min(i + BATCH_SIZE, totalTracks));
      const batchNum = Math.floor((i - startIndex) / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil((totalTracks - startIndex) / BATCH_SIZE);
      
      formatConsoleOutput('batch', `Batch ${batchNum}/${totalBatches}`, `tracks ${i + 1}-${Math.min(i + BATCH_SIZE, totalTracks)}`);
      
      // Process batch
      const batchPromises = batch.map(async (track, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        try {
          const resolved = await parser.resolveRemoteItem({
            feedGuid: track.feedGuid,
            itemGuid: track.itemGuid?._
          });
          
          const enhancedTrack = {
            originalIndex: globalIndex,
            originalData: track,
            enhancedMetadata: {
              title: resolved.item.title,
              artist: resolved.feed.itunes?.author || resolved.feed.title || track.feedArtist,
              duration: resolved.item.itunes?.duration || track.duration,
              albumTitle: resolved.feed.title,
              description: resolved.item.contentSnippet || resolved.item.content || track.summary,
              publishedDate: resolved.item.pubDate,
              audioUrl: resolved.item.enclosure?.url,
              audioType: resolved.item.enclosure?.type,
              audioSize: resolved.item.enclosure?.length,
              valueForValue: {
                enabled: !!resolved.item.value,
                configuration: resolved.item.value || null
              },
              feedGuid: track.feedGuid,
              itemGuid: track.itemGuid?._
            },
            enhancements: {
              artistNameImproved: (resolved.feed.itunes?.author || resolved.feed.title) !== track.feedArtist,
              durationResolved: !!resolved.item.itunes?.duration,
              valueForValueAdded: !!resolved.item.value,
              audioUrlAdded: !!resolved.item.enclosure?.url
            },
            enhancedAt: new Date().toISOString()
          };
          
          // Update stats using tracker
          statsTracker.increment('successful');
          if (enhancedTrack.enhancements.artistNameImproved) statsTracker.increment('artistNamesFixed');
          if (enhancedTrack.enhancements.valueForValueAdded) statsTracker.increment('valueForValueEnabled');
          if (enhancedTrack.enhancements.audioUrlAdded) statsTracker.increment('audioUrlsAdded');
          if (enhancedTrack.enhancements.durationResolved) statsTracker.increment('durationResolved');
          
          formatConsoleOutput('success', `${globalIndex + 1}. "${resolved.item.title}"`, `by ${resolved.feed.itunes?.author || 'Unknown'}`);
          return enhancedTrack;
          
        } catch (error) {
          statsTracker.increment('failed');
          const failedTrack = {
            originalIndex: globalIndex,
            originalData: track,
            error: error.message,
            failedAt: new Date().toISOString()
          };
          
          formatConsoleOutput('error', `${globalIndex + 1}. "${track.title}"`, `${error.message.substring(0, 50)}...`);
          return { failed: true, data: failedTrack };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // Process results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          if (result.value.failed) {
            enhancedDatabase.failedTracks.push(result.value.data);
          } else {
            enhancedDatabase.enhancedTracks.push(result.value);
          }
        }
      });
      
      // Update stats
      const processed = i + batch.length;
      statsTracker.update('processed', processed);
      statsTracker.update('remaining', totalTracks - processed);
      
      // Sync stats back to enhancedDatabase
      enhancedDatabase.enhancementStats = statsTracker.getStats();
      
      // Save progress periodically
      if (batchNum % SAVE_EVERY === 0 || i + BATCH_SIZE >= totalTracks) {
        formatConsoleOutput('save', `Saving progress... (${processed}/${totalTracks} processed)`);
        
        // Save enhanced database
        saveProgress(enhancedFile, enhancedDatabase);
        
        // Save progress marker
        progressTracker.update(i + batch.length - 1, batchNum);
        
        // Show current stats
        statsTracker.printStats(totalTracks);
      }
      
      // Brief pause to respect API limits
      if (i + BATCH_SIZE < totalTracks) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    // Final save
    enhancedDatabase.metadata.completedAt = new Date().toISOString();
    enhancedDatabase.metadata.processingTimeSeconds = duration;
    enhancedDatabase.enhancementStats = statsTracker.getStats();
    saveProgress(enhancedFile, enhancedDatabase);
    
    // Create backup of original
    const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-before-enhancement-${Date.now()}.json`);
    saveProgress(backupPath, mainBranchData);
    
    // Clean up progress file
    progressTracker.clear();
    
    printSectionHeader('Database Enhancement Complete');
    
    const stats = statsTracker.getStats();
    formatConsoleOutput('stats', 'Final Results:');
    console.log(`   Total Processed: ${stats.processed}`);
    console.log(`   Successfully Enhanced: ${stats.successful}`);
    console.log(`   Failed to Enhance: ${stats.failed}`);
    console.log(`   Success Rate: ${((stats.successful / stats.processed) * 100).toFixed(1)}%`);
    console.log(`   Processing Time: ${Math.round(duration)}s (${Math.round(duration/60)}m)`);
    
    formatConsoleOutput('info', '\nEnhancements Applied:');
    console.log(`   Artist Names Fixed: ${stats.artistNamesFixed}`);
    console.log(`   Value4Value Added: ${stats.valueForValueEnabled}`);
    console.log(`   Audio URLs Added: ${stats.audioUrlsAdded}`);
    console.log(`   Durations Resolved: ${stats.durationResolved}`);
    
    formatConsoleOutput('info', '\nFiles Created:');
    console.log(`   Enhanced Database: ${enhancedFile}`);
    console.log(`   Original Backup: ${backupPath}`);
    
    if (stats.successful > 0) {
      formatConsoleOutput('info', '\nSample Enhanced Tracks:');
      enhancedDatabase.enhancedTracks.slice(0, 5).forEach((track, index) => {
        console.log(`   ${index + 1}. "${track.enhancedMetadata.title}"`);
        console.log(`      Artist: ${track.enhancedMetadata.artist}`);
        console.log(`      Value4Value: ${track.enhancedMetadata.valueForValue.enabled ? '✅' : '❌'}`);
        const improvements = Object.entries(track.enhancements).filter(([_, value]) => value);
        if (improvements.length > 0) {
          console.log(`      Fixed: ${improvements.map(([key]) => key).join(', ')}`);
        }
      });
    }
    
    formatConsoleOutput('complete', `\nYour database now has proper artist names, Value4Value support, and direct audio URLs for ${stats.successful} tracks!`);
    
  } catch (error) {
    formatConsoleOutput('error', 'Error during database enhancement:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

reparseMainBranchDatabaseRobust().catch(console.error);