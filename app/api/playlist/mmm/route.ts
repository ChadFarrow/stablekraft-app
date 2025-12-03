import { NextResponse } from 'next/server';
import { processPlaylistFeedDiscovery, resolveItemGuid } from '@/lib/feed-discovery';
import { playlistCache } from '@/lib/playlist-cache';
import { prisma } from '@/lib/prisma';
import { validateDuration } from '@/lib/duration-validation';

// Increase timeout for this route to 5 minutes
export const maxDuration = 300;

const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';
// Force Railway rebuild - v4vRecipient fix

// Persistent cache duration - 6 hours for daily updates
const CACHE_DURATION = 1000 * 60 * 60 * 6; // 6 hours

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  episodeTitle?: string;  // Episode this track belongs to
  episodeId?: string;     // Episode ID for grouping
  episodeIndex?: number;  // Position within episode
}

// Parsed items from XML (episode markers or remote items)
interface ParsedEpisodeMarker {
  type: 'episode';
  title: string;
}

interface ParsedRemoteItem {
  type: 'remoteItem';
  feedGuid: string;
  itemGuid: string;
}

type ParsedPlaylistItem = ParsedEpisodeMarker | ParsedRemoteItem;

// Episode group for API response
interface EpisodeGroup {
  id: string;
  title: string;
  trackCount: number;
  tracks: any[];
  index: number;
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

function parsePlaylistLink(xmlText: string): string | null {
  // Parse the <link>...</link> element
  const linkRegex = /<link>(.*?)<\/link>/;
  const match = xmlText.match(linkRegex);

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

// Parse playlist with episode markers - extracts both episode markers and remote items in order
function parsePlaylistWithEpisodes(xmlText: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];

  // Combined regex to match both episode markers and remote items in document order
  const combinedRegex = /<podcast:txt\s+purpose="episode">([^<]*)<\/podcast:txt>|<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*\/?>/g;

  let match;
  while ((match = combinedRegex.exec(xmlText)) !== null) {
    if (match[1] !== undefined) {
      // Episode marker - match[1] is the episode title
      items.push({
        type: 'episode',
        title: match[1].trim()
      });
    } else if (match[2] && match[3]) {
      // Remote item - match[2] is feedGuid, match[3] is itemGuid
      items.push({
        type: 'remoteItem',
        feedGuid: match[2],
        itemGuid: match[3]
      });
    }
  }

  return items;
}

// Generate a stable ID from episode title
function generateEpisodeId(title: string): string {
  return 'ep-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

// Group parsed items by episode
function groupItemsByEpisode(parsedItems: ParsedPlaylistItem[]): {
  episodes: { title: string; remoteItems: RemoteItem[] }[];
  ungroupedItems: RemoteItem[];
  hasEpisodeMarkers: boolean;
} {
  const episodes: { title: string; remoteItems: RemoteItem[] }[] = [];
  const ungroupedItems: RemoteItem[] = [];
  let currentEpisode: { title: string; remoteItems: RemoteItem[] } | null = null;
  let foundEpisodeMarker = false;

  for (const item of parsedItems) {
    if (item.type === 'episode') {
      foundEpisodeMarker = true;
      // Start new episode group
      if (currentEpisode && currentEpisode.remoteItems.length > 0) {
        episodes.push(currentEpisode);
      }
      currentEpisode = {
        title: item.title,
        remoteItems: []
      };
    } else if (item.type === 'remoteItem') {
      const remoteItem: RemoteItem = {
        feedGuid: item.feedGuid,
        itemGuid: item.itemGuid
      };

      if (currentEpisode) {
        // Add episode context to the remote item
        remoteItem.episodeTitle = currentEpisode.title;
        remoteItem.episodeId = generateEpisodeId(currentEpisode.title);
        remoteItem.episodeIndex = currentEpisode.remoteItems.length;
        currentEpisode.remoteItems.push(remoteItem);
      } else {
        // Track before any episode marker
        ungroupedItems.push(remoteItem);
      }
    }
  }

  // Push final episode if it has tracks
  if (currentEpisode && currentEpisode.remoteItems.length > 0) {
    episodes.push(currentEpisode);
  }

  return {
    episodes,
    ungroupedItems,
    hasEpisodeMarkers: foundEpisodeMarker
  };
}

export async function GET(request: Request) {
  try {
    console.log('🎵 Fetching MMM playlist...', { userAgent: request.headers.get('user-agent')?.slice(0, 50) });

    // Check for force refresh parameter
    const forceRefresh = new URL(request.url).searchParams.has('refresh');
    
    // Check persistent cache first
    if (!forceRefresh && playlistCache.isCacheValid('mmm-playlist', CACHE_DURATION)) {
      const cachedData = playlistCache.getCachedData('mmm-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch the playlist XML
    const response = await fetch(MMM_PLAYLIST_URL, {
      headers: {
        'User-Agent': 'StableKraft-Playlist-Parser/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }

    const xmlText = await response.text();
    console.log('📄 Fetched playlist XML, length:', xmlText.length);

    // Parse the XML to extract remote items, artwork, and playlist link
    const artworkUrl = parseArtworkUrl(xmlText);
    const playlistLink = parsePlaylistLink(xmlText);
    console.log('🎨 Found artwork URL:', artworkUrl);
    console.log('🔗 Found playlist link:', playlistLink);

    // Parse playlist with episode markers
    const parsedItems = parsePlaylistWithEpisodes(xmlText);
    const { episodes: episodeGroups, ungroupedItems, hasEpisodeMarkers } = groupItemsByEpisode(parsedItems);

    // Flatten all remote items for resolution (preserving episode context)
    const remoteItems: RemoteItem[] = [
      ...ungroupedItems,
      ...episodeGroups.flatMap(ep => ep.remoteItems)
    ];

    console.log('📋 Found remote items:', remoteItems.length);
    console.log('📺 Found episode markers:', hasEpisodeMarkers ? episodeGroups.length : 0);
    if (hasEpisodeMarkers) {
      console.log('📺 Episodes:', episodeGroups.map(e => `"${e.title}" (${e.remoteItems.length} tracks)`).join(', '));
    }

    // Resolve playlist items to get actual track data from the database
    console.log('🔍 Resolving playlist items to actual tracks...');
    const resolvedTracks = await resolvePlaylistItems(remoteItems);
    console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

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
    const tracksAll = remoteItems.map((item, index) => {
      const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

      if (resolvedTrack) {
        // Use real track data with episode context
        return {
          id: resolvedTrack.id,
          title: resolvedTrack.title,
          artist: resolvedTrack.artist,
          audioUrl: resolvedTrack.audioUrl || '',
          startTime: 0,
          endTime: validateDuration(resolvedTrack.duration, resolvedTrack.title) || 180,
          duration: validateDuration(resolvedTrack.duration, resolvedTrack.title) || 180,
          source: 'database',
          image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in Mutton, Mead & Music podcast`,
          albumTitle: resolvedTrack.albumTitle,
          feedTitle: resolvedTrack.feedTitle,
          guid: resolvedTrack.guid,
          v4vRecipient: resolvedTrack.v4vRecipient, // V4V payment data
          v4vValue: resolvedTrack.v4vValue,
          resolved: true,
          // Episode grouping data
          episodeTitle: item.episodeTitle || 'Mutton, Mead & Music',
          episodeId: item.episodeId,
          episodeIndex: item.episodeIndex
        };
      } else {
        // Return null for unresolved tracks (will be filtered out)
        return null;
      }
    });

    // Filter out null entries and tracks without audio URLs
    const tracks = tracksAll.filter((track): track is NonNullable<typeof track> =>
      track !== null && track.audioUrl && track.audioUrl.length > 0 && !track.audioUrl.includes('placeholder')
    );

    console.log(`🎯 Filtered tracks: ${tracksAll.length} -> ${tracks.length} (removed ${tracksAll.length - tracks.length} tracks without audio)`);

    // Build episode objects from resolved tracks
    const episodes: EpisodeGroup[] = hasEpisodeMarkers
      ? episodeGroups.map((group, index) => {
          const episodeId = generateEpisodeId(group.title);
          const episodeTracks = tracks.filter((t: any) => t.episodeId === episodeId);
          return {
            id: episodeId,
            title: group.title,
            trackCount: episodeTracks.length,
            tracks: episodeTracks,
            index
          };
        }).filter(ep => ep.trackCount > 0) // Only include episodes with resolved tracks
      : [];

    if (hasEpisodeMarkers) {
      console.log(`📺 Built ${episodes.length} episodes with resolved tracks`);
    }

    // Create a single virtual album that represents the MMM playlist
    const playlistAlbum = {
      id: 'mmm-playlist',
      title: 'Mutton, Mead & Music Playlist',
      artist: 'Various Artists',
      album: 'Mutton, Mead & Music Playlist',
      description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg', // Add coverArt field for consistency
      url: MMM_PLAYLIST_URL,
      link: playlistLink, // Website link from the playlist feed
      tracks: tracks,
      episodes: episodes,                    // Episode grouping data
      hasEpisodeMarkers: hasEpisodeMarkers,  // Flag for frontend
      feedId: 'mmm-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true, // Mark as playlist card for proper URL generation
      playlistUrl: '/playlist/mmm', // Set the playlist URL
      albumUrl: '/album/modern-music-movements-playlist', // Set the album URL for album-style display
      playlistContext: {
        source: 'mmm-playlist',
        originalUrl: MMM_PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: remoteItems.length,
        totalEpisodes: episodes.length
      }
    };

    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks and ${episodes.length} episodes`);

    const responseData = {
      success: true,
      albums: [playlistAlbum], // Return as single album
      totalCount: 1,
      playlist: {
        title: 'Mutton, Mead & Music Playlist',
        description: 'Curated playlist from Mutton, Mead & Music podcast featuring Value4Value independent artists',
        author: 'ChadF',
        totalItems: 1,
        items: [playlistAlbum]
      }
    };

    // Cache the response to persistent storage
    playlistCache.setCachedData('mmm-playlist', responseData);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching MMM playlist:', error);
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
    console.log(`🔍 Sample playlist GUIDs: ${itemGuids.slice(0, 10).join(', ')}`);
    console.log(`🔍 Sample found track GUIDs: ${tracks.slice(0, 10).map(t => t.guid).join(', ')}`);
    
    // Debug: Check if any missing GUIDs exist in database without feed restrictions
    const sampleMissingGuids = itemGuids.slice(5, 10);
    const unrestricted = await prisma.track.findMany({
      where: { guid: { in: sampleMissingGuids } }
    });
    console.log(`🔍 Found ${unrestricted.length} of ${sampleMissingGuids.length} sample GUIDs without feed restrictions`);

    // Create a map for quick lookup by track GUID
    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: any[] = [];
    const unresolvedItems: RemoteItem[] = [];

    // First pass: resolve items found in database
    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);

      if (track && track.Feed) {
        // Create track object with feed context
        const resolvedTrack = {
          id: track.id,
          title: track.title,
          artist: track.artist || (track.Feed.artist === 'Unresolved GUID' ? track.Feed.title : track.Feed.artist) || 'Unknown Artist',
          audioUrl: track.audioUrl,
          url: track.audioUrl, // Add url property for compatibility
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: track.image || track.Feed.image || '/placeholder-podcast.jpg',
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          feedId: track.Feed.id,
          guid: track.guid,
          v4vRecipient: track.v4vRecipient, // Include V4V payment data
          v4vValue: track.v4vValue,
          // Add playlist context
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: 'mmm-playlist'
          }
        };

        resolvedTracks.push(resolvedTrack);
      } else {
        unresolvedItems.push(remoteItem);
      }
    }

    console.log(`📊 Found ${resolvedTracks.length} tracks in database, ${unresolvedItems.length} need API resolution`);

    // Second pass: resolve unresolved items using Podcast Index API
    // RE-ENABLED: Database is empty, need to populate it
    if (unresolvedItems.length > 0) {
      console.log(`🔍 Resolving ${unresolvedItems.length} items via Podcast Index API...`);
      
      // Process more items for better resolution
      let processedCount = 0;
      const maxToProcess = Math.min(200, unresolvedItems.length); // Process max 200 items via API for better resolution
      
      for (const remoteItem of unresolvedItems.slice(0, maxToProcess)) {
        let apiResult = null;
        let retryCount = 0;
        const maxRetries = 2;
        
        // Try API resolution with retries
        while (!apiResult && retryCount < maxRetries) {
          try {
            apiResult = await resolveItemGuid(remoteItem.feedGuid, remoteItem.itemGuid);
            
            if (!apiResult) {
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`🔄 Retry ${retryCount}/${maxRetries} for ${remoteItem.itemGuid}`);
                await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause before retry
              } else {
                console.log(`⚠️ All approaches failed for item ${remoteItem.itemGuid}. Max retries (${maxRetries}) reached.`);
                break; // Exit retry loop after max retries
              }
            }
          } catch (error) {
            retryCount++;
            console.log(`❌ Retry ${retryCount}/${maxRetries} failed for ${remoteItem.itemGuid}:`, error);
            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 200)); // Longer pause on error
            } else {
              console.log(`⚠️ Max retries reached due to errors for ${remoteItem.itemGuid}`);
              break;
            }
          }
        }
        
        try {
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
              v4vRecipient: apiResult.v4vRecipient || null, // Include V4V payment data from API
              v4vValue: apiResult.v4vValue || null,
              // Add playlist context
              playlistContext: {
                feedGuid: remoteItem.feedGuid,
                itemGuid: remoteItem.itemGuid,
                source: 'mmm-playlist',
                resolvedViaAPI: true
              }
            };

            resolvedTracks.push(resolvedTrack);
            console.log(`✅ API resolved: ${apiResult.title} by ${apiResult.feedTitle}`);
          } else {
            // Add placeholder for unresolved item to maintain full playlist
            const placeholderTrack = {
              id: `placeholder-${remoteItem.itemGuid}`,
              title: `Music Track (${remoteItem.itemGuid.slice(-8)})`,
              artist: 'Featured in Modern Music Movements',
              audioUrl: '',
              url: '',
              duration: 180,
              publishedAt: new Date().toISOString(),
              image: '/placeholder-podcast.jpg',
              albumTitle: 'Modern Music Movements Playlist',
              feedTitle: 'Modern Music Movements',
              feedId: `placeholder-feed-${remoteItem.feedGuid}`,
              guid: remoteItem.itemGuid,
              description: `Music track referenced in Modern Music Movements podcast - Feed ID: ${remoteItem.feedGuid} | Item ID: ${remoteItem.itemGuid}`,
              // Add playlist context
              playlistContext: {
                feedGuid: remoteItem.feedGuid,
                itemGuid: remoteItem.itemGuid,
                source: 'mmm-playlist',
                resolvedViaAPI: true,
                isPlaceholder: true
              }
            };
            
            resolvedTracks.push(placeholderTrack);
            console.log(`📝 Added placeholder for unresolved: ${remoteItem.feedGuid}/${remoteItem.itemGuid}`);
          }
          
          processedCount++;
          // Progress update every 50 tracks for better visibility (processing more items now)
          if (processedCount % 50 === 0) {
            const dbResolvedCount = resolvedTracks.filter(t => !t.playlistContext?.resolvedViaAPI).length;
            const apiResolvedCount = resolvedTracks.filter(t => t.playlistContext?.resolvedViaAPI && !t.isPlaceholder).length;
            const placeholderCount = resolvedTracks.filter(t => t.playlistContext?.resolvedViaAPI && t.isPlaceholder).length;
            const totalResolved = dbResolvedCount + apiResolvedCount + placeholderCount;
            const resolutionRate = ((totalResolved / remoteItems.length) * 100).toFixed(1);
            
            console.log(`📊 Resolution Progress: ${processedCount}/${maxToProcess} API calls (${((processedCount/maxToProcess)*100).toFixed(1)}%)`);
            console.log(`📊 Current Resolution: ${totalResolved}/${remoteItems.length} tracks (${resolutionRate}%) | DB: ${dbResolvedCount} | API: ${apiResolvedCount} | Placeholders: ${placeholderCount}`);
          }
        } catch (error) {
          console.error(`❌ Error resolving ${remoteItem.itemGuid}:`, error);
        }
        
        // Reduce delay to 5ms for faster response
        // Remove delay for faster processing
      }
    }

    // Final resolution statistics
    const dbResolvedCount = resolvedTracks.filter(t => !t.playlistContext?.resolvedViaAPI).length;
    const apiResolvedCount = resolvedTracks.filter(t => t.playlistContext?.resolvedViaAPI && !t.isPlaceholder).length;
    const placeholderCount = resolvedTracks.filter(t => t.playlistContext?.resolvedViaAPI && t.isPlaceholder).length;
    const totalResolved = dbResolvedCount + apiResolvedCount + placeholderCount;
    const finalResolutionRate = ((totalResolved / remoteItems.length) * 100).toFixed(1);
    
    console.log(`🎯 FINAL MMM RESOLUTION STATISTICS:`);
    console.log(`📊 Total Tracks: ${remoteItems.length}`);
    console.log(`📊 Database Resolved: ${dbResolvedCount} (${((dbResolvedCount/remoteItems.length)*100).toFixed(1)}%)`);
    console.log(`📊 API Resolved: ${apiResolvedCount} (${((apiResolvedCount/remoteItems.length)*100).toFixed(1)}%)`);
    console.log(`📊 Placeholders: ${placeholderCount} (${((placeholderCount/remoteItems.length)*100).toFixed(1)}%)`);
    console.log(`📊 TOTAL RESOLUTION: ${totalResolved}/${remoteItems.length} (${finalResolutionRate}%)`);

    // Return all successfully resolved tracks (database + API resolved, excluding placeholders)
    const successfullyResolvedTracks = resolvedTracks.filter(t => !t.playlistContext?.isPlaceholder);
    console.log(`🎯 Returning ${successfullyResolvedTracks.length} successfully resolved tracks (${resolvedTracks.filter(t => !t.playlistContext?.resolvedViaAPI).length} from DB, ${resolvedTracks.filter(t => t.playlistContext?.resolvedViaAPI && !t.playlistContext?.isPlaceholder).length} from API)`);
    return successfullyResolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving playlist items:', error);
    return [];
  }
}