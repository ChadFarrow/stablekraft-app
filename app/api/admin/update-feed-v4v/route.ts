import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { parseV4VFromXML, parseItemV4VFromXML } from '../../../../lib/rss-parser-db';
import { Prisma } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { feedId } = body;

    if (!feedId) {
      return NextResponse.json({
        success: false,
        error: 'feedId is required'
      }, { status: 400 });
    }

    console.log(`🔍 Updating V4V data for feed: ${feedId}`);

    // Get the specific feed
    const feed = await prisma.feed.findUnique({
      where: { id: feedId },
      select: {
        id: true,
        originalUrl: true,
        title: true,
      },
    });

    if (!feed) {
      return NextResponse.json({
        success: false,
        error: `Feed with id "${feedId}" not found`
      }, { status: 404 });
    }

    // Fetch the RSS feed
    const response = await fetch(feed.originalUrl);
    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Failed to fetch feed: ${response.status}`
      }, { status: response.status });
    }

    const xmlText = await response.text();
    console.log(`📄 Fetched XML for ${feed.id}, length: ${xmlText.length}`);

    // Parse V4V data from XML
    const feedV4V = parseV4VFromXML(xmlText);

    if (!feedV4V.recipient && !feedV4V.value) {
      return NextResponse.json({
        success: false,
        error: 'No V4V data found in RSS feed'
      }, { status: 404 });
    }

    console.log(`✅ Found V4V data for feed ${feed.id}`);

    // Get all tracks for this feed
    const tracks = await prisma.track.findMany({
      where: { feedId: feed.id },
      select: { id: true, title: true },
    });

    console.log(`🎵 Found ${tracks.length} tracks for feed ${feed.id}`);

    let updatedTracks = 0;
    let errors = 0;

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
            v4vValue: v4vValue ? JSON.stringify(v4vValue) : Prisma.JsonNull,
          },
        });

        updatedTracks++;
      } catch (trackError) {
        console.log(`⚠️ Error updating track ${track.id}: ${trackError}`);
        errors++;
      }
    }

    // Update feed-level V4V data
    if (feedV4V.value) {
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          v4vRecipient: feedV4V.recipient,
          v4vValue: JSON.stringify(feedV4V.value),
        },
      });
    } else if (feedV4V.recipient) {
      // Update recipient even if no value object
      await prisma.feed.update({
        where: { id: feed.id },
        data: {
          v4vRecipient: feedV4V.recipient,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Updated V4V data for feed "${feed.title}"`,
      feedId: feed.id,
      feedTitle: feed.title,
      updatedTracks,
      errors,
    });

  } catch (error: any) {
    console.error('❌ V4V update failed:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

