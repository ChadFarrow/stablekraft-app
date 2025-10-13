import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

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

    // Transform to match the expected format for the publishers API
    const publishers = publisherFeedsData.map((publisherFeed: any) => {
      const cleanTitle = publisherFeed.title?.replace(/<!\[CDATA\[|\]\]>/g, '') || 'Unknown Publisher';
      const feedGuid = publisherFeed.feed.id || generateAlbumSlug(cleanTitle);

      return {
        id: feedGuid,
        title: cleanTitle,
        feedGuid: feedGuid,
        originalUrl: publisherFeed.feed.originalUrl,
        image: publisherFeed.itunesImage || '/placeholder-artist.png',
        description: publisherFeed.description?.replace(/<!\[CDATA\[|\]\]>/g, '') || `Publisher feed with ${publisherFeed.remoteItemCount || 0} releases`,
        albums: [], // Individual albums not needed for publisher list
        itemCount: publisherFeed.remoteItemCount || 0,
        totalTracks: publisherFeed.remoteItemCount || 0, // Approximate
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(cleanTitle)}`
      };
    });

    // Sort publishers alphabetically by artist name (title field contains artist name)
    publishers.sort((a, b) => {
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