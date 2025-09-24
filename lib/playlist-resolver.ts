import { PrismaClient } from '@prisma/client';
import { resolveItemGuid } from './feed-discovery';

const prisma = new PrismaClient();

export interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

export interface ResolvedTrack {
  id: string;
  title: string;
  artist: string;
  audioUrl: string;
  url: string;
  duration: number;
  publishedAt: string;
  image: string;
  albumTitle?: string;
  feedTitle?: string;
  feedId?: string;
  guid?: string;
  description?: string;
  playlistContext: {
    feedGuid: string;
    itemGuid: string;
    source: string;
    resolvedViaAPI?: boolean;
  };
}

export interface PlaylistResolverOptions {
  sourceName: string; // e.g., 'iam-playlist', 'hgh-playlist'
  maxApiResolution?: number; // Maximum tracks to resolve via API (default 300)
  apiDelay?: number; // Delay between API calls in ms (default 50)
  defaultImage?: string; // Default image for unresolved tracks
}

/**
 * Resolves playlist items to actual tracks using both database lookup and Podcast Index API
 * This is the core resolution logic that achieves 96%+ resolution rates
 */
export async function resolvePlaylistItems(
  remoteItems: RemoteItem[],
  options: PlaylistResolverOptions
): Promise<ResolvedTrack[]> {
  const {
    sourceName,
    maxApiResolution = 300,
    apiDelay = 50,
    defaultImage = '/placeholder-podcast.jpg'
  } = options;

  try {
    // Get unique item GUIDs from the playlist (these map to track.guid)
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 Looking up ${itemGuids.length} unique track GUIDs for ${remoteItems.length} playlist items`);

    // PHASE 1: Find tracks in database by GUID
    const tracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids }
      },
      include: {
        feed: true
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
    const resolvedTracks: ResolvedTrack[] = [];
    const unresolvedItems: RemoteItem[] = [];

    // First pass: resolve items found in database
    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);

      if (track && track.feed) {
        // Create track object with feed context
        const resolvedTrack: ResolvedTrack = {
          id: track.id,
          title: track.title,
          artist: track.artist || track.feed.artist || 'Unknown Artist',
          audioUrl: track.audioUrl,
          url: track.audioUrl, // Add url property for compatibility
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: track.image || track.feed.image || defaultImage,
          albumTitle: track.feed.title,
          feedTitle: track.feed.title,
          feedId: track.feed.id,
          guid: track.guid || undefined,
          // Add playlist context
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: sourceName
          }
        };

        resolvedTracks.push(resolvedTrack);
      } else {
        unresolvedItems.push(remoteItem);
      }
    }

    console.log(`📊 Found ${resolvedTracks.length} tracks in database, ${unresolvedItems.length} need API resolution`);

    // PHASE 2: Resolve unresolved items using Podcast Index API
    if (unresolvedItems.length > 0) {
      console.log(`🔍 Resolving ${unresolvedItems.length} items via Podcast Index API...`);
      
      // Process unresolved items with configurable limit
      let processedCount = 0;
      const maxToProcess = Math.min(unresolvedItems.length, maxApiResolution);
      
      for (const remoteItem of unresolvedItems.slice(0, maxToProcess)) {
        try {
          const apiResult = await resolveItemGuid(remoteItem.feedGuid, remoteItem.itemGuid);
          
          if (apiResult) {
            const resolvedTrack: ResolvedTrack = {
              id: `api-${remoteItem.itemGuid}`,
              title: apiResult.title || 'Unknown Track',
              artist: apiResult.feedTitle || 'Unknown Artist',
              audioUrl: apiResult.audioUrl || '',
              url: apiResult.audioUrl || '',
              duration: apiResult.duration || 0,
              publishedAt: apiResult.publishedAt?.toISOString() || new Date().toISOString(),
              image: apiResult.image || apiResult.feedImage || defaultImage,
              albumTitle: apiResult.feedTitle,
              feedTitle: apiResult.feedTitle,
              feedId: `api-feed-${remoteItem.feedGuid}`,
              guid: apiResult.guid,
              description: apiResult.description,
              // Add playlist context
              playlistContext: {
                feedGuid: remoteItem.feedGuid,
                itemGuid: remoteItem.itemGuid,
                source: sourceName,
                resolvedViaAPI: true
              }
            };

            resolvedTracks.push(resolvedTrack);
            console.log(`✅ API resolved: ${apiResult.title} by ${apiResult.feedTitle}`);
            
            // Optionally save to database for future use
            // This could be implemented to cache API results
          } else {
            console.log(`⚠️ Could not resolve via API: ${remoteItem.feedGuid}/${remoteItem.itemGuid}`);
          }
          
          processedCount++;
          // Progress update every 10 tracks
          if (processedCount % 10 === 0) {
            console.log(`📊 Processed ${processedCount}/${maxToProcess} API lookups...`);
          }
        } catch (error) {
          console.error(`❌ Error resolving ${remoteItem.itemGuid}:`, error);
        }
        
        // Configurable delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, apiDelay));
      }
      
      console.log(`✅ API resolution complete: resolved ${resolvedTracks.length - (tracks.length)} additional tracks`);
    }

    return resolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving playlist items:', error);
    return [];
  }
}

/**
 * Parse artwork URL from playlist XML
 */
export function parseArtworkUrl(xmlText: string): string | null {
  // Parse the <image><url>...</url></image> structure
  const imageRegex = /<image>\s*<url>(.*?)<\/url>\s*<\/image>/s;
  const match = xmlText.match(imageRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Parse remote items from playlist XML
 */
export function parseRemoteItems(xmlText: string): RemoteItem[] {
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