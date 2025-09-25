import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { playlistCache } from '@/lib/playlist-cache';
import { headers } from 'next/headers';

const SAS_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml';
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
    'User-Agent': 'FUCKIT-SAS-Resolver/1.0'
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

export async function GET(request: NextRequest) {
  try {
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') || 'unknown';
    
    console.log('🎵 Fetching SAS playlist...', { userAgent });

    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get('refresh') === 'true';

    // Check cache first (unless refresh requested)
    if (!refresh && playlistCache.isCacheValid('sas-playlist')) {
      const cachedData = playlistCache.getCachedData('sas-playlist');
      if (cachedData) {
        console.log('⚡ Using persistent cached playlist data');
        return NextResponse.json(cachedData);
      }
    }

    // Fetch playlist XML
    const xmlText = await fetchPlaylistXML(SAS_PLAYLIST_URL);
    console.log(`📄 Fetched playlist XML, length: ${xmlText.length}`);
    
    // Parse remote items
    const remoteItems = parseRemoteItems(xmlText);
    console.log(`📋 Found remote items: ${remoteItems.length}`);
    
    // Extract artwork URL
    const artworkMatch = xmlText.match(/<itunes:image[^>]*href="([^"]*)"[^>]*>/);
    const artworkUrl = artworkMatch ? artworkMatch[1] : 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/SAS-playlist-art%20.webp';
    console.log(`🎨 Found artwork URL: ${artworkUrl}`);

    console.log('🔍 Resolving playlist items to actual tracks...');
    
    // Get unique track GUIDs for database lookup
    const itemGuids = remoteItems.map(item => item.itemGuid);
    const uniqueItemGuids = [...new Set(itemGuids)];
    
    console.log(`🔍 Looking up ${uniqueItemGuids.length} unique track GUIDs for ${remoteItems.length} playlist items`);
    
    // Database lookup first
    const dbTracks = await prisma.track.findMany({
      where: {
        guid: { in: uniqueItemGuids }
      },
      include: {
        feed: true
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

    // Resolve all tracks (database first, then API fallback)
    const tracksAll = await Promise.all(remoteItems.map(async (item, index) => {
      // Check database first
      const dbTrack = dbTrackMap.get(item.itemGuid);
      if (dbTrack && dbTrack.audioUrl && dbTrack.audioUrl.length > 0) {
        return {
          id: dbTrack.id,
          title: dbTrack.title,
          artist: dbTrack.artist || dbTrack.feed?.title || 'Unknown Artist',
          audioUrl: dbTrack.audioUrl,
          url: dbTrack.audioUrl,
          duration: dbTrack.duration || 0,
          publishedAt: dbTrack.publishedAt?.toISOString() || new Date().toISOString(),
          image: dbTrack.image || dbTrack.feed?.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: dbTrack.description || `${dbTrack.title} by ${dbTrack.artist || dbTrack.feed?.title} - Featured in Sats and Sounds podcast`,
          albumTitle: dbTrack.feed?.title || 'Unknown Album',
          feedTitle: dbTrack.feed?.title || 'Unknown Feed',
          guid: dbTrack.guid
        };
      }

      // API fallback for missing tracks
      const resolvedData = await resolveItemGuid(item.feedGuid, item.itemGuid);
      if (resolvedData && resolvedData.audioUrl && resolvedData.audioUrl.length > 0) {
        return {
          id: `api-${resolvedData.guid}`,
          title: resolvedData.title,
          artist: resolvedData.feedTitle,
          audioUrl: resolvedData.audioUrl,
          url: resolvedData.audioUrl,
          duration: resolvedData.duration,
          publishedAt: resolvedData.publishedAt.toISOString(),
          image: resolvedData.image || artworkUrl || '/placeholder-podcast.jpg',
          feedGuid: item.feedGuid,
          itemGuid: item.itemGuid,
          description: `${resolvedData.title} by ${resolvedData.feedTitle} - Featured in Sats and Sounds podcast`,
          albumTitle: resolvedData.feedTitle,
          feedTitle: resolvedData.feedTitle,
          guid: resolvedData.guid
        };
      }

      // Return placeholder if neither database nor API resolved the track
      return {
        id: `api-${item.itemGuid}`,
        title: `Music Track (${item.itemGuid.slice(-8)})`,
        artist: 'Unknown Podcast',
        audioUrl: '',
        url: '',
        duration: 0,
        publishedAt: new Date().toISOString(),
        image: artworkUrl || '/placeholder-podcast.jpg',
        feedGuid: item.feedGuid,
        itemGuid: item.itemGuid,
        description: `Music track referenced in Sats and Sounds podcast episode - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`
      };
    }));

    // Filter out tracks without audio URLs and prioritize resolved tracks
    const tracks = tracksAll.filter(track => 
      track.audioUrl && track.audioUrl.length > 0 && !track.audioUrl.includes('placeholder')
    );

    console.log(`🎯 Filtered tracks: ${tracksAll.length} -> ${tracks.length} (removed ${tracksAll.length - tracks.length} tracks without audio)`);

    // Create a single virtual album that represents the SAS playlist
    const playlistAlbum = {
      id: 'sas-playlist',
      title: 'Sats and Sounds Music Playlist',
      artist: 'Various Artists',
      album: 'Sats and Sounds Music Playlist',
      description: 'Curated playlist from Sats and Sounds podcast featuring Value4Value independent artists',
      image: artworkUrl || '/placeholder-podcast.jpg',
      coverArt: artworkUrl || '/placeholder-podcast.jpg',
      url: SAS_PLAYLIST_URL,
      tracks: tracks,
      feedId: 'sas-playlist',
      type: 'playlist',
      totalTracks: tracks.length,
      publishedAt: new Date().toISOString(),
      isPlaylistCard: true,
      playlistUrl: '/playlist/sas',
      albumUrl: '/album/sas-playlist',
      playlistContext: {
        source: 'sas-playlist',
        originalUrl: SAS_PLAYLIST_URL,
        resolvedTracks: dbTracks.length,
        totalRemoteItems: remoteItems.length
      }
    };

    console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

    const responseData = {
      success: true,
      albums: [playlistAlbum],
      totalCount: 1,
      playlist: {
        title: 'Sats and Sounds Music Playlist',
        items: [playlistAlbum]
      }
    };

    // Cache the response
    playlistCache.setCachedData('sas-playlist', responseData);

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('❌ Error fetching SAS playlist:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SAS playlist' },
      { status: 500 }
    );
  }
}