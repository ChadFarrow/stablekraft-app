import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
    'User-Agent': 'FUCKIT-Feed-Importer/1.0',
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
        'User-Agent': 'FUCKIT-Feed-Parser/1.0'
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
    
    // Create a safe ID from the feed title
    const feedId = feedData.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50) + '-' + Date.now();
    
    // Check if feed already exists
    let feed = await prisma.feed.findUnique({
      where: { originalUrl: feedData.url }
    });
    
    if (!feed) {
      // Create new feed
      feed = await prisma.feed.create({
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
      console.log(`✅ Created new feed: ${feed.id}`);
    } else {
      // Update existing feed
      feed = await prisma.feed.update({
        where: { id: feed.id },
        data: {
          title: feedData.title,
          description: feedData.description || '',
          type: feedData.type === 1 ? 'music' : 'podcast',
          artist: feedData.author || null,
          image: feedData.image || null,
          language: feedData.language || null,
          category: feedData.categories ? Object.keys(feedData.categories)[0] : null,
          explicit: feedData.explicit === 1,
          status: 'active',
          lastFetched: new Date()
        }
      });
      console.log(`✅ Updated existing feed: ${feed.id}`);
    }
    
    console.log(`✅ Created feed: ${feed.id}`);
    
    // Import tracks/episodes
    let trackCount = 0;
    for (const episode of episodes) {
      try {
        // Check if track already exists
        const existingTrack = await prisma.track.findUnique({
          where: { guid: episode.guid }
        });
        
        if (!existingTrack) {
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
        } else {
          console.log(`⚠️ Track "${episode.title}" already exists, skipping`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to import track "${episode.title}":`, error instanceof Error ? error.message : error);
      }
    }
    
    console.log(`✅ Imported ${trackCount} tracks for feed: ${feedData.title}`);
    
    return {
      feedId: feed.id,
      title: feedData.title,
      trackCount
    };
    
  } catch (error) {
    console.error(`❌ Error importing feed "${feedData.title}":`, error);
    console.error(`❌ Error details:`, error instanceof Error ? error.message : error);
    console.error(`❌ Stack trace:`, error instanceof Error ? error.stack : 'No stack trace');
    return null;
  }
}

export async function POST(request: Request) {
  try {
    console.log('🚀 Starting missing feed import process...');
    
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }
    
    // Get playlist type from request body or default to ITDV
    const body = await request.json().catch(() => ({}));
    const playlistType = body.playlistType || 'itdv';
    const maxFeeds = body.maxFeeds || 10;
    
    // Get missing feed GUIDs from the specified playlist
    const playlistResponse = await fetch(`http://localhost:3000/api/playlist/${playlistType}`);
    const playlistData = await playlistResponse.json();
    
    const missingFeedGuids = Array.from(new Set(
      playlistData.albums[0].tracks
        .filter((track: any) => track.title.startsWith('Music Reference') && track.feedGuid)
        .map((track: any) => track.feedGuid as string)
    )) as string[];
    
    console.log(`📋 Found ${missingFeedGuids.length} unique missing feed GUIDs to import`);
    
    const importResults = [];
    const failedImports = [];
    
    // Process a limited number for initial testing
    const feedsToProcess = missingFeedGuids.slice(0, maxFeeds);
    
    for (let i = 0; i < feedsToProcess.length; i++) {
      const guid: string = feedsToProcess[i];
      
      try {
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
        
        // 3. Import to database
        const importResult = await importFeedToDatabase(feedData, episodes);
        
        if (importResult) {
          importResults.push(importResult);
        } else {
          failedImports.push({ guid, reason: 'Database import failed' });
        }
        
        // Rate limiting: wait 500ms between feeds
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log(`📊 Progress: ${i + 1}/${feedsToProcess.length} feeds processed`);
        
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
      imported: importResults.length,
      failed: failedImports.length,
      results: importResults,
      failures: failedImports,
      remainingGuids: missingFeedGuids.length - feedsToProcess.length
    });
    
  } catch (error) {
    console.error('❌ Error in feed import process:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}