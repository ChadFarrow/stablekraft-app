import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    console.log('🔍 Publishers API: Loading publisher stats from albums API');

    // Get publisher stats from the albums API (which uses the database)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const albumsResponse = await fetch(`${baseUrl}/api/albums?limit=1&offset=0`, {
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (!albumsResponse.ok) {
      throw new Error(`Albums API failed: ${albumsResponse.status}`);
    }

    const albumsData = await albumsResponse.json();
    const publisherStats = albumsData.publisherStats || [];

    console.log(`📊 Loaded ${publisherStats.length} publishers from albums API`);

    // Group publishers by unique feedGuid and sum album counts
    const publisherMap = new Map<string, any>();

    for (const stat of publisherStats) {
      const key = stat.feedGuid;
      if (publisherMap.has(key)) {
        // Sum album counts for publishers with multiple feedGuids
        const existing = publisherMap.get(key);
        existing.albumCount += stat.albumCount;
      } else {
        publisherMap.set(key, {
          name: stat.name,
          feedGuid: stat.feedGuid,
          albumCount: stat.albumCount
        });
      }
    }

    const uniquePublishers = Array.from(publisherMap.values());
    console.log(`📊 Deduplicated to ${uniquePublishers.length} unique publishers`);

    // Transform to match the expected format for the publishers API
    const publishers = uniquePublishers.map((publisher: any) => {
      return {
        id: publisher.feedGuid || generateAlbumSlug(publisher.name),
        title: publisher.name,
        feedGuid: publisher.feedGuid || generateAlbumSlug(publisher.name),
        originalUrl: '', // Will be populated by client if needed
        image: '/placeholder-artist.png', // Default - will be populated by albums with publisher data
        description: `Publisher feed with ${publisher.albumCount} releases`,
        albums: [], // Individual albums not needed for publisher list
        itemCount: publisher.albumCount,
        totalTracks: publisher.albumCount, // Approximate
        isPublisherCard: true,
        publisherUrl: `/publisher/${generateAlbumSlug(publisher.name)}`
      };
    });

    console.log(`✅ Publishers API: Returning ${publishers.length} actual publisher feeds`);

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