import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { remoteItemTracks } from '@/lib/playlist/musicl-feed';
import { USER_AGENT } from '@/lib/user-agent';

const ITDV_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';
const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

function parseRemoteItems(xmlText: string): RemoteItem[] {
  const remoteItems: RemoteItem[] = [];
  
  // Attributes are read by name, in any order and with either quote (#309).
  // A remoteItem with no itemGuid (a <podcast:publisher> back-link) is not a track.
  for (const { feedGuid, itemGuid } of remoteItemTracks(xmlText)) {
    remoteItems.push({ feedGuid, itemGuid });
  }
  return remoteItems;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const playlistUrl = searchParams.get('playlistUrl') || ITDV_PLAYLIST_URL;
    
    console.log('🔍 Finding missing feeds from playlist:', playlistUrl);
    
    // Fetch the playlist XML
    const response = await fetch(playlistUrl, {
      headers: {
        'User-Agent': USER_AGENT
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
        Feed: {
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
        feedTitle: track.Feed?.title,
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