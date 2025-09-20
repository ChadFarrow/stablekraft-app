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
    
    // Get all active feeds from database to create publisher data
    const feeds = await prisma.feed.findMany({
      where: { 
        status: 'active'
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
    
    // Check feeds for publisher tags according to Podcasting 2.0 spec
    // Publisher tags should be within the main RSS feed, not separate URLs
    const artistMap = new Map<string, any>();
    
    feeds.forEach(feed => {
      if (feed.artist && feed.tracks && feed.tracks.length > 0) {
        const artistName = feed.artist;
        const artistKey = generateAlbumSlug(artistName);
        
        // Check if this feed has publisher information
        // Only include feeds from platforms that are confirmed to have publisher tags
        const hasPublisherInfo = feed.originalUrl.includes('wavlake.com') || 
                                // Only include specific confirmed Doerfelverse publisher feeds
                                (feed.originalUrl.includes('doerfelverse.com') && 
                                 (feed.originalUrl.includes('the-doerfels') || 
                                  feed.originalUrl.includes('citybeach') ||
                                  feed.originalUrl.includes('ben-doerfel'))) ||
                                // Include other known platforms that support publisher tags
                                feed.originalUrl.includes('agilesetmedia.com') ||
                                feed.originalUrl.includes('podcastindex.org');
        
        if (hasPublisherInfo) {
          if (!artistMap.has(artistKey)) {
            artistMap.set(artistKey, {
              id: artistKey,
              title: artistName,
              feedGuid: artistKey,
              originalUrl: feed.originalUrl,
              image: feed.image,
              description: `Artist: ${artistName}`,
              albums: [],
              itemCount: 0,
              totalTracks: 0
            });
          }
          
          const artist = artistMap.get(artistKey)!;
          artist.albums.push({
            title: feed.title,
            artist: feed.artist,
            trackCount: feed.tracks?.length || 0,
            feedGuid: feed.id,
            feedUrl: feed.originalUrl,
            albumSlug: generateAlbumSlug(feed.title) + '-' + feed.id.split('-')[0],
            image: feed.image,
            explicit: feed.tracks?.some((t: any) => t.explicit) || feed.explicit
          });
          
          artist.itemCount++;
          artist.totalTracks += feed.tracks?.length || 0;
        }
      }
    });
    
    const actualPublisherFeeds = Array.from(artistMap.values());
    
    console.log(`📊 Found ${actualPublisherFeeds.length} artists with albums in database out of ${feeds.length} total feeds`);
    
    let publishers: any[] = [];
    
    if (actualPublisherFeeds.length > 0) {
      publishers = actualPublisherFeeds.sort((a, b) => 
        a.title.toLowerCase().localeCompare(b.title.toLowerCase())
      );
      
      console.log(`📊 Created ${publishers.length} publishers from database artists`);
    }

    // If no actual publisher feeds found in database, fall back to static data
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
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
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