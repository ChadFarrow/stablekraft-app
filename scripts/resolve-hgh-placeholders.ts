#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { processPlaylistFeedDiscovery } from '../lib/feed-discovery';

const prisma = new PrismaClient();

async function resolveHGHPlaceholders() {
  console.log('🔍 Starting HGH placeholder resolution process...');
  
  try {
    // Get the HGH playlist XML
    const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
    
    console.log('📥 Fetching HGH playlist XML...');
    const response = await fetch(HGH_PLAYLIST_URL);
    const xmlText = await response.text();
    
    // Extract remote items
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
    const remoteItems: Array<{ feedGuid: string; itemGuid: string }> = [];
    
    let match;
    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      const feedGuid = match[1];
      const itemGuid = match[2];
      
      if (feedGuid && itemGuid) {
        remoteItems.push({ feedGuid, itemGuid });
      }
    }
    
    console.log(`📋 Found ${remoteItems.length} remote items in playlist`);
    
    // Check how many are already resolved
    const itemGuids = remoteItems.map(item => item.itemGuid);
    const resolvedTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      }
    });
    
    console.log(`✅ ${resolvedTracks.length} items already resolved in database`);
    console.log(`❌ ${remoteItems.length - resolvedTracks.length} items need resolution`);
    
    // Get unresolved items
    const resolvedGuids = new Set(resolvedTracks.map(track => track.guid));
    const unresolvedItems = remoteItems.filter(item => !resolvedGuids.has(item.itemGuid));
    
    if (unresolvedItems.length > 0) {
      console.log(`🔄 Processing ${unresolvedItems.length} unresolved items...`);
      
      // Process feed discovery for unresolved items
      const addedFeeds = await processPlaylistFeedDiscovery(unresolvedItems);
      console.log(`📈 Added ${addedFeeds} new feeds to database`);
      
      // Force parse all pending feeds
      console.log('🔄 Triggering RSS parsing for all pending feeds...');
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app';
      
      const parseResponse = await fetch(`${baseUrl}/api/parse-feeds?action=parse-all-pending`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      if (parseResponse.ok) {
        const parseResult = await parseResponse.json();
        console.log(`✅ RSS parsing triggered: ${parseResult.message}`);
      } else {
        console.warn(`⚠️ RSS parsing failed: ${parseResponse.status}`);
      }
    } else {
      console.log('✅ All items are already resolved!');
    }
    
    // Final count check
    const finalResolvedTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      }
    });
    
    console.log('\n📊 Final Results:');
    console.log(`Total playlist items: ${remoteItems.length}`);
    console.log(`Resolved tracks: ${finalResolvedTracks.length}`);
    console.log(`Remaining placeholders: ${remoteItems.length - finalResolvedTracks.length}`);
    
  } catch (error) {
    console.error('❌ Error resolving HGH placeholders:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resolveHGHPlaceholders();