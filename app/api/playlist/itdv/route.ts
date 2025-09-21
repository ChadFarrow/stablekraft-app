import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ITDV_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';

// Simple cache to prevent multiple rapid calls
let playlistCache: { data: any; timestamp: number } | null = null;
const CACHE_DURATION = 60000; // 1 minute cache

// Clear cache to ensure fresh artwork
playlistCache = null;

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

interface PlaylistItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  description: string;
  image: string;
  audioUrl: string;
  duration: number;
  publishedAt: string;
  feedGuid: string;
  itemGuid: string;
}

function parseArtworkUrl(xmlText: string): string | null {
  // Parse the <image><url>...</url></image> structure
  const imageRegex = /<image>\s*<url>(.*?)<\/url>\s*<\/image>/s;
  const match = xmlText.match(imageRegex);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  return null;
}

function parseRemoteItems(xmlText: string): RemoteItem[] {
  const remoteItems: RemoteItem[] = [];
  
  // Simple regex parsing for podcast:remoteItem tags
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
    console.log('🎵 Fetching ITDV playlist...', { userAgent: request.headers.get('user-agent')?.slice(0, 50) });
    
    // Check cache first
    if (playlistCache && (Date.now() - playlistCache.timestamp) < CACHE_DURATION) {
      console.log('⚡ Using cached playlist data');
      return NextResponse.json(playlistCache.data);
    }
    
    // Fetch the playlist XML
    const response = await fetch(ITDV_PLAYLIST_URL, {
      headers: {
        'User-Agent': 'FUCKIT-Playlist-Parser/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }
    
    const xmlText = await response.text();
    console.log('📄 Fetched playlist XML, length:', xmlText.length);
    
    // Parse the XML to extract remote items and artwork
    const remoteItems = parseRemoteItems(xmlText);
    const artworkUrl = parseArtworkUrl(xmlText);
    console.log('📋 Found remote items:', remoteItems.length);
    console.log('🎨 Found artwork URL:', artworkUrl);
    
    // Create a single virtual album that represents the ITDV playlist
    const playlistAlbum = {
      id: 'itdv-playlist',
      title: 'ITDV Music Playlist',
      artist: 'Various Artists',
      album: 'ITDV Music Playlist',
      description: 'Every music reference from Into The Doerfel-Verse podcast',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg', // Add coverArt field for consistency
      url: ITDV_PLAYLIST_URL,
      tracks: remoteItems.map((item, index) => ({
        id: `itdv-track-${index + 1}`,
        title: `ITDV Track ${index + 1}`,
        artist: 'Various Artists',
        audioUrl: '', // No direct audio URL - this represents a reference
        duration: 180,
        publishedAt: new Date().toISOString(),
        image: artworkUrl || '/placeholder-podcast.jpg',
        feedGuid: item.feedGuid,
        itemGuid: item.itemGuid,
        description: `Music reference from Into The Doerfel-Verse podcast - Feed: ${item.feedGuid.slice(0, 8)}...`
      })),
      feedId: 'itdv-playlist',
      type: 'playlist',
      totalTracks: remoteItems.length,
      publishedAt: new Date().toISOString(),
      playlistContext: {
        source: 'itdv-playlist',
        originalUrl: ITDV_PLAYLIST_URL
      }
    };
    
    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);
    
    const responseData = {
      success: true,
      albums: [playlistAlbum], // Return as single album
      totalCount: 1,
      playlist: {
        title: 'ITDV Music Playlist',
        description: 'Every music reference from Into The Doerfel-Verse podcast',
        author: 'ChadF',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };
    
    // Cache the response
    playlistCache = {
      data: responseData,
      timestamp: Date.now()
    };
    
    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('❌ Error fetching ITDV playlist:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

async function resolvePlaylistItems(remoteItems: RemoteItem[]) {
  try {
    // Get unique feed GUIDs from the playlist
    const feedGuids = [...new Set(remoteItems.map(item => item.feedGuid))];
    console.log(`🔍 Looking up ${feedGuids.length} unique feeds for ${remoteItems.length} playlist items`);
    
    // Find feeds in database by GUID
    const feeds = await prisma.feed.findMany({
      where: {
        id: { in: feedGuids },
        status: 'active'
      },
      include: {
        tracks: {
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ]
        }
      }
    });
    
    console.log(`📊 Found ${feeds.length} matching feeds in database`);
    
    // Create a map for quick lookup
    const feedMap = new Map(feeds.map(feed => [feed.id, feed]));
    const resolvedAlbums: any[] = [];
    
    // Resolve each playlist item to an actual album
    for (const remoteItem of remoteItems) {
      const feed = feedMap.get(remoteItem.feedGuid);
      
      if (feed && feed.tracks.length > 0) {
        // Find specific track by item GUID, or use first track
        const track = feed.tracks.find(t => t.guid === remoteItem.itemGuid) || feed.tracks[0];
        
        // Create album-compatible object
        const album = {
          id: feed.id,
          title: feed.title,
          artist: feed.artist || 'Unknown Artist',
          album: feed.title,
          description: feed.description || '',
          image: feed.image || track.image || '/placeholder-podcast.jpg',
          url: feed.originalUrl,
          tracks: feed.tracks.map(t => ({
            id: t.id,
            title: t.title,
            artist: t.artist || feed.artist || 'Unknown Artist',
            audioUrl: t.audioUrl,
            duration: t.duration || 0,
            publishedAt: t.publishedAt?.toISOString() || new Date().toISOString(),
            image: t.image || feed.image || '/placeholder-podcast.jpg'
          })),
          feedId: feed.id,
          type: feed.type || 'music',
          totalTracks: feed.tracks.length,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          // Add playlist context
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: 'itdv-playlist'
          }
        };
        
        resolvedAlbums.push(album);
      } else {
        console.log(`⚠️ Could not resolve playlist item: ${remoteItem.feedGuid}/${remoteItem.itemGuid}`);
      }
    }
    
    return resolvedAlbums;
  } catch (error) {
    console.error('❌ Error resolving playlist items:', error);
    return [];
  }
}