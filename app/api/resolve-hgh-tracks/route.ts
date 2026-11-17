import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Load environment variables
const API_KEY = process.env.PODCAST_INDEX_API_KEY;
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

interface HGHTrack {
  feedGuid: string;
  itemGuid: string;
  title?: string;
  artist?: string;
  audioUrl?: string;
  artworkUrl?: string;
  duration?: number;
}

// Cache for resolved data
const feedCache = new Map<string, any>();
const episodeCache = new Map<string, any>();

function createAuthHeaders() {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Missing Podcast Index API credentials');
  }

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const sha1Algorithm = 'sha1';
  const sha1Hash = crypto.createHash(sha1Algorithm);
  const data4Hash = API_KEY + API_SECRET + apiHeaderTime;
  sha1Hash.update(data4Hash);
  const hash4Header = sha1Hash.digest('hex');

  return {
    'X-Auth-Key': API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hash4Header,
    'User-Agent': 'HGH-Resolver/1.0'
  };
}

async function resolveSingleTrack(track: HGHTrack): Promise<HGHTrack | null> {
  const cacheKey = `${track.feedGuid}-${track.itemGuid}`;
  
  // Check episode cache first
  if (episodeCache.has(cacheKey)) {
    return episodeCache.get(cacheKey);
  }

  try {
    // Try to get the episode by GUID
    const episodeUrl = `https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${track.itemGuid}&feedguid=${track.feedGuid}`;
    
    const response = await fetch(episodeUrl, {
      headers: createAuthHeaders()
    });

    if (!response.ok) {
      console.warn(`⚠️ Failed to fetch episode for ${track.feedGuid}/${track.itemGuid}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.episode) {
      console.log(`⚠️ No episode found for ${track.feedGuid}/${track.itemGuid}`);
      return null;
    }

    const episode = data.episode;
    
    // Create resolved track info
    const resolvedTrack: HGHTrack = {
      feedGuid: track.feedGuid,
      itemGuid: track.itemGuid,
      title: episode.title || track.title || 'Unknown Track',
      artist: episode.feedTitle || 'Unknown Artist',
      audioUrl: episode.enclosureUrl || '',
      artworkUrl: episode.image || episode.feedImage || '',
      duration: episode.duration || 180
    };

    // Cache the result
    episodeCache.set(cacheKey, resolvedTrack);
    
    console.log(`✅ Resolved: ${resolvedTrack.title} by ${resolvedTrack.artist}`);
    return resolvedTrack;

  } catch (error) {
    console.error(`❌ Error resolving track ${track.feedGuid}/${track.itemGuid}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!API_KEY || !API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { tracks } = body;

    if (!Array.isArray(tracks)) {
      return NextResponse.json(
        { error: 'Invalid tracks array' },
        { status: 400 }
      );
    }

    console.log(`🎵 Starting HGH track resolution for ${tracks.length} tracks`);
    
    const resolvedTracks: HGHTrack[] = [];
    const failedTracks: HGHTrack[] = [];
    
    // Process in smaller batches to avoid rate limiting
    const batchSize = 5;
    const delayBetweenBatches = 1000; // 1 second between batches
    
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, Math.min(i + batchSize, tracks.length));
      
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(tracks.length / batchSize)}`);
      
      const batchPromises = batch.map((track: HGHTrack) => resolveSingleTrack(track));
      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        if (result && result.audioUrl) {
          resolvedTracks.push(result);
        } else if (result) {
          failedTracks.push(result);
        }
      }
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < tracks.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    console.warn(`✅ Resolution complete: ${resolvedTracks.length} resolved, ${failedTracks.length} failed`);

    return NextResponse.json({
      success: true,
      resolved: resolvedTracks.length,
      failed: failedTracks.length,
      tracks: resolvedTracks,
      message: `Resolved ${resolvedTracks.length} of ${tracks.length} tracks`
    });

  } catch (error) {
    console.error('Error resolving HGH tracks:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to resolve tracks'
      },
      { status: 500 }
    );
  }
}