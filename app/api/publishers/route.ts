import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

// Load static publisher remote items mapping (same as albums API)
let publisherRemoteItemsStatic: Record<string, string[]> | null = null;
function loadPublisherRemoteItemsStatic(): Record<string, string[]> {
  if (publisherRemoteItemsStatic) return publisherRemoteItemsStatic;

  try {
    const staticPath = path.join(process.cwd(), 'data', 'publisher-remote-items.json');
    if (fs.existsSync(staticPath)) {
      publisherRemoteItemsStatic = JSON.parse(fs.readFileSync(staticPath, 'utf-8'));
      return publisherRemoteItemsStatic || {};
    }
  } catch (error) {
    console.error('Error loading static publisher remote items:', error);
  }

  return {};
}

export async function GET() {
  try {
    console.log('🔍 Publishers API: Loading actual publisher feeds from publisher-feed-results.json');

    // Load the publisher feed results file which contains actual publisher feeds with remoteItems
    const publisherFeedsPath = path.join(process.cwd(), 'data', 'publisher-feed-results.json');

    if (!fs.existsSync(publisherFeedsPath)) {
      console.error('❌ publisher-feed-results.json not found');
      return NextResponse.json({
        publishers: [],
        total: 0,
        timestamp: new Date().toISOString(),
        error: 'Publisher feeds file not found'
      }, { status: 404 });
    }

    const publisherFeedsData = JSON.parse(fs.readFileSync(publisherFeedsPath, 'utf-8'));
    console.log(`📊 Loaded ${publisherFeedsData.length} publisher feeds from file`);

    // Load static mapping of publisher IDs to remote item GUIDs
    const staticMapping = loadPublisherRemoteItemsStatic();
    console.log(`📊 Loaded static mapping for ${Object.keys(staticMapping).length} publishers`);

    // Get all album feeds to count matches
    // Note: We need to load feeds with tracks to match the /api/albums filtering logic
    const allFeeds = await prisma.feed.findMany({
      where: {
        type: 'album',
        status: 'active'
      },
      select: {
        id: true,
        originalUrl: true,
        title: true,
        artist: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    console.log(`📊 Loaded ${allFeeds.length} album feeds from database`);

    // Transform to match the expected format for the publishers API
    const publishers = publisherFeedsData.map((publisherFeed: any) => {
      const cleanTitle = publisherFeed.title?.replace(/<!\[CDATA\[|\]\]>/g, '') || 'Unknown Publisher';
      const feedGuid = publisherFeed.feed.id || generateAlbumSlug(cleanTitle);

      // Count albums using the same method as the albums API publisher filter
      let albumCount = 0;
      let trackCount = 0;

      // Get the remote item GUIDs for this publisher from static mapping
      const remoteGuids = staticMapping[feedGuid] || [];

      if (remoteGuids.length > 0) {
        // Count feeds that match any of the remote GUIDs
        for (const feed of allFeeds) {
          const feedUrl = feed.originalUrl || '';
          const matchesGuid = remoteGuids.some(guid => feedUrl.includes(guid));

          if (matchesGuid) {
            // Apply the same filtering as /api/albums:
            // 1. Exclude feeds with no tracks
            if (feed._count.Track === 0) {
              continue;
            }

            // 2. Exclude Bowl After Bowl podcast content (but keep Bowl Covers)
            const feedTitle = feed.title?.toLowerCase() || '';
            const feedArtist = feed.artist?.toLowerCase() || '';
            const isBowlAfterBowlPodcast = (
              (feedTitle.includes('bowl after bowl') && !feedTitle.includes('covers')) ||
              (feedArtist.includes('bowl after bowl') && !feedTitle.includes('covers')) ||
              (feedUrl.toLowerCase().includes('bowlafterbowl.com') && !feedTitle.includes('covers') && feed.id !== 'bowl-covers')
            );

            if (isBowlAfterBowlPodcast) {
              console.log(`🚫 Filtering out Bowl After Bowl podcast from publisher count: ${feed.title} by ${feed.artist}`);
              continue;
            }

            albumCount++;
            trackCount += feed._count.Track;
          }
        }
      }

      return {
        id: feedGuid,
        title: cleanTitle,
        feedGuid: feedGuid,
        originalUrl: publisherFeed.feed.originalUrl,
        image: publisherFeed.itunesImage || '/placeholder-artist.png',
        description: publisherFeed.description?.replace(/<!\[CDATA\[|\]\]>/g, '') || `Publisher feed with ${albumCount} releases`,
        albums: [], // Individual albums not needed for publisher list
        itemCount: albumCount, // Use actual album count from database via static mapping
        totalTracks: trackCount, // Use actual track count from database via static mapping
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(cleanTitle)}`
      };
    });

    // Sort publishers alphabetically by artist name (title field contains artist name)
    publishers.sort((a: any, b: any) => {
      const nameA = a.title.toLowerCase();
      const nameB = b.title.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    console.log(`✅ Publishers API: Returning ${publishers.length} actual publisher feeds (sorted by artist name)`);

    const response = {
      publishers,
      total: publishers.length,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'ETag': `"${Date.now()}"`,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
    });
  } catch (error) {
    console.error('Unexpected error in database publishers API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      },
      { 
        status: 500,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
} 