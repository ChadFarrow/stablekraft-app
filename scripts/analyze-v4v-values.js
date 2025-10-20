#!/usr/bin/env node

/**
 * Script to analyze v4vValue JSON fields to understand how keysend data is stored
 * 
 * Usage: node scripts/analyze-v4v-values.js
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function analyzeV4VValues() {
  try {
    console.log('🔍 Analyzing v4vValue JSON fields...\n');

    // Get feeds with non-null v4vValue
    const feedsWithV4V = await prisma.feed.findMany({
      where: {
        v4vValue: {
          not: null
        }
      },
      select: {
        id: true,
        title: true,
        originalUrl: true,
        v4vValue: true
      },
      take: 10 // Limit to first 10 for analysis
    });

    console.log(`📊 Found ${feedsWithV4V.length} feeds with v4vValue data\n`);

    feedsWithV4V.forEach((feed, index) => {
      console.log(`${index + 1}. ${feed.title}`);
      console.log(`   URL: ${feed.originalUrl}`);
      console.log(`   v4vValue: ${JSON.stringify(feed.v4vValue, null, 2)}`);
      console.log('');
    });

    // Get tracks with non-null v4vValue
    const tracksWithV4V = await prisma.track.findMany({
      where: {
        v4vValue: {
          not: null
        }
      },
      select: {
        id: true,
        title: true,
        feedId: true,
        v4vValue: true
      },
      take: 10 // Limit to first 10 for analysis
    });

    console.log(`📊 Found ${tracksWithV4V.length} tracks with v4vValue data\n`);

    tracksWithV4V.forEach((track, index) => {
      console.log(`${index + 1}. ${track.title}`);
      console.log(`   Feed ID: ${track.feedId}`);
      console.log(`   v4vValue: ${JSON.stringify(track.v4vValue, null, 2)}`);
      console.log('');
    });

    // Check for feeds that might have keysend-like data in v4vValue
    const allFeedsWithV4V = await prisma.feed.findMany({
      where: {
        v4vValue: {
          not: null
        }
      },
      select: {
        id: true,
        title: true,
        v4vValue: true
      }
    });

    console.log(`🔍 Searching for keysend patterns in ${allFeedsWithV4V.length} feeds with v4vValue...\n`);

    const keysendPatterns = [];
    
    allFeedsWithV4V.forEach(feed => {
      try {
        const value = typeof feed.v4vValue === 'string' ? JSON.parse(feed.v4vValue) : feed.v4vValue;
        
        // Look for various keysend indicators
        const valueStr = JSON.stringify(value).toLowerCase();
        
        if (valueStr.includes('node') || 
            valueStr.includes('keysend') || 
            valueStr.includes('906608') ||
            valueStr.includes('valueRecipient') ||
            valueStr.includes('customKey') ||
            valueStr.includes('customValue')) {
          
          keysendPatterns.push({
            id: feed.id,
            title: feed.title,
            v4vValue: feed.v4vValue,
            pattern: valueStr
          });
        }
      } catch (error) {
        // Skip invalid JSON
      }
    });

    console.log(`🎯 Found ${keysendPatterns.length} feeds with potential keysend patterns:\n`);

    keysendPatterns.forEach((feed, index) => {
      console.log(`${index + 1}. ${feed.title}`);
      console.log(`   v4vValue: ${JSON.stringify(feed.v4vValue, null, 2)}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error analyzing v4vValue fields:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
analyzeV4VValues();
