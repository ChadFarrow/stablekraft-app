import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    console.log('🔍 Publishers API: Loading publishers from database');

    // Query all albums with publisher data from the database
    const feeds = await prisma.feed.findMany({
      where: {
        status: 'active',
        type: {
          notIn: ['podcast', 'publisher']
        }
      },
      select: {
        id: true,
        artist: true,
        image: true
      },
      take: 1000 // Get all feeds
    });

    console.log(`📊 Loaded ${feeds.length} feeds from database`);

    // Group by artist to create publisher list
    const publisherMap = new Map<string, any>();

    for (const feed of feeds) {
      if (!feed.artist) continue;

      const key = feed.artist;
      if (publisherMap.has(key)) {
        const existing = publisherMap.get(key);
        existing.albumCount += 1;
        // Use first image found as publisher image
        if (!existing.image && feed.image) {
          existing.image = feed.image;
        }
      } else {
        publisherMap.set(key, {
          name: feed.artist,
          feedGuid: generateAlbumSlug(feed.artist),
          albumCount: 1,
          image: feed.image || '/placeholder-artist.png'
        });
      }
    }

    const uniquePublishers = Array.from(publisherMap.values());
    console.log(`📊 Found ${uniquePublishers.length} unique publishers`);

    // Transform to match the expected format for the publishers API
    const publishers = uniquePublishers.map((publisher: any) => {
      return {
        id: publisher.feedGuid,
        title: publisher.name,
        feedGuid: publisher.feedGuid,
        originalUrl: '', // Not available from database
        image: publisher.image,
        description: `Publisher feed with ${publisher.albumCount} releases`,
        albums: [], // Individual albums not needed for publisher list
        itemCount: publisher.albumCount,
        totalTracks: publisher.albumCount, // Approximate
        isPublisherCard: true,
        publisherUrl: `/publisher/${publisher.feedGuid}`
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