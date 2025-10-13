import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

// List of known missing feed GUIDs that are available in Podcast Index
const MISSING_FEED_GUIDS = [
  '028e9f67-e0fc-558f-b598-25f06179cea3',
  '121c26b0-33f8-5cb9-9e14-d706bd3f5db8', 
  '1ef2b1d6-c4c0-5ef5-b534-bfc025e4193e',
  '2ec344a8-d756-5f8f-bde1-8a034321f1cb',
  '545a3589-88e6-57c5-8448-bdc056cc3dfb',
  '6335b366-6a83-5df4-ba62-d356ede08d70',
  '66740bed-5dca-540f-98ff-0411593dab82',
  '70456036-6a9c-5165-8fa7-84352259d602',
  '7a0735a7-c2d2-5e2c-ad5a-8586a62bfc93',
  '87ef86af-9d75-5876-97f9-5ea46e6094f7',
  'b9ee4d5d-77e7-56a4-a195-397ae28a3dfe',
  'babd1567-2803-5ede-9a19-302c2fbf9eae',
  'bba99401-378c-5540-bf95-c456b3d4de26',
  'bcd811d1-9fda-51d9-b2a6-9337f0131b66',
  'beeeef0b-51e9-52ac-b8d7-9ed54d5be3b0',
  'c1dc15c3-a6e6-577b-8b4e-a7eae58fd40b',
  'c8d77c9c-e661-5d79-8d5f-735cfe9a95b7',
  'cb086537-5673-57a8-9c78-72542da2a7d4',
  'd3e9bb7a-3df8-5b7e-8f52-0b01decf2b66',
  'd518a5ad-4df1-413e-a4a4-f2c7e146e650',
  'd577b6cd-8c41-548b-abba-60e1502a94df',
  'ec20d4ed-76c2-50dc-b4d9-0ba407f8cd81'
  // Skipping '5a95f9d8-35e3-51f5-a269-ba1df36b4bd8' as it consistently fails
];

function generateAuthHeaders() {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    throw new Error('Podcast Index API credentials not configured');
  }
  
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': 'FUCKIT-Specific-Feed-Importer/1.0',
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
      return data.feed;
    } else {
      console.log(`⚠️ No feed found for GUID: ${guid}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error looking up ${guid}:`, error);
    return null;
  }
}

async function parseFeedXML(feedUrl: string) {
  try {
    console.log(`📡 Fetching RSS feed: ${feedUrl}`);
    
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'FUCKIT-Specific-Feed-Parser/1.0'
      }
    });
    
    if (!response.ok) {
      console.log(`❌ Failed to fetch feed: ${response.status}`);
      return null;
    }
    
    const xmlText = await response.text();
    console.log(`📄 Fetched feed XML, length: ${xmlText.length}`);
    
    // Simple XML parsing for episodes/tracks
    const episodes = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemContent = match[1];
      
      // Extract basic fields
      const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const descMatch = itemContent.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/);
      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
      const audioMatch = itemContent.match(/<enclosure[^>]*url="([^"]*)"[^>]*type="audio[^"]*"/);
      const imageMatch = itemContent.match(/<itunes:image[^>]*href="([^"]*)"/);
      const durationMatch = itemContent.match(/<itunes:duration>([^<]*)<\/itunes:duration>/);
      const pubDateMatch = itemContent.match(/<pubDate>([^<]*)<\/pubDate>/);
      
      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      const description = descMatch ? (descMatch[1] || descMatch[2] || '').trim() : '';
      const guid = guidMatch ? guidMatch[1].trim() : '';
      const audioUrl = audioMatch ? audioMatch[1] : '';
      const image = imageMatch ? imageMatch[1] : '';
      const duration = durationMatch ? durationMatch[1] : '';
      const pubDate = pubDateMatch ? pubDateMatch[1] : '';
      
      if (title && guid) {
        episodes.push({
          title,
          description,
          guid,
          audioUrl,
          image,
          duration,
          pubDate
        });
      }
    }
    
    console.log(`📋 Parsed ${episodes.length} episodes from feed`);
    return episodes;
    
  } catch (error) {
    console.error(`❌ Error parsing feed ${feedUrl}:`, error);
    return null;
  }
}

function parseDuration(durationStr: string): number {
  if (!durationStr) return 0;
  
  // Handle different duration formats
  if (durationStr.includes(':')) {
    const parts = durationStr.split(':').map(p => parseInt(p) || 0);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hours:minutes:seconds
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1]; // minutes:seconds
    }
  }
  
  // Handle numeric duration (assume seconds)
  const numeric = parseInt(durationStr);
  return isNaN(numeric) ? 0 : numeric;
}

