import { NextResponse } from 'next/server';
import { resolveItemGuid } from '@/lib/feed-discovery';
import { autoPopulateFeeds, parseRemoteItemsForFeeds } from '@/lib/auto-populate-feeds';
import { playlistCache } from '@/lib/playlist-cache';
import { prisma } from '@/lib/prisma';

// Increase timeout for this route to 5 minutes
export const maxDuration = 300;

const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

// Persistent cache duration - 90 days for static playlists (manual refresh when needed)
const CACHE_DURATION = 1000 * 60 * 60 * 24 * 90; // 90 days

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
  url?: string; // For compatibility with RSSAlbum type
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
    console.log('🎵 Fetching HGH playlist...', { userAgent: request.headers.get('user-agent')?.slice(0, 50) });

    // Check for force refresh parameter
    const forceRefresh = new URL(request.url).searchParams.has('refresh');
    
    // Check persistent cache first
    if (!forceRefresh && playlistCache.isCacheValid('hgh-playlist', CACHE_DURATION)) {
      const cachedData = playlistCache.getCachedData('hgh-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch the playlist XML
    const response = await fetch(HGH_PLAYLIST_URL, {
      headers: {
        'User-Agent': 'StableKraft-Playlist-Parser/1.0'
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

    console.log('🔍 Resolving playlist items to actual tracks...');
    
    // AUTOMATIC FEED POPULATION - This is now automatic for all playlists!
    const allFeedGuids = parseRemoteItemsForFeeds(xmlText);
    await autoPopulateFeeds(allFeedGuids, 'Homegrown Hits');
    
    // Resolve playlist items to get actual track data from the database
    const resolvedTracks = await resolvePlaylistItems(remoteItems);
    console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

    // Create a map of resolved tracks by itemGuid for quick lookup
    const resolvedTrackMap = new Map(
      resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
    );

    // Create tracks for ALL remote items, using resolved data when available
    const tracksUnsorted = remoteItems.map((item, index) => {
      const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

      if (resolvedTrack) {
        // Use real track data
        return {
          id: resolvedTrack.id,
          title: resolvedTrack.title,
          artist: resolvedTrack.artist,
          audioUrl: resolvedTrack.audioUrl || '',
          url: resolvedTrack.audioUrl || '', // Add url property for compatibility
          duration: resolvedTrack.duration || 180,
          publishedAt: resolvedTrack.publishedAt || new Date().toISOString(),
          image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in Homegrown Hits podcast`,
          albumTitle: resolvedTrack.albumTitle,
          feedTitle: resolvedTrack.feedTitle,
          guid: resolvedTrack.guid
        };
      } else {
        // Use placeholder data
        return {
          id: `hgh-track-${index + 1}`,
          title: `Music Reference #${index + 1}`,
          artist: 'Featured in Homegrown Hits Podcast',
          audioUrl: '',
          url: '', // Add url property for compatibility
          duration: 180,
          publishedAt: new Date().toISOString(),
          image: artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `Music track referenced in Homegrown Hits podcast episode - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`
        };
      }
    });

    // Use tracks in the order they appear in the XML playlist
    const tracks = tracksUnsorted;

    // Create a single virtual album that represents the HGH playlist
    const playlistAlbum = {
      id: 'hgh-playlist',
      title: 'Homegrown Hits Music Playlist',
      artist: 'Various Artists',
      album: 'Homegrown Hits Music Playlist',
      description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg', // Add coverArt field for consistency
      url: HGH_PLAYLIST_URL,
      tracks: tracks,
      feedId: 'hgh-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true, // Mark as playlist card for proper URL generation
      playlistUrl: '/playlist/hgh', // Set the playlist URL
      albumUrl: '/album/homegrown-hits-music-playlist', // Set the album URL for album-style display
      playlistContext: {
        source: 'hgh-playlist',
        originalUrl: HGH_PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: remoteItems.length
      }
    };

    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

    const responseData = {
      success: true,
      albums: [playlistAlbum], // Return as single album
      totalCount: 1,
      playlist: {
        title: 'Homegrown Hits Music Playlist',
        description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
        author: 'ChadF',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };

    // Cache the response
    playlistCache.setCachedData('hgh-playlist', responseData);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching HGH playlist:', error);
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
    // Get unique item GUIDs from the playlist (these map to track.guid)
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 Looking up ${itemGuids.length} unique track GUIDs for ${remoteItems.length} playlist items`);

    // Find tracks in database by GUID
    const tracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      include: {
        Feed: true
      },
      orderBy: [
        { trackOrder: 'asc' },
        { publishedAt: 'asc' },
        { createdAt: 'asc' }
      ]
    });

    console.log(`📊 Found ${tracks.length} matching tracks in database`);

    // Create a map for quick lookup by track GUID
    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: any[] = [];
    const unresolvedItems: RemoteItem[] = [];

    // First pass: resolve items found in database
    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);

      if (track && track.Feed) {
        // Create track object with feed context
        const resolvedTrack: any = {
          id: track.id,
          title: track.title,
          artist: track.artist || track.Feed.artist || 'Unknown Artist',
          audioUrl: track.audioUrl,
          url: track.audioUrl, // Add url property for compatibility
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: track.image || track.Feed.image || '/placeholder-podcast.jpg',
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          feedId: track.Feed.id,
          guid: track.guid,
          // Add playlist context
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: 'hgh-playlist'
          }
        };

        // If audioUrl is missing, mark for API resolution to fill in the gap
        if (!track.audioUrl) {
          resolvedTrack.needsApiResolution = true;
          console.log(`🔍 Track "${track.title}" needs API resolution for missing audioUrl`);
        }

        resolvedTracks.push(resolvedTrack);
      } else {
        unresolvedItems.push(remoteItem);
      }
    }

    console.log(`📊 Found ${resolvedTracks.length} tracks in database, ${unresolvedItems.length} need API resolution`);

    // Second pass: resolve unresolved items using Podcast Index API
    if (unresolvedItems.length > 0) {
      console.log(`🔍 Resolving ${unresolvedItems.length} items via Podcast Index API...`);
      
      for (const remoteItem of unresolvedItems.slice(0, 200)) { // Process more tracks for better resolution
        try {
          const apiResult = await resolveItemGuid(remoteItem.feedGuid, remoteItem.itemGuid);
          
          if (apiResult) {
            const resolvedTrack = {
              id: `api-${remoteItem.itemGuid}`,
              title: apiResult.title || 'Unknown Track',
              artist: apiResult.feedTitle || 'Unknown Artist',
              audioUrl: apiResult.audioUrl || '',
              url: apiResult.audioUrl || '',
              duration: apiResult.duration || 0,
              publishedAt: apiResult.publishedAt?.toISOString() || new Date().toISOString(),
              image: apiResult.image || apiResult.feedImage || '/placeholder-podcast.jpg',
              albumTitle: apiResult.feedTitle,
              feedTitle: apiResult.feedTitle,
              feedId: `api-feed-${remoteItem.feedGuid}`,
              guid: apiResult.guid,
              description: apiResult.description,
              // Add playlist context
              playlistContext: {
                feedGuid: remoteItem.feedGuid,
                itemGuid: remoteItem.itemGuid,
                source: 'hgh-playlist',
                resolvedViaAPI: true
              }
            };

            resolvedTracks.push(resolvedTrack);
            console.log(`✅ API resolved: ${apiResult.title} by ${apiResult.feedTitle}`);
          } else {
            console.log(`⚠️ Could not resolve via API: ${remoteItem.feedGuid}/${remoteItem.itemGuid}`);
          }
        } catch (error) {
          console.error(`❌ Error resolving ${remoteItem.itemGuid}:`, error);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Third pass: Enhance database tracks that need API resolution for missing audioUrls
    const tracksNeedingEnhancement = resolvedTracks.filter(track => track.needsApiResolution);
    if (tracksNeedingEnhancement.length > 0) {
      console.log(`🔗 Enhancing ${tracksNeedingEnhancement.length} database tracks with API data...`);
      
      for (const track of tracksNeedingEnhancement) {
        try {
          const apiResult = await resolveItemGuid(track.playlistContext.feedGuid, track.playlistContext.itemGuid);
          
          if (apiResult && apiResult.audioUrl) {
            // Update the track with API-resolved audio URL
            track.audioUrl = apiResult.audioUrl;
            track.url = apiResult.audioUrl;
            
            // Also enhance other missing fields if available
            if (!track.duration && apiResult.duration) {
              track.duration = apiResult.duration;
            }
            if (!track.image && apiResult.image) {
              track.image = apiResult.image;
            }
            
            console.log(`✅ Enhanced ${track.title} with audio URL: ${apiResult.audioUrl}`);
          }
          
          // Remove the needsApiResolution flag
          delete track.needsApiResolution;
        } catch (error) {
          console.error(`❌ Error enhancing ${track.title}:`, error);
          delete track.needsApiResolution;
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return resolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving playlist items:', error);
    return [];
  }
}