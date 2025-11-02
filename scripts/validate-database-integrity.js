#!/usr/bin/env node

/**
 * Database Integrity Check
 * 
 * This script validates the Prisma database integrity.
 * Updated to use Prisma instead of JSON file storage.
 */

import { PrismaClient } from '@prisma/client';
import { 
  printSectionHeader, 
  formatConsoleOutput, 
  calculateCoverage 
} from './utils/database-utils.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const prisma = new PrismaClient();

async function validateDatabaseIntegrity() {
  printSectionHeader('Database Integrity Check', 50);
  
  try {
    // Get all tracks from Prisma database
    const tracks = await prisma.track.findMany({
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            originalUrl: true,
            type: true
          }
        }
      }
    });
    
    formatConsoleOutput('info', `Total tracks: ${tracks.length}`);
    
    // Calculate coverage using utility function
    const urlCoverage = calculateCoverage(tracks, 'audioUrl', {
      excludeValues: ['', null, undefined]
    });
    
    const artistCoverage = calculateCoverage(tracks, 'artist', {
      excludeValues: ['Unknown Artist', '', null, undefined]
    });
    
    const albumCoverage = calculateCoverage(tracks, 'album', {
      excludeValues: ['Unknown Album', '', null, undefined]
    });
    
    const guidCoverage = calculateCoverage(tracks, 'guid', {
      excludeValues: [null, undefined, '']
    });
    
    const v4vCoverage = calculateCoverage(tracks, (t) => t.v4vValue !== null ? 'hasV4V' : null, {
      excludeValues: [null, undefined]
    });
    
    formatConsoleOutput('info', '\nCoverage Statistics:');
    console.log(`  Audio URLs: ${urlCoverage.count} (${urlCoverage.percentage}%)`);
    console.log(`  Artists: ${artistCoverage.count} (${artistCoverage.percentage}%)`);
    console.log(`  Albums: ${albumCoverage.count} (${albumCoverage.percentage}%)`);
    console.log(`  GUIDs: ${guidCoverage.count} (${guidCoverage.percentage}%)`);
    console.log(`  V4V Data: ${v4vCoverage.count} (${v4vCoverage.percentage}%)`);
    
    // Check for duplicates by feed
    const feedGroups = new Map();
    tracks.forEach(track => {
      const feedId = track.feedId || 'unknown';
      if (!feedGroups.has(feedId)) feedGroups.set(feedId, []);
      feedGroups.get(feedId).push(track);
    });
    
    let feedsWithDuplicates = 0;
    feedGroups.forEach((feedTracks) => {
      const titleCounts = {};
      feedTracks.forEach(t => titleCounts[t.title] = (titleCounts[t.title] || 0) + 1);
      if (Object.values(titleCounts).some(c => c > 1)) feedsWithDuplicates++;
    });
    
    // Get feed statistics
    const feeds = await prisma.feed.findMany({
      include: {
        _count: {
          select: { Track: true }
        }
      }
    });
    
    formatConsoleOutput('info', '\nQuality Check:');
    console.log(`  Total feeds: ${feeds.length}`);
    console.log(`  Active feeds: ${feeds.filter(f => f.status === 'active').length}`);
    console.log(`  Feeds with duplicates: ${feedsWithDuplicates}`);
    
    // Show feed types
    formatConsoleOutput('info', '\nFeed Types:');
    const feedTypes = {};
    feeds.forEach(feed => {
      const type = feed.type || 'unknown';
      feedTypes[type] = (feedTypes[type] || 0) + 1;
    });
    
    Object.entries(feedTypes).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} feeds`);
    });
    
    formatConsoleOutput('success', '\nDatabase integrity check complete!');
    
  } catch (error) {
    formatConsoleOutput('error', 'Database integrity check failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] && process.argv[1].endsWith('validate-database-integrity.js')) {
  validateDatabaseIntegrity().catch(console.error);
}

export default validateDatabaseIntegrity;