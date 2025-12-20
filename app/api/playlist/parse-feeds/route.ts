import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { ValueTagParser } from '@/lib/lightning/value-parser';
import { isValidFeedUrl, normalizeUrl } from '@/lib/url-utils';
import { calculateTrackOrder } from '@/lib/rss-parser-db';

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
      // Extract episode number for track ordering (podcast:episode or itunes:episode)
      const episodeMatch = itemContent.match(/<podcast:episode>(\d+)<\/podcast:episode>|<itunes:episode>(\d+)<\/itunes:episode>/);
      // Extract season number for track ordering (podcast:season or itunes:season)
      const seasonMatch = itemContent.match(/<podcast:season>(\d+)<\/podcast:season>|<itunes:season>(\d+)<\/itunes:season>/);

      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      const description = descMatch ? (descMatch[1] || descMatch[2] || '').trim() : '';
      const guid = guidMatch ? guidMatch[1].trim() : '';
      const audioUrl = audioMatch ? audioMatch[1] : '';
      const image = imageMatch ? imageMatch[1] : '';
      const duration = durationMatch ? durationMatch[1] : '';
      const pubDate = pubDateMatch ? pubDateMatch[1] : '';
      const episode = episodeMatch ? parseInt(episodeMatch[1] || episodeMatch[2]) : null;
      const season = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2]) : undefined;

      if (title && guid) {
        episodes.push({
          title,
          description,
          guid,
          audioUrl,
          image,
          duration,
          pubDate,
          episode,
          season
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

    // Validate and normalize URL before storing
    const feedUrl = feedData.url || '';
    const normalizedFeedUrl = feedUrl && isValidFeedUrl(feedUrl) ? normalizeUrl(feedUrl) : feedUrl;

    if (feedUrl && !isValidFeedUrl(feedUrl)) {
      console.warn(`⚠️ Invalid feed URL for ${feedId}: ${feedUrl}`);
    }

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

    // Prepare channel-level v4v data for feed storage
    let feedV4vData = null;
    let feedV4vRecipient = null;
    if (parsedV4V?.channelValue) {
      feedV4vData = {
        type: parsedV4V.channelValue.type,
        method: parsedV4V.channelValue.method,
        suggested: parsedV4V.channelValue.suggested,
        recipients: parsedV4V.channelValue.recipients.map(r => ({
          name: r.name,
          type: r.type,
          address: r.address,
          split: r.split,
          customKey: r.customKey,
          customValue: r.customValue,
          fee: r.fee || false
        }))
      };
      feedV4vRecipient = parsedV4V.channelValue.recipients[0]?.address || null;
      console.log(`📊 Storing channel-level v4v data on feed ${feedId}: ${parsedV4V.channelValue.recipients.length} recipients`);
    }

    // Use upsert to atomically create or update feed (prevents race conditions)
    const feed = await prisma.feed.upsert({
      where: { id: feedId },
      create: {
        id: feedId,
        title: feedData.title || 'Unknown Feed',
        description: feedData.description || null,
        originalUrl: normalizedFeedUrl,
        type: feedData.type === 1 ? 'music' : 'podcast',
        artist: feedData.author || null,
        image: feedData.image || null,
        language: feedData.language || null,
        category: feedData.categories ? Object.keys(feedData.categories)[0] : null,
        explicit: feedData.explicit === 1,
        status: 'active',
        lastFetched: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(feedV4vData && { v4vValue: feedV4vData }),
        ...(feedV4vRecipient && { v4vRecipient: feedV4vRecipient })
      },
      update: {
        // Update existing feed metadata
        title: feedData.title || undefined,
        description: feedData.description || undefined,
        artist: feedData.author || undefined,
        image: feedData.image || undefined,
        language: feedData.language || undefined,
        category: feedData.categories ? Object.keys(feedData.categories)[0] : undefined,
        explicit: feedData.explicit === 1 ? true : undefined,
        status: 'active',
        lastFetched: new Date(),
        updatedAt: new Date(),
        ...(feedV4vData && { v4vValue: feedV4vData }),
        ...(feedV4vRecipient && { v4vRecipient: feedV4vRecipient })
      }
    });

    // Check if feed has any tracks
    const existingTrackCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    // Import tracks/episodes
    let trackCount = 0;

    // Batch lookup: Get all existing tracks by guid in one query (fixes N+1)
    const episodeGuids = episodes.map(e => e.guid).filter(Boolean);
    const existingTracks = episodeGuids.length > 0
      ? await prisma.track.findMany({
          where: { guid: { in: episodeGuids } },
          select: { id: true, guid: true, v4vValue: true }
        })
      : [];
    const existingTracksByGuid = new Map(existingTracks.map(t => [t.guid, t]));

    for (const episode of episodes) {
      try {
        // Check if track already exists (from our pre-fetched map)
        const existingTrack = episode.guid ? existingTracksByGuid.get(episode.guid) : null;

        // Get v4v data for this track
        let v4vData = null;
        let v4vRecipient = null;

        // Check if episode already has v4v data from Podcast Index API
        if (episode.v4vValue && episode.v4vValue.destinations) {
          v4vData = {
            type: episode.v4vValue.model?.type || 'lightning',
            method: episode.v4vValue.model?.method || 'keysend',
            suggested: episode.v4vValue.model?.suggested,
            recipients: episode.v4vValue.destinations.map((r: any) => ({
              name: r.name,
              type: r.type,
              address: r.address,
              split: r.split,
              customKey: r.customKey,
              customValue: r.customValue,
              fee: r.fee || false
            }))
          };
          // Extract lightning address from first recipient
          v4vRecipient = episode.v4vValue.destinations[0]?.address || null;
          console.log(`✅ Found v4v data from API for track "${episode.title}": ${episode.v4vValue.destinations.length} recipients`);
        }
        // Fallback to parsed XML v4v data if available
        // IMPORTANT: Only use item-level value tags, not channel-level
        // Channel-level splits should be stored on the Feed, not on individual Tracks
        // Frontend will handle the fallback to channel-level when displaying
        else if (parsedV4V && episode.guid) {
          const itemV4V = parsedV4V.itemValues.get(episode.guid);

          // Only use item-level v4v data - don't fall back to channel level
          if (itemV4V) {
            // Format v4v data for database storage
            v4vData = {
              type: itemV4V.type,
              method: itemV4V.method,
              suggested: itemV4V.suggested,
              recipients: itemV4V.recipients.map(r => ({
                name: r.name,
                type: r.type,
                address: r.address,
                split: r.split,
                customKey: r.customKey,
                customValue: r.customValue,
                fee: r.fee || false
              }))
            };
            // Extract lightning address from first recipient
            v4vRecipient = itemV4V.recipients[0]?.address || null;
            console.log(`✅ Found item-level v4v data from RSS for track "${episode.title}": ${itemV4V.recipients.length} recipients`);
          } else {
            console.log(`ℹ️ No item-level v4v data for track "${episode.title}" - will use channel-level at display time`);
          }
        }

        // Use season/episode for track order if available, otherwise use sequential order
        const trackOrderValue = episode.episode
          ? calculateTrackOrder(episode.episode, episode.season)
          : trackCount + 1;

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
              trackOrder: trackOrderValue,
              ...(v4vData && { v4vValue: v4vData }),
              ...(v4vRecipient && { v4vRecipient }),
              updatedAt: new Date()
            }
          });
          trackCount++;
        } else {
          // Update existing track with trackOrder and v4v data
          await prisma.track.update({
            where: { id: existingTrack.id },
            data: {
              trackOrder: trackOrderValue,
              ...(v4vData && !existingTrack.v4vValue && { v4vValue: v4vData }),
              ...(v4vRecipient && !existingTrack.v4vValue && { v4vRecipient }),
              updatedAt: new Date()
            }
          });
          if (v4vData && !existingTrack.v4vValue) {
            console.log(`🔄 Updated existing track "${episode.title}" with v4v data and trackOrder`);
          }
          trackCount++; // Count as processed for statistics
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
      take: 200 // Increased from 50 to process more feeds per run
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

        let parseResult = null;
        const feedUrl = feedData?.url || feed.originalUrl;

        // PRIMARY: Try Podcast Index API first if we have feed data
        if (feedData?.id) {
          console.log(`📡 Using Podcast Index API for feed ${feedData.id}`);
          try {
            const headers = generateAuthHeaders();
            const episodesResponse = await fetch(`${API_BASE_URL}/episodes/byfeedid?id=${feedData.id}&max=1000`, { headers });

            if (episodesResponse.ok) {
              const episodesData = await episodesResponse.json();
              if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
                console.log(`✅ Got ${episodesData.items.length} episodes from Podcast Index API`);
                // Convert Podcast Index episodes to our format with v4v data
                const episodes = episodesData.items.map((ep: any) => ({
                  title: ep.title,
                  description: ep.description || '',
                  guid: ep.guid,
                  audioUrl: ep.enclosureUrl || '',
                  image: ep.image || feedData.image || '',
                  duration: ep.duration?.toString() || '0',
                  pubDate: new Date(ep.datePublished * 1000).toUTCString(),
                  v4vValue: ep.value, // Include v4v data from API
                  episode: ep.episode || null // Include episode number for track ordering
                }));
                parseResult = { episodes, xmlText: '' };
              }
            }
          } catch (apiError) {
            console.error(`❌ Error getting episodes from Podcast Index API:`, apiError);
          }
        }

        // FALLBACK: Try RSS parsing if API failed or no feedData
        if (!parseResult || !parseResult.episodes || parseResult.episodes.length === 0) {
          if (!feedUrl) {
            failedParses.push({ feedId: feed.id, reason: 'No feed URL or API data available' });
            continue;
          }

          console.log(`⚠️ Falling back to RSS parsing for ${feedUrl}`);
          parseResult = await parseFeedXML(feedUrl);
        }

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
        
        // Rate limiting: wait 100ms between feeds (reduced from 500ms for faster processing)
        await new Promise(resolve => setTimeout(resolve, 100));
        
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

