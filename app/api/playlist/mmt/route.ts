import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { playlistCache } from '@/lib/playlist-cache';
import { headers } from 'next/headers';
import { autoPopulateFeeds, parseRemoteItemsForFeeds } from '@/lib/auto-populate-feeds';

// Increase timeout for this route to 5 minutes
export const maxDuration = 300;

const MMT_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml';
const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Generate required headers for Podcast Index API
async function generateHeaders(apiKey: string, apiSecret: string) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft-MMT-Resolver/1.0'
  };
}

// Resolve item using Podcast Index API
async function resolveItemGuid(feedGuid: string, itemGuid: string) {
  try {
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return null;
    }

    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    // Try feed-based lookup first
    const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (feedResponse.ok) {
      const feedData = await feedResponse.json();
      let feed = null;
      
      if (feedData.status === 'true') {
        feed = feedData.feed || (feedData.feeds && feedData.feeds[0]);
      }
      
      if (feed && feed.id) {
        // Get episodes from this feed
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feed.id}&max=1000`, {
          headers
        });
        
        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();
          if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
            const episode = episodesData.items.find((ep: any) => ep.guid === itemGuid);
            if (episode) {
              return {
                guid: episode.guid,
                title: episode.title,
                description: episode.description || '',
                audioUrl: episode.enclosureUrl || '',
                duration: episode.duration || 0,
                image: episode.image || feed.image || '/placeholder-podcast.jpg',
                publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),
                feedGuid: feedGuid,
                feedTitle: feed.title,
                feedImage: feed.image,
                feedUrl: feed.url,
                method: 'feed_lookup'
              };
            }
          }
        }
      }
    }
    
    // Try direct episode lookup as fallback
    const episodeResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${encodeURIComponent(itemGuid)}`, {
      headers
    });
    
    if (episodeResponse.ok) {
      const episodeData = await episodeResponse.json();
      if (episodeData.status === 'true' && episodeData.episode) {
        const episode = episodeData.episode;
        return {
          guid: episode.guid,
          title: episode.title,
          description: episode.description || '',
          audioUrl: episode.enclosureUrl || '',
          duration: episode.duration || 0,
          image: episode.image || '/placeholder-podcast.jpg',
          publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),
          feedGuid: episode.feedGuid || feedGuid,
          feedTitle: episode.feedTitle || 'Unknown Feed',
          feedImage: episode.feedImage,
          feedUrl: episode.feedUrl,
          method: 'direct_lookup'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error resolving ${itemGuid}:`, error);
    return null;
  }
}

async function fetchPlaylistXML(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status}`);
  }
  return await response.text();
}

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
  episodeTitle?: string;
  episodeId?: string;
  episodeIndex?: number;
}

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

interface EpisodeGroup {
  id: string;
  title: string;
  trackCount: number;
  tracks: any[];
  index: number;
}

function parseRemoteItems(xmlText: string) {
  const remoteItems: Array<{feedGuid: string, itemGuid: string}> = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;

  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    remoteItems.push({
      feedGuid: match[1],
      itemGuid: match[2]
    });
  }

  return remoteItems;
}

function parsePlaylistWithEpisodes(xmlText: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];
  const combinedRegex = /<podcast:txt\s+purpose="episode">([^<]*)<\/podcast:txt>|<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*\/?>/g;

  let match;
  while ((match = combinedRegex.exec(xmlText)) !== null) {
    if (match[1] !== undefined) {
      items.push({ type: 'episode', title: match[1].trim() });
    } else if (match[2] && match[3]) {
      items.push({ type: 'remoteItem', feedGuid: match[2], itemGuid: match[3] });
    }
  }
  return items;
}

function generateEpisodeId(title: string): string {
  return 'ep-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

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
      if (currentEpisode && currentEpisode.remoteItems.length > 0) {
        episodes.push(currentEpisode);
      }
      currentEpisode = { title: item.title, remoteItems: [] };
    } else if (item.type === 'remoteItem') {
      const remoteItem: RemoteItem = { feedGuid: item.feedGuid, itemGuid: item.itemGuid };
      if (currentEpisode) {
        remoteItem.episodeTitle = currentEpisode.title;
        remoteItem.episodeId = generateEpisodeId(currentEpisode.title);
        remoteItem.episodeIndex = currentEpisode.remoteItems.length;
        currentEpisode.remoteItems.push(remoteItem);
      } else {
        ungroupedItems.push(remoteItem);
      }
    }
  }

  if (currentEpisode && currentEpisode.remoteItems.length > 0) {
    episodes.push(currentEpisode);
  }

  return { episodes, ungroupedItems, hasEpisodeMarkers: foundEpisodeMarker };
}

