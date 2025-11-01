#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { resolveFeedGuid } from '../lib/feed-discovery';

const prisma = new PrismaClient();

async function resolveGuidFeeds() {
  console.log('🔍 Starting GUID feed resolution process...');
  
  try {
    // Get all feeds with GUID-based URLs
    const guidFeeds = await prisma.feed.findMany({
      where: {
        originalUrl: {
          startsWith: 'guid:'
        }
      }
    });
    
    console.log(`📋 Found ${guidFeeds.length} GUID-based feeds to resolve`);
    
    let resolvedCount = 0;
    let failedCount = 0;
    
    for (const feed of guidFeeds) {
      const guid = feed.originalUrl.replace('guid:', '');
      console.log(`🔍 Resolving GUID: ${guid}`);
      
      try {
        const resolvedUrl = await resolveFeedGuid(guid);
        
        if (resolvedUrl) {
          // Check if we already have this resolved URL
          const existingFeed = await prisma.feed.findFirst({
            where: {
              originalUrl: resolvedUrl,
              id: { not: feed.id }
            }
          });
          
          if (existingFeed) {
            console.log(`⚠️ Feed already exists with URL ${resolvedUrl}, deleting duplicate GUID entry`);
            await prisma.feed.delete({
              where: { id: feed.id }
            });
          } else {
            // Update the feed with the resolved URL
            await prisma.feed.update({
              where: { id: feed.id },
              data: {
                originalUrl: resolvedUrl,
                status: 'active',
                title: feed.title.replace('Unresolved feed GUID', 'Resolved feed'),
                updatedAt: new Date()
              }
            });
            
            console.log(`✅ Resolved ${guid} to ${resolvedUrl}`);
            resolvedCount++;
            
            // Trigger RSS parsing for this feed
            try {
              const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app';
              const parseResponse = await fetch(`${baseUrl}/api/parse-feeds?action=parse-single&feedId=${feed.id}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                }
              });
              
              if (parseResponse.ok) {
                const parseResult = await parseResponse.json();
                console.log(`📥 RSS parsing queued for ${feed.id}`);
              }
            } catch (parseError) {
              console.warn(`⚠️ Could not trigger RSS parsing: ${parseError}`);
            }
          }
        } else {
          console.log(`❌ Could not resolve GUID: ${guid}`);
          failedCount++;
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`❌ Error resolving ${guid}:`, error);
        failedCount++;
      }
    }
    
    console.log('\n📊 Resolution Results:');
    console.log(`✅ Resolved: ${resolvedCount}`);
    console.log(`❌ Failed: ${failedCount}`);
    console.log(`📝 Total processed: ${guidFeeds.length}`);
    
  } catch (error) {
    console.error('❌ Error in GUID feed resolution:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resolveGuidFeeds();