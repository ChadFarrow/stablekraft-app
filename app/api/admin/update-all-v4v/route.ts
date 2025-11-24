import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { parseV4VFromXML, parseItemV4VFromXML } from '../../../../lib/rss-parser-db';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting comprehensive V4V data update for all feeds...');

    // Get all feeds from the database
    const feeds = await prisma.feed.findMany({
      select: {
        id: true,
        originalUrl: true,
        title: true,
      },
    });

    console.log(`📊 Found ${feeds.length} feeds to process`);

    let updatedFeeds = 0;
    let updatedTracks = 0;
    let errors = 0;

    for (const feed of feeds) {
      try {
        console.log(`🔍 Processing feed: ${feed.title} (${feed.id})`);
        
        // Fetch the RSS feed
        const response = await fetch(feed.originalUrl);
        if (!response.ok) {
          console.log(`⚠️ Failed to fetch feed ${feed.id}: ${response.status}`);
          errors++;
          continue;
        }

        const xmlText = await response.text();
        console.log(`📄 Fetched XML for ${feed.id}, length: ${xmlText.length}`);

        // Parse V4V data from XML
        const feedV4V = parseV4VFromXML(xmlText);
        
        if (feedV4V.recipient) {
          console.log(`✅ Found V4V data for feed ${feed.id}: ${feedV4V.recipient}`);
          
          // Get all tracks for this feed
          const tracks = await prisma.track.findMany({
            where: { feedId: feed.id },
            select: { id: true, title: true },
          });

          console.log(`🎵 Found ${tracks.length} tracks for feed ${feed.id}`);

          // Update each track with V4V data
          for (const track of tracks) {
            try {
              // Try to get item-specific V4V data
              const itemV4V = parseItemV4VFromXML(xmlText, track.title);
              const v4vRecipient = itemV4V.recipient || feedV4V.recipient;
              const v4vValue = itemV4V.value || feedV4V.value;

              await prisma.track.update({
                where: { id: track.id },
                data: {
                  v4vRecipient: v4vRecipient,
                  v4vValue: v4vValue ? JSON.stringify(v4vValue) : null,
                },
              });

              updatedTracks++;
            } catch (trackError) {
              console.log(`⚠️ Error updating track ${track.id}: ${trackError}`);
              errors++;
            }
          }

          updatedFeeds++;
        } else {
          console.log(`ℹ️ No V4V data found for feed ${feed.id}`);
        }
      } catch (feedError) {
        console.log(`❌ Error processing feed ${feed.id}: ${feedError}`);
        errors++;
      }
    }

    console.log('✅ Comprehensive V4V update completed');
    console.log(`📊 Results: ${updatedFeeds} feeds updated, ${updatedTracks} tracks updated, ${errors} errors`);

    return NextResponse.json({
      success: true,
      message: 'Comprehensive V4V data update completed',
      results: {
        totalFeeds: feeds.length,
        updatedFeeds: updatedFeeds,
        updatedTracks: updatedTracks,
        errors: errors,
      },
    });

  } catch (error: any) {
    console.error('❌ Comprehensive V4V update failed:', error);

    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}
