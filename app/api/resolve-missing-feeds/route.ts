import { NextResponse } from 'next/server';
import crypto from 'crypto';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

function generateAuthHeaders() {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    throw new Error('Podcast Index API credentials not configured');
  }
  
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': 'StableKraft-Podcast-Resolver/1.0',
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}

async function lookupFeedByGuid(guid: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;
    
    console.log(`🔍 Looking up feed GUID: ${guid}`);
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`❌ API error for ${guid}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.status === 'true' && data.feed) {
      console.log(`✅ Found feed: ${data.feed.title} - ${data.feed.url}`);
      return {
        guid: guid,
        title: data.feed.title,
        description: data.feed.description,
        url: data.feed.url,
        image: data.feed.image,
        artist: data.feed.author,
        category: data.feed.categories ? Object.keys(data.feed.categories)[0] : null,
        explicit: data.feed.explicit === 1,
        language: data.feed.language,
        type: data.feed.type === 1 ? 'music' : 'podcast',
        podcastIndexId: data.feed.id
      };
    } else {
      console.log(`⚠️ No feed found for GUID: ${guid}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error looking up ${guid}:`, error);
    return null;
  }
}

export async function GET(request: Request) {
  try {
    console.log('🚀 Starting missing feed resolution...');
    
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }
    
    // Get missing feed GUIDs from the ITDV playlist
    const playlistResponse = await fetch('http://localhost:3000/api/playlist/itdv');
    const playlistData = await playlistResponse.json();
    
    const missingFeedGuids = Array.from(new Set(
      playlistData.albums[0].tracks
        .filter((track: any) => track.title.startsWith('Music Reference') && track.feedGuid)
        .map((track: any) => track.feedGuid as string)
    )) as string[];
    
    console.log(`📋 Found ${missingFeedGuids.length} unique missing feed GUIDs`);
    
    const resolvedFeeds = [];
    const failedGuids = [];
    
    // Process feeds in batches to avoid rate limiting
    for (let i = 0; i < missingFeedGuids.length; i++) {
      const guid: string = missingFeedGuids[i];
      
      const feedData = await lookupFeedByGuid(guid);
      
      if (feedData) {
        resolvedFeeds.push(feedData);
      } else {
        failedGuids.push(guid);
      }
      
      // Rate limiting: wait 100ms between requests
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Progress logging
      if ((i + 1) % 10 === 0) {
        console.log(`📊 Progress: ${i + 1}/${missingFeedGuids.length} feeds processed`);
      }
    }
    
    console.log(`✅ Resolution complete: ${resolvedFeeds.length} found, ${failedGuids.length} failed`);
    
    return NextResponse.json({
      success: true,
      total: missingFeedGuids.length,
      resolved: resolvedFeeds.length,
      failed: failedGuids.length,
      feeds: resolvedFeeds,
      failedGuids: failedGuids
    });
    
  } catch (error) {
    console.error('❌ Error in feed resolution:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}