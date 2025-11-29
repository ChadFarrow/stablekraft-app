#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { resolveFeedGuidWithMetadata } from '../lib/feed-discovery';

const prisma = new PrismaClient();

async function resolveSingleGuid(guid: string) {
  console.log(`🔍 Resolving feed GUID: ${guid}`);
  
  try {
    // Try to resolve the GUID
    const resolvedFeed = await resolveFeedGuidWithMetadata(guid);
    
    if (!resolvedFeed) {
      console.log(`❌ Could not resolve GUID: ${guid}`);
      console.log(`💡 This GUID may need manual resolution via Podcast Index API or Wavlake lookup`);
      return;
    }
    
    console.log(`✅ Resolved feed:`);
    console.log(`   Title: ${resolvedFeed.title}`);
    console.log(`   Artist: ${resolvedFeed.artist}`);
    console.log(`   URL: ${resolvedFeed.url}`);
    console.log(`   Image: ${resolvedFeed.image || 'N/A'}`);
    
    // Check if we already have this feed in the database
    const existingFeed = await prisma.feed.findFirst({
      where: {
        OR: [
          { id: guid },
          { originalUrl: resolvedFeed.url }
        ]
      }
    });
    
    if (existingFeed) {
      if (existingFeed.id === guid && existingFeed.originalUrl.startsWith('guid:')) {
        // Update the existing GUID-based feed
        await prisma.feed.update({
          where: { id: guid },
          data: {
            originalUrl: resolvedFeed.url,
            title: resolvedFeed.title,
            artist: resolvedFeed.artist,
            image: resolvedFeed.image || null,
            status: 'active',
            updatedAt: new Date()
          }
        });
        console.log(`✅ Updated existing feed record with resolved URL`);
      } else {
        console.log(`⚠️ Feed already exists with this URL: ${existingFeed.id}`);
      }
    } else {
      // Create a new feed record
      const newFeed = await prisma.feed.create({
        data: {
          id: guid,
          title: resolvedFeed.title,
          description: `Auto-discovered from playlist GUID`,
          originalUrl: resolvedFeed.url,
          type: 'album',
          priority: 'normal',
          status: 'active',
          artist: resolvedFeed.artist,
          image: resolvedFeed.image || null,
          updatedAt: new Date()
        }
      });
      console.log(`✅ Created new feed record: ${newFeed.id}`);
    }
    
    // Suggest triggering RSS parsing
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Run RSS parsing for this feed:`);
    console.log(`      POST /api/parse-feeds?action=parse-single&feedId=${guid}`);
    console.log(`   2. Or use the admin panel to refresh this feed`);
    
  } catch (error) {
    console.error(`❌ Error resolving GUID:`, error);
  } finally {
    await prisma.$disconnect();
  }
}

// Get GUID from command line argument
const guid = process.argv[2];

if (!guid) {
  console.error('❌ Please provide a feed GUID as an argument');
  console.log('Usage: tsx scripts/resolve-single-guid.ts <feed-guid>');
  process.exit(1);
}

resolveSingleGuid(guid);

