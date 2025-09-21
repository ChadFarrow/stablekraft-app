import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const ITDV_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

function parseRemoteItems(xmlText: string): RemoteItem[] {
  const remoteItems: RemoteItem[] = [];
  
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
  
  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    const feedGuid = match[1];
    const itemGuid = match[2];
    
    if (feedGuid && itemGuid) {
      remoteItems.push({
        feedGuid,
        itemGuid
      });
    }
  }
  
  return remoteItems;
}

export async function GET(request: Request) {
  try {
    console.log('🔍 Finding missing feeds from ITDV playlist...');
    
    // Fetch the playlist XML
    const response = await fetch(ITDV_PLAYLIST_URL, {
      headers: {
        'User-Agent': 'FUCKIT-Missing-Feed-Finder/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }
    
    const xmlText = await response.text();
    const remoteItems = parseRemoteItems(xmlText);
    console.log(`📋 Found ${remoteItems.length} remote items in playlist`);
    
    // Get unique item GUIDs from the playlist
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 Looking for ${itemGuids.length} unique track GUIDs`);
    
    // Find tracks that exist in database
    const existingTracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      select: {
        guid: true,
        title: true,
        feedId: true,
        feed: {
          select: {
            title: true
          }
        }
      }
    });
    
    console.log(`📊 Found ${existingTracks.length} tracks in database`);
    
    // Create a map of existing track GUIDs
    const existingTrackGuids = new Set(existingTracks.map(track => track.guid));
    
    // Find missing tracks and their feed GUIDs
    const missingItems = remoteItems.filter(item => !existingTrackGuids.has(item.itemGuid));
    
    // Group missing items by feed GUID
    const missingByFeed = new Map<string, RemoteItem[]>();
    missingItems.forEach(item => {
      if (!missingByFeed.has(item.feedGuid)) {
        missingByFeed.set(item.feedGuid, []);
      }
      missingByFeed.get(item.feedGuid)!.push(item);
    });
    
    // Convert to array format
    const missingFeeds = Array.from(missingByFeed.entries()).map(([feedGuid, items]) => ({
      feedGuid,
      missingItemCount: items.length,
      missingItems: items.map(item => item.itemGuid)
    }));
    
    console.log(`❌ Found ${missingItems.length} missing tracks across ${missingFeeds.length} feeds`);
    
    return NextResponse.json({
      success: true,
      summary: {
        totalRemoteItems: remoteItems.length,
        existingTracks: existingTracks.length,
        missingTracks: missingItems.length,
        missingFeeds: missingFeeds.length
      },
      existingTracks: existingTracks.map(track => ({
        guid: track.guid,
        title: track.title,
        feedTitle: track.feed?.title,
        feedId: track.feedId
      })),
      missingFeeds: missingFeeds,
      missingItems: missingItems
    });
    
  } catch (error) {
    console.error('❌ Error finding missing feeds:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}