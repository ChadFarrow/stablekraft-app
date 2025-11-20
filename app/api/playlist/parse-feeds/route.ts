import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { ValueTagParser } from '@/lib/lightning/value-parser';

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
    'User-Agent': 'StableKraft-Feed-Parser/1.0',
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}

async function lookupFeedByGuid(guid: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.status === 'true' && data.feed) {
      return data.feed;
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error looking up ${guid}:`, error);
    return null;
  }
}

async function parseFeedXML(feedUrl: string) {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'StableKraft-Feed-Parser/1.0'
      }
    });

    if (!response.ok) {
      return null;
    }

    const xmlText = await response.text();

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

    // Return both episodes and full XML for v4v parsing
    return { episodes, xmlText };

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

async function importFeedToDatabase(feedData: any, episodes: any[], xmlText?: string) {
  try {
    // Ensure feed ID is a string (Podcast Index returns numeric IDs)
    const feedId = String(feedData.id || feedData.guid || `feed-${Date.now()}`);

    // Parse v4v tags from RSS feed if xmlText is provided
    let parsedV4V = null;
    if (xmlText) {
      try {
        const valueParser = new ValueTagParser();
        parsedV4V = valueParser.parseValueTags(xmlText);
        console.log(`📊 Parsed v4v tags for feed ${feedId}: channel=${parsedV4V.channelValue ? 'yes' : 'no'}, items=${parsedV4V.itemValues.size}`);
      } catch (v4vError) {
        console.warn(`⚠️ Failed to parse v4v tags for feed ${feedId}:`, v4vError);
      }
    }

    // Check if feed already exists by GUID (id)
    let feed = await prisma.feed.findUnique({
      where: { id: feedId }
    });

    if (!feed && feedData.url) {
      // Try to find by URL
      feed = await prisma.feed.findFirst({
        where: { originalUrl: feedData.url }
      });
    }

    if (!feed) {
      // Create new feed
      feed = await prisma.feed.create({
        data: {
          id: feedId,
          title: feedData.title || 'Unknown Feed',
          description: feedData.description || null,
          originalUrl: feedData.url || '',
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
    } else {
      // Update existing feed
      feed = await prisma.feed.update({
        where: { id: feed.id },
        data: {
          title: feedData.title || feed.title,
          description: feedData.description || feed.description,
          artist: feedData.author || feed.artist,
          image: feedData.image || feed.image,
          language: feedData.language || feed.language,
          category: feedData.categories ? Object.keys(feedData.categories)[0] : feed.category,
          explicit: feedData.explicit === 1 ? true : feed.explicit,
          status: 'active',
          lastFetched: new Date()
        }
      });
    }

    // Check if feed has any tracks
    const existingTrackCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    // Import tracks/episodes
    let trackCount = 0;
    for (const episode of episodes) {
      try {
        // Check if track already exists
        const existingTrack = await prisma.track.findFirst({
          where: { guid: episode.guid },
          select: { id: true, v4vValue: true }
        });

        // Get v4v data for this track
        let v4vData = null;
        if (parsedV4V && episode.guid) {
          const itemV4V = parsedV4V.itemValues.get(episode.guid);
          const valueTag = itemV4V || parsedV4V.channelValue; // Use item-level or fall back to channel-level

          if (valueTag) {
            // Format v4v data for database storage
            v4vData = {
              type: valueTag.type,
              method: valueTag.method,
              suggested: valueTag.suggested,
              recipients: valueTag.recipients.map(r => ({
                name: r.name,
                type: r.type,
                address: r.address,
                split: r.split,
                customKey: r.customKey,
                customValue: r.customValue,
                fee: r.fee || false
              }))
            };
            console.log(`✅ Found v4v data for track "${episode.title}": ${valueTag.recipients.length} recipients`);
          }
        }

        if (!existingTrack) {
          // Create new track with v4v data
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
              ...(v4vData && { v4vValue: v4vData }),
              updatedAt: new Date()
            }
          });
          trackCount++;
        } else if (v4vData && !existingTrack.v4vValue) {
          // Update existing track with v4v data if it doesn't have it
          await prisma.track.update({
            where: { id: existingTrack.id },
            data: {
              v4vValue: v4vData,
              updatedAt: new Date()
            }
          });
          console.log(`🔄 Updated existing track "${episode.title}" with v4v data`);
          trackCount++; // Count as a new track for statistics
        }
      } catch (error) {
        console.warn(`⚠️ Failed to import track "${episode.title}":`, error instanceof Error ? error.message : error);
      }
    }

    return {
      feedId: feed.id,
      title: feedData.title || feed.title,
      trackCount,
      hadTracks: existingTrackCount > 0,
      newTracks: trackCount
    };

  } catch (error) {
    console.error(`❌ Error importing feed:`, error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    console.log('🚀 Starting parse feeds process for newly discovered playlist feeds...');
    
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }
    
    // Find feeds that exist but have no tracks (unparsed feeds)
    const unparsedFeeds = await prisma.feed.findMany({
      where: {
        status: 'active',
        Track: {
          none: {}
        }
      },
      take: 50 // Limit to 50 feeds per run to prevent timeouts
    });
    
    console.log(`📋 Found ${unparsedFeeds.length} unparsed feeds to process`);
    
    if (unparsedFeeds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No unparsed feeds found',
        parsed: 0,
        results: []
      });
    }
    
    const parseResults = [];
    const failedParses = [];
    
    for (let i = 0; i < unparsedFeeds.length; i++) {
      const feed = unparsedFeeds[i];
      
      try {
        console.log(`📊 Progress: ${i + 1}/${unparsedFeeds.length} - Processing ${feed.id}`);
        
        // If feed has a GUID (feed ID), try to get updated info from Podcast Index
        let feedData = null;
        if (feed.id && feed.id.length > 10) { // Likely a GUID
          feedData = await lookupFeedByGuid(feed.id);
        }
        
        // Use feed data from Podcast Index if available, otherwise use existing feed data
        const feedUrl = feedData?.url || feed.originalUrl;
        
        if (!feedUrl) {
          failedParses.push({ feedId: feed.id, reason: 'No feed URL available' });
          continue;
        }
        
        // Parse the RSS feed to get episodes and v4v data
        const parseResult = await parseFeedXML(feedUrl);

        if (!parseResult || !parseResult.episodes || parseResult.episodes.length === 0) {
          failedParses.push({ feedId: feed.id, reason: 'No episodes found or feed parse failed' });
          continue;
        }

        // Import to database with v4v data
        const importResult = await importFeedToDatabase(
          feedData || {
            id: feed.id,
            title: feed.title,
            description: feed.description,
            url: feedUrl,
            author: feed.artist,
            image: feed.image
          },
          parseResult.episodes,
          parseResult.xmlText
        );
        
        if (importResult) {
          parseResults.push(importResult);
        } else {
          failedParses.push({ feedId: feed.id, reason: 'Database import failed' });
        }
        
        // Rate limiting: wait 500ms between feeds
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Error processing feed ${feed.id}:`, error);
        failedParses.push({ 
          feedId: feed.id, 
          reason: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    console.log(`✅ Parse complete: ${parseResults.length} successful, ${failedParses.length} failed`);
    
    const totalTracks = parseResults.reduce((sum, result) => sum + (result.newTracks || 0), 0);
    
    return NextResponse.json({
      success: true,
      total: unparsedFeeds.length,
      parsed: parseResults.length,
      failed: failedParses.length,
      totalTracks,
      results: parseResults,
      failures: failedParses
    });
    
  } catch (error) {
    console.error('❌ Error in parse feeds process:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

