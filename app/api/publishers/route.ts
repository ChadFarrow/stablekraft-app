import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    console.log('🔍 Database Publishers API: Getting actual publisher feeds');
    
    // Load the publisher feed results to get actual publisher feeds
    const publisherFeedResultsPath = path.join(process.cwd(), 'data', 'publisher-feed-results.json');
    let actualPublisherFeedUrls = new Set<string>();
    let publisherFeedResults: any[] = [];
    
    try {
      if (fs.existsSync(publisherFeedResultsPath)) {
        publisherFeedResults = JSON.parse(fs.readFileSync(publisherFeedResultsPath, 'utf8'));
        // Extract URLs from publisher feed results
        publisherFeedResults.forEach((item: any) => {
          if (item.feed?.originalUrl) {
            actualPublisherFeedUrls.add(item.feed.originalUrl);
          }
        });
        console.log(`📊 Found ${actualPublisherFeedUrls.size} actual publisher feed URLs from publisher-feed-results.json`);
      }
    } catch (error) {
      console.error('Error loading publisher feed results:', error);
    }
    
    // Get feeds from database that match the actual publisher feed URLs
    const feeds = await prisma.feed.findMany({
      where: { 
        status: 'active',
        OR: actualPublisherFeedUrls.size > 0 
          ? [
              // Match feeds by URL
              { originalUrl: { in: Array.from(actualPublisherFeedUrls) } },
              // Also include feeds explicitly marked as publisher type
              { type: 'publisher' }
            ]
          : [
              // Fallback if no publisher feed results file exists
              { type: 'publisher' }
            ]
      },
      include: {
        tracks: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { publishedAt: 'desc' },
            { createdAt: 'desc' }
          ]
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    console.log(`📊 Loaded ${feeds.length} feeds from database for publishers API`);
    
    // Group feeds by artist/publisher to create publisher data
    const publishersMap = new Map<string, any>();
    
    feeds.forEach(feed => {
      // Skip feeds without tracks
      if (feed.tracks.length === 0) return;
      
      // Determine publisher identity - use artist for album feeds, title for publisher feeds
      const publisherName = feed.artist || feed.title;
      const publisherKey = generateAlbumSlug(publisherName);
      
      if (!publishersMap.has(publisherKey)) {
        publishersMap.set(publisherKey, {
          id: publisherKey,
          title: publisherName,
          feedGuid: feed.type === 'publisher' ? feed.id : publisherKey,
          originalUrl: feed.originalUrl,
          image: feed.image,
          description: feed.description,
          albums: [],
          itemCount: 0,
          totalTracks: 0
        });
      }
      
      const publisher = publishersMap.get(publisherKey);
      
      // For publisher feeds, tracks might represent different albums
      if (feed.type === 'publisher') {
        // Group tracks by album if available, otherwise treat as one album
        const albumMap = new Map<string, any>();
        
        feed.tracks.forEach(track => {
          const albumKey = track.album || track.title || feed.title;
          if (!albumMap.has(albumKey)) {
            albumMap.set(albumKey, {
              title: track.album || track.title || feed.title,
              artist: track.artist || feed.artist || publisherName,
              trackCount: 0,
              feedGuid: feed.id,
              feedUrl: feed.originalUrl,
              albumSlug: generateAlbumSlug(albumKey) + '-' + feed.id.split('-')[0],
              image: track.image || feed.image,
              explicit: track.explicit || false
            });
          }
          albumMap.get(albumKey)!.trackCount++;
        });
        
        // Add all albums from this publisher feed
        Array.from(albumMap.values()).forEach(album => {
          publisher.albums.push(album);
          publisher.totalTracks += album.trackCount;
        });
      } else {
        // For album feeds, the entire feed is one album
        const albumSlug = generateAlbumSlug(feed.title) + '-' + feed.id.split('-')[0];
        publisher.albums.push({
          title: feed.title,
          artist: feed.artist || publisherName,
          trackCount: feed.tracks.length,
          feedGuid: feed.id,
          feedUrl: feed.originalUrl,
          albumSlug: albumSlug,
          image: feed.image,
          explicit: feed.tracks.some(t => t.explicit) || feed.explicit
        });
        publisher.totalTracks += feed.tracks.length;
      }
      
      publisher.itemCount = publisher.albums.length;
    });
    
    let publishers = Array.from(publishersMap.values()).sort((a, b) => 
      a.title.toLowerCase().localeCompare(b.title.toLowerCase())
    );

    // If no publishers found in database but we have static data, use that instead
    if (publishers.length === 0 && publisherFeedResults.length > 0) {
      console.log(`📊 No publishers in database, falling back to static data (${publisherFeedResults.length} items)`);
      
      publishers = publisherFeedResults.map((item: any) => {
        const feedTitle = item.title?.replace(/^<!\[CDATA\[|\]\]>$/g, '') || item.feed?.title || 'Unknown Publisher';
        const feedDescription = item.description?.replace(/^<!\[CDATA\[|\]\]>$/g, '') || 'Publisher feed discovered from RSS remote items';
        
        return {
          id: generateAlbumSlug(feedTitle),
          title: feedTitle,
          feedGuid: item.feed?.id || generateAlbumSlug(feedTitle),
          originalUrl: item.feed?.originalUrl,
          image: item.itunesImage || '/placeholder-artist.png',
          description: feedDescription,
          albums: [], // Static data doesn't have album details
          itemCount: item.remoteItemCount || 0,
          totalTracks: item.remoteItemCount || 0,
          isPublisherCard: true,
          publisherUrl: `/publisher/${generateAlbumSlug(feedTitle)}`
        };
      }).sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    }

    console.log(`✅ Database Publishers API: Returning ${publishers.length} actual publisher feeds with ${publishers.reduce((sum, p) => sum + p.itemCount, 0)} total albums`);

    const response = {
      publishers,
      total: publishers.length,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800',
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