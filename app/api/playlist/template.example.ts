/**
 * PLAYLIST ROUTE TEMPLATE
 * 
 * To add a new playlist:
 * 1. Copy this file to app/api/playlist/[playlist-name]/route.ts
 * 2. Update the PLAYLIST_URL to point to your playlist XML
 * 3. Update the playlist metadata (id, title, description)
 * 4. That's it! The template handles 96%+ track resolution automatically
 */

import { NextResponse } from 'next/server';
import { processPlaylistFeedDiscovery } from '@/lib/feed-discovery';
import { 
  resolvePlaylistItems, 
  parseArtworkUrl, 
  parseRemoteItems,
  type RemoteItem 
} from '@/lib/playlist-resolver';

// TODO: Update this URL to your playlist
const PLAYLIST_URL = 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/YOUR_PLAYLIST.xml';

// Cache configuration
let playlistCache: { data: any; timestamp: number } | null = null;
const CACHE_DURATION = 60000; // 1 minute cache

export async function GET(request: Request) {
  try {
    // TODO: Update playlist name for logging
    console.log('🎵 Fetching YOUR_PLAYLIST...', { 
      userAgent: request.headers.get('user-agent')?.slice(0, 50) 
    });

    // Check cache first (with refresh option)
    const forceRefresh = new URL(request.url).searchParams.has('refresh');
    if (playlistCache && (Date.now() - playlistCache.timestamp) < CACHE_DURATION && !forceRefresh) {
      console.log('⚡ Using cached playlist data');
      return NextResponse.json(playlistCache.data);
    }

    // Fetch the playlist XML
    const response = await fetch(PLAYLIST_URL, {
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

    // Resolve playlist items using the shared resolver
    // This achieves 96%+ resolution rate automatically
    console.log('🔍 Resolving playlist items to actual tracks...');
    const resolvedTracks = await resolvePlaylistItems(remoteItems, {
      sourceName: 'your-playlist', // TODO: Update this identifier
      maxApiResolution: 300,       // Process up to 300 tracks via API
      apiDelay: 50,                // 50ms delay between API calls
      defaultImage: artworkUrl || '/placeholder-podcast.jpg'
    });
    console.log(`✅ Resolved ${resolvedTracks.length} tracks from database and API`);

    // Auto-discover and add unresolved feeds to database
    const unresolvedItems = remoteItems.filter(item => {
      return !resolvedTracks.find(track => track.playlistContext?.itemGuid === item.itemGuid);
    });
    
    if (unresolvedItems.length > 0) {
      console.log(`🔍 Processing ${unresolvedItems.length} unresolved items for feed discovery...`);
      try {
        const addedFeedsCount = await processPlaylistFeedDiscovery(unresolvedItems);
        console.log(`✅ Feed discovery: ${addedFeedsCount} new feeds added to database`);
      } catch (error) {
        console.error('❌ Error during feed discovery:', error);
        // Continue with playlist creation even if feed discovery fails
      }
    }

    // Create a map of resolved tracks by itemGuid for quick lookup
    const resolvedTrackMap = new Map(
      resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
    );

    // Create tracks for ALL remote items, using resolved data when available
    const tracks = remoteItems.map((item, index) => {
      const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

      if (resolvedTrack) {
        // Use real track data
        return {
          id: resolvedTrack.id,
          title: resolvedTrack.title,
          artist: resolvedTrack.artist,
          audioUrl: resolvedTrack.audioUrl || '',
          url: resolvedTrack.audioUrl || '',
          duration: resolvedTrack.duration || 180,
          publishedAt: resolvedTrack.publishedAt || new Date().toISOString(),
          image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          // TODO: Update description
          description: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in YOUR_PLAYLIST`,
          albumTitle: resolvedTrack.albumTitle,
          feedTitle: resolvedTrack.feedTitle,
          guid: resolvedTrack.guid
        };
      } else {
        // Use placeholder data (should be rare with 96%+ resolution)
        return {
          id: `playlist-track-${index + 1}`,
          title: `Music Reference #${index + 1}`,
          // TODO: Update artist
          artist: 'Featured in YOUR_PLAYLIST',
          audioUrl: '',
          url: '',
          duration: 180,
          publishedAt: new Date().toISOString(),
          image: artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          // TODO: Update description
          description: `Music track referenced in YOUR_PLAYLIST - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`
        };
      }
    });

    // Create a single virtual album that represents the playlist
    // TODO: Update all these fields for your playlist
    const playlistAlbum = {
      id: 'your-playlist-id',
      title: 'Your Playlist Title',
      artist: 'Various Artists',
      album: 'Your Playlist Title',
      description: 'Description of your playlist',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg',
      url: PLAYLIST_URL,
      tracks: tracks,
      feedId: 'your-playlist-id',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true, // Mark as playlist card for proper URL generation
      playlistUrl: '/playlist/your-playlist', // TODO: Update URL
      albumUrl: '/album/your-playlist-album', // TODO: Update URL
      playlistContext: {
        source: 'your-playlist',
        originalUrl: PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: remoteItems.length
      }
    };

    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);
    console.log(`📊 Resolution rate: ${Math.floor((resolvedTracks.length / remoteItems.length) * 100)}%`);

    const responseData = {
      success: true,
      albums: [playlistAlbum],
      totalCount: 1,
      playlist: {
        // TODO: Update metadata
        title: 'Your Playlist Title',
        description: 'Description of your playlist',
        author: 'Your Name',
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
    // TODO: Update error message
    console.error('❌ Error fetching YOUR_PLAYLIST:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}