async function importFeedToDatabase(feedData: any, episodes: any[]) {
  try {
    console.log(`💾 Importing feed to database: ${feedData.title}`);
    
    // Check if this feed URL already exists
    const existingFeed = await prisma.feed.findFirst({
      where: {
        originalUrl: feedData.url
      }
    });
    
    if (existingFeed) {
      console.log(`⚠️ Feed already exists with ID: ${existingFeed.id}`);
      return {
        feedId: existingFeed.id,
        title: feedData.title,
        trackCount: episodes.length,
        status: 'already_exists'
      };
    }
    
    // Create a safe ID from the feed title
    const feedId = feedData.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50) + '-' + Date.now();
    
    // Import feed
    const feed = await prisma.feed.create({
      data: {
        id: feedId,
        title: feedData.title,
        description: feedData.description || '',
        originalUrl: feedData.url,
        type: feedData.type === 1 ? 'music' : 'podcast',
        artist: feedData.author || null,
        image: feedData.image || null,
        language: feedData.language || null,
        category: feedData.categories ? Object.keys(feedData.categories)[0] : null,
        explicit: feedData.explicit === 1,
        status: 'active',
        lastFetched: new Date(),
        updatedAt: new Date()
      }
    });
    
    console.log(`✅ Created feed: ${feed.id}`);
    
    // Import tracks/episodes
    let trackCount = 0;
    for (const episode of episodes) {
      try {
        // Check if track with this GUID already exists
        const existingTrack = await prisma.track.findFirst({
          where: {
            guid: episode.guid
          }
        });
        
        if (existingTrack) {
          console.log(`⚠️ Track already exists: ${episode.title}`);
          continue;
        }
        
        await prisma.track.create({
          data: {
            id: `${feed.id}-${episode.guid || `track-${trackCount}-${Date.now()}`}`,
            guid: episode.guid,
            title: episode.title,
            description: episode.description || null,
            audioUrl: episode.audioUrl || '',
            duration: parseDuration(episode.duration),
            image: episode.image || feed.image || null,
            publishedAt: episode.pubDate ? new Date(episode.pubDate) : new Date(),
            feedId: feed.id,
            trackOrder: trackCount + 1,
            updatedAt: new Date()
          }
        });
        trackCount++;
      } catch (error) {
        console.warn(`⚠️ Failed to import track "${episode.title}":`, error instanceof Error ? error.message : error);
      }
    }
    
    console.log(`✅ Imported ${trackCount} tracks for feed: ${feedData.title}`);
    
    return {
      feedId: feed.id,
      title: feedData.title,
      trackCount,
      status: 'imported'
    };
    
  } catch (error) {
    console.error(`❌ Error importing feed "${feedData.title}":`, error);
    return {
      feedId: null,
      title: feedData.title,
      trackCount: 0,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function POST(request: Request) {
  try {
    console.log('🚀 Starting specific missing feed import process...');
    
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }
    
    const { guids } = await request.json();
    const feedsToProcess = guids && Array.isArray(guids) ? guids : MISSING_FEED_GUIDS;
    
    console.log(`📋 Processing ${feedsToProcess.length} specific feed GUIDs...`);
    
    const importResults = [];
    const failedImports = [];
    
    for (let i = 0; i < feedsToProcess.length; i++) {
      const guid = feedsToProcess[i];
      
      try {
        console.log(`📊 Progress: ${i + 1}/${feedsToProcess.length} - ${guid}`);
        
        // 1. Look up feed metadata via Podcast Index API
        const feedData = await lookupFeedByGuid(guid);
        
        if (!feedData) {
          failedImports.push({ guid, reason: 'Feed not found in Podcast Index' });
          continue;
        }
        
        // 2. Parse the RSS feed to get episodes
        const episodes = await parseFeedXML(feedData.url);
        
        if (!episodes || episodes.length === 0) {
          failedImports.push({ guid, reason: 'No episodes found or feed parse failed' });
          continue;
        }
        
        // 3. Import to database with improved error handling
        const importResult = await importFeedToDatabase(feedData, episodes);
        
        if (importResult.status === 'imported' || importResult.status === 'already_exists') {
          importResults.push(importResult);
        } else {
          failedImports.push({ 
            guid, 
            reason: importResult.error || 'Database import failed' 
          });
        }
        
        // Rate limiting: wait 500ms between feeds
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Error processing ${guid}:`, error);
        failedImports.push({ 
          guid, 
          reason: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    console.log(`✅ Import complete: ${importResults.length} successful, ${failedImports.length} failed`);
    
    return NextResponse.json({
      success: true,
      total: feedsToProcess.length,
      imported: importResults.filter(r => r.status === 'imported').length,
      alreadyExisted: importResults.filter(r => r.status === 'already_exists').length,
      failed: failedImports.length,
      results: importResults,
      failures: failedImports
    });
    
  } catch (error) {
    console.error('❌ Error in specific feed import process:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}