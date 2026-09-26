import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  generateAuthHeaders,
  lookupFeedByGuid,
  parseFeedXML,
  importFeedToDatabase,
  getEpisodesFromAPI
} from '@/lib/feed-parsing';
import { discoverAndParsePublishers } from '@/lib/feed-discovery';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

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
          const episodes = await getEpisodesFromAPI(feedData.id);
          if (episodes && episodes.length > 0) {
            console.log(`✅ Got ${episodes.length} episodes from Podcast Index API`);
            // Add feed image to episodes that don't have one
            const episodesWithImage = episodes.map(ep => ({
              ...ep,
              image: ep.image || feedData.image || ''
            }));
            // Fetch RSS XML for feed-level V4V data (PI API has episode V4V but not channel-level)
            let xmlText = '';
            if (feedUrl) {
              try {
                const rssResponse = await fetch(feedUrl, { signal: AbortSignal.timeout(10000) });
                if (rssResponse.ok) {
                  xmlText = await rssResponse.text();
                }
              } catch (xmlError) {
                console.warn(`⚠️ Could not fetch RSS XML for V4V: ${feedUrl}`);
              }
            }
            parseResult = { episodes: episodesWithImage, xmlText };
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

    console.warn(`✅ Parse complete: ${parseResults.length} successful, ${failedParses.length} failed`);

    // Discover publishers for newly parsed album feeds
    const parsedFeedIds = parseResults.map(r => r.feedId).filter(Boolean);
    if (parsedFeedIds.length > 0) {
      const pubResult = await discoverAndParsePublishers(parsedFeedIds);
      console.log(`🔗 Publisher discovery: ${pubResult.discovered} new, ${pubResult.linked} linked`);
    }

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