export async function GET(request: NextRequest) {
  try {
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') || 'unknown';
    
    console.log('🎵 Fetching MMT playlist...', { userAgent });

    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    // FAST PATH: Try database first (instant, no XML fetch needed)
    if (!refresh) {
      try {
        const dbPlaylist = await prisma.systemPlaylist.findUnique({
          where: { id: 'mmt' },
          include: {
            tracks: {
              orderBy: { position: 'asc' },
              include: {
                track: {
                  select: {
                    id: true, guid: true, title: true, artist: true, album: true,
                    audioUrl: true, duration: true, publishedAt: true, image: true,
                    v4vRecipient: true, v4vValue: true,
                    Feed: { select: { id: true, title: true, artist: true, image: true } }
                  }
                }
              }
            }
          }
        });
        if (dbPlaylist && dbPlaylist.tracks.length > 0) {
          console.log(`⚡ Using database playlist (${dbPlaylist.tracks.length} tracks)`);
          const tracks = dbPlaylist.tracks.map((pt, index) => ({
            id: pt.track.id, title: pt.track.title,
            artist: pt.track.artist || pt.track.Feed?.artist || 'Unknown Artist',
            album: pt.track.album || pt.track.Feed?.title || 'Unknown Album',
            audioUrl: pt.track.audioUrl, duration: pt.track.duration || 0,
            image: pt.track.image || pt.track.Feed?.image,
            publishedAt: pt.track.publishedAt?.toISOString(),
            v4vRecipient: pt.track.v4vRecipient, v4vValue: pt.track.v4vValue,
            feedGuid: pt.track.guid, itemGuid: pt.track.guid, index,
            playlistContext: { episodeTitle: pt.episodeId, itemGuid: pt.track.guid, position: pt.position }
          }));
          const playlistAlbum = {
            id: 'mmt-playlist', title: dbPlaylist.title, artist: 'ChadF',
            description: dbPlaylist.description, image: dbPlaylist.artwork, tracks,
            episodes: [], hasEpisodeMarkers: false, totalTracks: tracks.length,
            publishedAt: dbPlaylist.updatedAt.toISOString(), isPlaylistCard: true, playlistUrl: '/playlist/mmt',
          };
          return NextResponse.json({
            success: true, albums: [playlistAlbum], totalCount: 1, fromDatabase: true,
            playlist: { title: dbPlaylist.title, items: [playlistAlbum] }
          });
        }
      } catch (dbError) {
        console.log('⚠️ Database lookup failed, falling back to cache/fetch:', dbError);
      }
    }

    // Check cache first (unless refresh requested)
    if (!refresh && playlistCache.isCacheValid('mmt-playlist')) {
      const cachedData = playlistCache.getCachedData('mmt-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch playlist XML
    const xmlText = await fetchPlaylistXML(MMT_PLAYLIST_URL);
    console.log(`📄 Fetched playlist XML, length: ${xmlText.length}`);

    // Parse playlist with episode markers
    const parsedItems = parsePlaylistWithEpisodes(xmlText);
    const { episodes: groupedEpisodes, ungroupedItems, hasEpisodeMarkers } = groupItemsByEpisode(parsedItems);

    // Collect all remote items (from episodes + ungrouped)
    const allRemoteItems: RemoteItem[] = [];
    groupedEpisodes.forEach(ep => {
      ep.remoteItems.forEach(item => allRemoteItems.push(item));
    });
    ungroupedItems.forEach(item => allRemoteItems.push(item));

    console.log(`📋 Found ${allRemoteItems.length} remote items in ${groupedEpisodes.length} episodes (${hasEpisodeMarkers ? 'with' : 'without'} episode markers)`);
    
    // Extract artwork URL
    const artworkMatch = xmlText.match(/<itunes:image[^>]*href="([^"]*)"[^>]*>/);
    const artworkUrl = artworkMatch ? artworkMatch[1] : 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/MMT-playlist-art.webp';
    console.log(`🎨 Found artwork URL: ${artworkUrl}`);
    
    // Extract playlist link
    const linkMatch = xmlText.match(/<link>(.*?)<\/link>/);
    const playlistLink = linkMatch ? linkMatch[1].trim() : null;
    console.log(`🔗 Found playlist link: ${playlistLink}`);

    console.log('🔍 Resolving playlist items to actual tracks...');
    
    // AUTOMATIC FEED POPULATION - This is now automatic for all playlists!
    const allFeedGuids = parseRemoteItemsForFeeds(xmlText);
    await autoPopulateFeeds(allFeedGuids, 'MMT');
    
    // Get unique track GUIDs for database lookup
    const itemGuids = allRemoteItems.map(item => item.itemGuid);
    const uniqueItemGuids = [...new Set(itemGuids)];

    console.log(`🔍 Looking up ${uniqueItemGuids.length} unique track GUIDs for ${allRemoteItems.length} playlist items`);
    
    // Database lookup first
    const dbTracks = await prisma.track.findMany({
      where: {
        guid: { in: uniqueItemGuids }
      },
      include: {
        Feed: true
      }
    });
    
    console.log(`📊 Found ${dbTracks.length} matching tracks in database`);
    
    // Create lookup map for database tracks
    const dbTrackMap = new Map();
    dbTracks.forEach(track => {
      dbTrackMap.set(track.guid, track);
    });

    // Log sample data for debugging
    console.log(`🔍 Sample playlist GUIDs: ${itemGuids.slice(0, 10).join(', ')}`);
    console.log(`🔍 Sample found track GUIDs: ${dbTracks.slice(0, 10).map(t => t.guid).join(', ')}`);

    // Process tracks in parallel batches for better performance
    const batchSize = 10; // Process 10 tracks at a time to avoid overwhelming API
    const trackBatches = [];

    for (let i = 0; i < allRemoteItems.length; i += batchSize) {
      trackBatches.push(allRemoteItems.slice(i, i + batchSize));
    }
    
    const tracksAll = [];
    let processedCount = 0;
    
    for (const batch of trackBatches) {
      console.log(`🔄 Processing batch ${Math.floor(processedCount / batchSize) + 1}/${trackBatches.length} (${batch.length} tracks)`);
      
      const batchTracks = await Promise.all(batch.map(async (item) => {
        // Check database first
        const dbTrack = dbTrackMap.get(item.itemGuid);
        if (dbTrack && dbTrack.audioUrl && dbTrack.audioUrl.length > 0) {
          return {
            id: dbTrack.id,
            title: dbTrack.title,
            artist: dbTrack.artist || dbTrack.feed?.title || 'Unknown Artist',
            audioUrl: dbTrack.audioUrl,
            startTime: dbTrack.startTime || 0,
            endTime: dbTrack.endTime || dbTrack.duration || 0,
            duration: dbTrack.duration || 0,
            source: 'database',
            image: dbTrack.image || dbTrack.feed?.image || artworkUrl || '/placeholder-podcast.jpg',
            feedGuid: item.feedGuid,
            itemGuid: item.itemGuid,
            description: dbTrack.description || `${dbTrack.title} by ${dbTrack.artist || dbTrack.feed?.title} - Featured in Mike's Mix Tape podcast`,
            albumTitle: dbTrack.feed?.title || 'Unknown Album',
            feedTitle: dbTrack.feed?.title || 'Unknown Feed',
            guid: dbTrack.guid,
            v4vRecipient: dbTrack.v4vRecipient,
            v4vValue: dbTrack.v4vValue,
            resolved: true,
            // Episode context
            episodeId: item.episodeId,
            episodeTitle: item.episodeTitle,
            episodeIndex: item.episodeIndex
          };
        }

        // For missing tracks, skip API resolution for now to improve performance
        // Return placeholder that can be resolved lazily later
        return {
          id: `placeholder-${item.itemGuid}`,
          title: `Loading... (${item.itemGuid.slice(-8)})`,
          artist: 'Resolving...',
          audioUrl: '',
          startTime: 0,
          endTime: 0,
          duration: 0,
          source: 'placeholder',
          image: artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `Music track from Mike's Mix Tape podcast - resolving metadata...`,
          albumTitle: 'Mike\'s Mix Tape',
          feedTitle: 'Mike\'s Mix Tape',
          guid: item.itemGuid,
          resolved: false,
          needsResolution: true, // Flag for lazy loading
          // Episode context
          episodeId: item.episodeId,
          episodeTitle: item.episodeTitle,
          episodeIndex: item.episodeIndex
        };
      }));
      
      tracksAll.push(...batchTracks);
      processedCount += batch.length;
      
      // Small delay between batches to be nice to APIs
      if (trackBatches.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Include both resolved and placeholder tracks, but prioritize resolved ones
    const resolvedTracks = tracksAll.filter(track => 
      track.audioUrl && track.audioUrl.length > 0 && !track.audioUrl.includes('placeholder')
    );
    
    const placeholderTracks = tracksAll.filter(track => track.needsResolution);
    
    // Combine tracks: resolved first, then placeholders up to a reasonable limit
    const maxPlaceholders = Math.min(placeholderTracks.length, 50); // Limit placeholders
    const tracks = [...resolvedTracks, ...placeholderTracks.slice(0, maxPlaceholders)];

    console.log(`🎯 Track processing results: ${resolvedTracks.length} resolved, ${placeholderTracks.length} placeholders, showing ${tracks.length} total`);

    // Build episode groups with resolved tracks
    const episodes: EpisodeGroup[] = hasEpisodeMarkers ? groupedEpisodes.map((ep, index) => {
      // Get resolved tracks for this episode
      const episodeTracks = tracks.filter(t => t.episodeId === generateEpisodeId(ep.title));
      return {
        id: generateEpisodeId(ep.title),
        title: ep.title,
        trackCount: episodeTracks.length,
        tracks: episodeTracks,
        index
      };
    }).filter(ep => ep.trackCount > 0) : [];

    console.log(`📺 Built ${episodes.length} episode groups with tracks`);

    // Create a single virtual album that represents the MMT playlist
    const playlistAlbum = {
      id: 'mmt-playlist',
      title: "Mike's Mix Tape Music Playlist",
      artist: 'Various Artists',
      album: "Mike's Mix Tape Music Playlist",
      description: 'Curated playlist from Mike\'s Mix Tape podcast featuring Value4Value independent artists',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg',
      url: MMT_PLAYLIST_URL,
      link: playlistLink, // Website link from the playlist feed
      tracks: tracks,
      feedId: 'mmt-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true,
      playlistUrl: '/playlist/mmt',
      albumUrl: '/album/mmt-playlist',
      // Episode grouping
      episodes,
      hasEpisodeMarkers,
      playlistContext: {
        source: 'mmt-playlist',
        originalUrl: MMT_PLAYLIST_URL,
        resolvedTracks: resolvedTracks.length,
        totalRemoteItems: allRemoteItems.length
      }
    };

    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

    const responseData = {
      success: true,
      albums: [playlistAlbum],
      totalCount: 1,
      playlist: {
        title: "Mike's Mix Tape Music Playlist",
        items: [playlistAlbum]
      }
    };

    // Save to SystemPlaylist table for instant page loads (only on refresh)
    if (refresh) {
      try {
        console.log('💾 Saving MMT playlist to database...');
        await prisma.systemPlaylist.upsert({
          where: { id: 'mmt' },
          update: { title: "Mike's Mix Tape Music Playlist", artwork: artworkUrl },
          create: { id: 'mmt', title: "Mike's Mix Tape Music Playlist", artwork: artworkUrl }
        });
        await prisma.systemPlaylistTrack.deleteMany({ where: { playlistId: 'mmt' } });
        // Filter out api-* and placeholder IDs that don't exist in Track table
        const trackInserts = tracks
          .filter((track: any) => track.id && !track.id.startsWith('api-') && !track.id.startsWith('placeholder-'))
          .map((track: any, index: number) => ({ playlistId: 'mmt', trackId: track.id, position: index, episodeId: null }));
        if (trackInserts.length > 0) {
          await prisma.systemPlaylistTrack.createMany({ data: trackInserts, skipDuplicates: true });
        }
        console.log(`💾 Saved ${trackInserts.length} tracks to SystemPlaylist`);
      } catch (dbError) {
        console.error('❌ Error saving to SystemPlaylist:', dbError);
      }
    }

    // Cache the response
    playlistCache.setCachedData('mmt-playlist', responseData);

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('❌ Error fetching MMT playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch MMT playlist' },
      { status: 500 }
    );
  }
}